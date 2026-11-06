import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../../util/fileloader";
import { UserError } from "../../../../../util/common";
import { RiverLoader, findRiverPointsList, loadRivers } from "../../../../../previewdef/worldmap/loader/river";
import { parseBmp } from "../../../../../util/image/bmp/bmpparser";
import type { WorldMapWarning } from "../../../../../previewdef/worldmap/definitions";
import { LoaderSession } from "../../../../../util/loader/loader";

function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixels: Record<string, number> = {},
): Buffer {
	const bytesPerRow = ((((width * bitsPerPixel + 7) >> 3) + 3) & 0xfffffffc) >>> 0;
	const dataOffset = 54;
	const buf = Buffer.alloc(dataOffset + bytesPerRow * height, 200);
	buf.write("BM", 0, "ascii");
	buf.writeUInt32LE(dataOffset, 10);
	buf.writeUInt32LE(40, 14);
	buf.writeUInt32LE(width, 18);
	buf.writeUInt32LE(height, 22);
	buf.writeUInt16LE(bitsPerPixel, 28);
	buf.writeUInt32LE(0, 30);
	for (const key of Object.keys(pixels)) {
		const [x, y] = key.split(",").map(Number);
		buf[dataOffset + (height - 1 - y) * bytesPerRow + x] = pixels[key];
	}
	return buf;
}

// The loader is a file loader, so a load first stats the file; the read is mocked to hand back
// `buffer` whatever it is asked for, with a plain path in place of the real file URI.
function mockRiverFile(buffer: Buffer): void {
	mock.method(
		fileloader,
		"readFileFromModOrHOI4",
		(async () => [buffer, "/tmp/map/rivers.bmp"]) as never,
	);
	mock.method(
		fileloader,
		"hoiFileExpiryToken",
		(async () => "v1") as never,
	);
}

describe("previewdef/worldmap/loader river", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	it("rejects an unreadable river image", async () => {
		mockRiverFile(Buffer.alloc(0));
		const loader = new RiverLoader("map/rivers.bmp");
		await assert.rejects(
			loader.load(new LoaderSession(true)),
			(e: unknown) =>
				e instanceof UserError && e.message === "Bmp not starts with 'BM'",
		);
	});

	it("warns and returns no rivers when the image isn't 8 bits per pixel", async () => {
		mockRiverFile(buildBmp(1, 1, 4));
		const loader = new RiverLoader("map/rivers.bmp");
		const result = await loader.load(new LoaderSession(true));
		assert.deepStrictEqual(result.result, { width: 1, height: 1, rivers: [] });
		assert.deepStrictEqual(result.warnings, [
			{
				relatedFiles: ["map/rivers.bmp"],
				text: "The rivers image should be 8 bits per pixel, but it is 4.",
				source: [{ type: "river", name: "", index: -1 }],
			},
		]);
		assert.deepStrictEqual(result.dependencies, ["map/rivers.bmp"]);
	});

	it("finds every disjoint river and validates sources, joins and loops", async () => {
		const pixels: Record<string, number> = {
			// River A: clean line with one source and one mark endpoint.
			"0,0": 0,
			"1,0": 5,
			"2,0": 5,
			"3,0": 1,
			// River B: no source at all.
			"0,2": 5,
			"1,2": 5,
			"2,2": 5,
			// River C: two sources.
			"0,4": 0,
			"1,4": 5,
			"2,4": 0,
			// River D: T-shaped branch, one source and two dead-end branches (loops).
			"8,1": 0,
			"9,1": 5,
			"10,1": 7,
			"9,0": 8,
			// River E: 4-way star, one source and three ambiguous branches.
			"4,3": 5,
			"5,3": 9,
			"6,3": 8,
			"5,2": 7,
			"5,4": 0,
		};
		mockRiverFile(buildBmp(12, 8, 8, pixels));
		const loader = new RiverLoader("map/rivers.bmp");
		const result = await loader.load(new LoaderSession(true));

		assert.strictEqual(result.result.rivers.length, 5);
		assert.strictEqual(result.result.width, 12);
		assert.strictEqual(result.result.height, 8);

		const texts = result.warnings.map((w) => w.text);
		const has = (s: string) => texts.some((t) => t.includes(s));
		assert.ok(has("has no source"), texts.join("\n"));
		assert.ok(has("multiple sources"), texts.join("\n"));
		assert.ok(
			has("flow-in or flow-out mark") || has("may contain a loop"),
			texts.join("\n"),
		);
	});

	it("leaves the supplied BMP view unchanged across extractions", () => {
		const buffer = buildBmp(3, 1, 8, { "0,0": 0, "1,0": 5, "2,0": 1 });
		const image = parseBmp(buffer.buffer as ArrayBuffer, buffer.byteOffset);
		const data = image.data;
		const bytes = Buffer.from(buffer);
		const first = findRiverPointsList(image);
		assert.strictEqual(image.data, data);
		assert.deepStrictEqual(buffer, bytes);
		assert.strictEqual(first.length, 1);
		assert.deepStrictEqual(findRiverPointsList(image), first);
	});

	it("preserves cached bytes, rivers and warnings through forced reloads", async () => {
		const buffer = buildBmp(3, 3, 8, {
			"0,2": 5,
			"1,2": 5,
			"2,2": 5,
			"2,1": 5,
			"2,0": 1,
		});
		mockRiverFile(buffer);
		const originalBytes = Buffer.from(buffer);

		const directWarnings: WorldMapWarning[] = [];
		const direct1 = await loadRivers(
			"map/rivers.bmp",
			async () => undefined,
			directWarnings,
		);
		const directWarnings2: WorldMapWarning[] = [];
		const direct2 = await loadRivers(
			"map/rivers.bmp",
			async () => undefined,
			directWarnings2,
		);

		assert.deepStrictEqual(direct2.rivers, direct1.rivers);
		assert.deepStrictEqual(directWarnings2, directWarnings);
		assert.strictEqual(direct1.rivers.length, 1);
		assert.ok(directWarnings.some((warning) => warning.text.includes("has no source")));
		assert.deepStrictEqual(buffer, originalBytes);

		const loader = new RiverLoader("map/rivers.bmp");
		const first = await loader.load(new LoaderSession(true));
		const second = await loader.load(new LoaderSession(true));

		assert.deepStrictEqual(second.result, first.result);
		assert.deepStrictEqual(second.warnings, first.warnings);
		assert.deepStrictEqual(second.dependencies, first.dependencies);
		assert.deepStrictEqual(first.result.rivers, direct1.rivers);
		assert.deepStrictEqual(buffer, originalBytes);
	});
});