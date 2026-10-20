import * as assert from "assert";
import * as path from "path";
import { PNG } from "pngjs";
import { UserError } from "../../../../util/common";
import { DDS } from "../../../../util/image/dds";
import { fresh, handOver } from "../../host";
import { makeDds } from "../../dds";

type Decoder = typeof import("../../../../util/image/imagedecoder");
// These exports are the synchronous decoder's conversion boundary; workers load their own copy.
const converters = require("../../../../util/image/converter") as typeof import("../../../../util/image/converter");

describe("util/image/imagedecoder fallback", () => {
	let decoder: Decoder;
	let syncCalls: string[];
	let logged: unknown[][];
	let restore: () => void;
	const realWorker = path.resolve(__dirname, "../../../../util/image/imageWorker.js");
	const tga = Buffer.alloc(18 + 4 * 4 * 4, 0x7f);
	tga.fill(0, 0, 18);
	tga[2] = 2;
	tga.writeUInt16LE(4, 12);
	tga.writeUInt16LE(4, 14);
	tga[16] = 32;

	beforeEach(() => {
		handOver({
			workspace: { getConfiguration: () => ({ imageDecodeWorkers: 1 }) },
			window: { createOutputChannel: () => ({ appendLine: () => undefined }) },
		});
		decoder = fresh<Decoder>("../../util/image/imagedecoder");
		decoder._setImageWorkerPathForTest(realWorker);
		syncCalls = [];
		logged = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => logged.push(args);
		const originals = { ...converters };
		const originalParse = DDS.parse;
		DDS.parse = (...args) => {
			syncCalls.push("dds");
			return originalParse(...args);
		};
		converters.tgaToPng = (...args) => {
			syncCalls.push("tga");
			return originals.tgaToPng(...args);
		};
		converters.pngToPng = (...args) => {
			syncCalls.push("png");
			return originals.pngToPng(...args);
		};
		restore = () => {
			DDS.parse = originalParse;
			converters.tgaToPng = originals.tgaToPng;
			converters.pngToPng = originals.pngToPng;
			console.error = originalError;
		};
	});

	afterEach(async () => {
		try {
			await decoder._terminateImageWorkerForTest();
			decoder._resetImageWorkerPathForTest();
		} finally {
			restore();
		}
	});

	const oversizedPng = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPng);
	oversizedPng.write("IHDR", 12);
	oversizedPng.writeUInt32BE(16_385, 16);
	oversizedPng.writeUInt32BE(1, 20);
	const unsupportedTga = Buffer.from(tga);
	unsupportedTga[2] = 99;

	for (const [label, input, kind, message] of [
		["truncated DDS", Buffer.alloc(8), "dds", /truncated/],
		["truncated TGA", Buffer.alloc(8), "tga", /truncated/],
		["unsupported TGA", unsupportedTga, "tga", /Unsupported tga/],
		["oversized PNG", oversizedPng, "dds", /exceeds the supported maximum/],
		["corrupt PNG", oversizedPng.subarray(0, 16), "dds", /Unsupported png/],
	] as const) {
		it(`does not retry or log a worker UserError for ${label}`, async () => {
			await assert.rejects(decoder.decodeImageToPng(input, kind),
				(e: unknown) => e instanceof UserError && message.test(e.message));
			assert.deepStrictEqual(syncCalls, []);
			assert.deepStrictEqual(logged, []);
			assert.strictEqual(decoder._getWorkerCountForTest(), 1);
			assert.strictEqual((await decoder.decodeImageToPng(tga, "tga")).width, 4);
			assert.deepStrictEqual(syncCalls, []);
		});
	}

	it("retries once synchronously for a genuine worker startup failure", async () => {
		decoder._setImageWorkerPathForTest(path.join(__dirname, "missing-worker.js"));
		const result = await decoder.decodeImageToPng(tga, "tga");
		assert.deepStrictEqual(syncCalls, ["tga"]);
		assert.strictEqual(result.width, 4);
		assert.strictEqual(PNG.sync.read(result.pngBuffer).height, 4);
		assert.ok(logged.length > 0);
		assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), true);
		await decoder.decodeImageToPng(tga, "tga");
		assert.deepStrictEqual(syncCalls, ["tga", "tga"]);
	});

	it("never retries queued timeouts and can decode again with a fresh worker", async function () {
		this.timeout(5000);
		decoder._setImageWorkerPathForTest(path.resolve(__dirname, "../../../hangingImageWorker.js"));
		decoder._setImageJobTimeoutForTest(50);
		const results = await Promise.allSettled(Array.from({ length: 16 }, () => decoder.decodeImageToPng(tga, "tga")));
		for (const result of results) {
			assert.strictEqual(result.status, "rejected");
			if (result.status === "rejected") {
				assert.strictEqual(result.reason.name, "ImageDecodeTimeoutError");
			}
		}
		assert.deepStrictEqual(syncCalls, []);
		assert.strictEqual(decoder._getWorkerCountForTest(), 0);
		assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), false);
		decoder._setImageWorkerPathForTest(realWorker);
		decoder._setImageJobTimeoutForTest(30_000);
		assert.strictEqual((await decoder.decodeImageToPng(tga, "tga")).width, 4);
		assert.deepStrictEqual(syncCalls, []);
	});

	it("preserves concurrent valid DDS/TGA/PNG bytes and pooled source buffers", async () => {
		const png = PNG.sync.write(new PNG({ width: 7, height: 3 }));
		const inputs = [
			{ buffer: makeDds({ width: 8, height: 8, data: 8 * 8 * 4 }), kind: "dds" },
			{ buffer: tga, kind: "tga" },
			{ buffer: png, kind: "dds" },
		] as const;
		const pooled = inputs.map(({ buffer, kind }) => {
			const backing = Buffer.allocUnsafe(buffer.length + 12);
			buffer.copy(backing, 8);
			return { buffer: backing.subarray(8, 8 + buffer.length), kind };
		});
		const copies = pooled.map(({ buffer }) => Buffer.from(buffer));
		const expected = pooled.map(({ buffer, kind }) => decoder.decodeImageToPngSync(buffer, kind));
		assert.deepStrictEqual(syncCalls, ["dds", "tga", "png"]);
		syncCalls.length = 0;
		const results = await Promise.all(pooled.map(({ buffer, kind }) => decoder.decodeImageToPng(buffer, kind)));
		assert.deepStrictEqual(results, expected);
		pooled.forEach(({ buffer }, i) => assert.deepStrictEqual(buffer, copies[i]));
		assert.deepStrictEqual(syncCalls, []);
	});
});
