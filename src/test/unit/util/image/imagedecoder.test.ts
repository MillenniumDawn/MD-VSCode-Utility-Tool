import * as assert from "assert";
import { EventEmitter } from "events";
import * as path from "path";
import { PNG } from "pngjs";
import { UserError } from "../../../../util/common";
import { DDS } from "../../../../util/image/dds";
import * as decoder from "../../../../util/image/imagedecoder";
import { handOver } from "../../host";
import { makeDds } from "../../dds";
// These exports are the synchronous decoder's conversion boundary; workers load their own copy.
const converters = require("../../../../util/image/converter") as typeof import("../../../../util/image/converter");
// The decoder reads `Worker` off this module each time it spawns, so a test can swap it.
const threads = require("worker_threads") as typeof import("worker_threads");

const SCRIPTED_WIDTH = 7;

// A worker that takes every job and answers only when the test says so.
class ScriptedWorker extends EventEmitter {
	static instances: ScriptedWorker[] = [];
	readonly stderr = new EventEmitter();
	readonly posted: { id: number }[] = [];
	failNextPost = false;
	constructor() {
		super();
		ScriptedWorker.instances.push(this);
	}
	postMessage(request: { id: number }): void {
		if (this.failNextPost) {
			this.failNextPost = false;
			throw new Error("postMessage failed");
		}
		this.posted.push(request);
	}
	answer(): void {
		const request = this.posted.shift();
		assert.ok(request, "the worker was handed no job to answer");
		this.emit("message", { id: request.id, png: new ArrayBuffer(1), width: SCRIPTED_WIDTH, height: 1 });
	}
	terminate(): Promise<number> {
		return Promise.resolve(0);
	}
}

describe("util/image/imagedecoder fallback", () => {
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
			assert.strictEqual(decoder._getLiveWorkerCountForTest(), decoder._getWorkerCountForTest());
		});
	}

	it("fails only the bad inputs of a queued batch, without retrying or logging", async () => {
		const results = await Promise.allSettled([
			decoder.decodeImageToPng(oversizedPng, "dds"),
			decoder.decodeImageToPng(tga, "tga"),
			decoder.decodeImageToPng(unsupportedTga, "tga"),
			decoder.decodeImageToPng(tga, "tga"),
		]);
		assert.deepStrictEqual(
			results.map((r) => r.status === "fulfilled" ? r.value.width : r.reason instanceof UserError),
			[true, 4, true, 4],
		);
		assert.deepStrictEqual(syncCalls, []);
		assert.deepStrictEqual(logged, []);
		assert.strictEqual(decoder._getWorkerCountForTest(), 1);
	});

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
				assert.ok(result.reason instanceof Error);
				assert.strictEqual(result.reason.name, "ImageDecodeTimeoutError");
				assert.match(result.reason.message, /timed out/);
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

	describe("with scripted workers", () => {
		let realWorker: typeof threads.Worker;

		beforeEach(() => {
			ScriptedWorker.instances = [];
			realWorker = threads.Worker;
			threads.Worker = ScriptedWorker as unknown as typeof threads.Worker;
		});

		afterEach(() => {
			threads.Worker = realWorker;
		});

		it("falls back for every job in flight when a worker exits without an error first", async () => {
			const pending = Promise.all([1, 2, 3].map(() => decoder.decodeImageToPng(tga, "tga")));
			ScriptedWorker.instances[0].emit("exit", 1);
			assert.deepStrictEqual((await pending).map((r) => r.width), [4, 4, 4]);
			assert.deepStrictEqual(syncCalls, ["tga", "tga", "tga"]);
			assert.ok(logged.length > 0);
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), true);
			assert.strictEqual(decoder._getWorkerCountForTest(), 0);
		});

		it("falls back only for a job the worker cannot be handed, and keeps serving the pool", async () => {
			const first = decoder.decodeImageToPng(tga, "tga");
			const worker = ScriptedWorker.instances[0];
			worker.failNextPost = true;
			const second = decoder.decodeImageToPng(tga, "tga");
			const third = decoder.decodeImageToPng(tga, "tga");
			assert.strictEqual(worker.posted.length, 2);
			worker.answer();
			worker.answer();
			assert.deepStrictEqual(
				(await Promise.all([first, second, third])).map((r) => r.width),
				[SCRIPTED_WIDTH, 4, SCRIPTED_WIDTH],
			);
			assert.deepStrictEqual(syncCalls, ["tga"]);
			assert.ok(logged.length > 0);
			assert.strictEqual(decoder._getWorkerCountForTest(), 1);
			assert.strictEqual(decoder._isWorkerPoolDisabledForTest(), false);
			const fourth = decoder.decodeImageToPng(tga, "tga");
			worker.answer();
			assert.strictEqual((await fourth).width, SCRIPTED_WIDTH);
		});
	});
});
