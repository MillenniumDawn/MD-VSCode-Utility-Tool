import * as assert from "assert";
import { PNG } from "pngjs";
import {
	ddsToPng,
	isPngBuffer,
	pngToPng,
	readPngHeaderDimensions,
	tgaToPng,
} from "../../../../util/image/converter";
import { isUserError, makeDds, parseDds } from "../../dds";

const TGA = require("tga") as typeof import("tga");

function withoutRasterAllocation(convert: () => PNG, rasterBytes: number): PNG {
	const original = Buffer.alloc;
	const sizes: number[] = [];
	Buffer.alloc = (size, fill?, encoding?) => {
		sizes.push(size);
		return original(size, fill, encoding);
	};
	try {
		const png = convert();
		assert.ok(!sizes.includes(rasterBytes), "the PNG must not allocate an unused RGBA canvas");
		return png;
	} finally {
		Buffer.alloc = original;
	}
}

function makePng(width: number, height: number, rgba: number[]): Buffer {
	const png = new PNG({ width, height });
	png.data = Buffer.from(rgba);
	return PNG.sync.write(png);
}

interface TgaFixture {
	width: number;
	height: number;
	// 2 true-colour, 3 greyscale, 10 run-length true-colour. Defaults to 2.
	type?: number;
	bitsPerPixel?: number;
	colourMapType?: number;
	data?: number[];
}

function makeTga(fixture: TgaFixture): Buffer {
	const buf = Buffer.alloc(18 + (fixture.data?.length ?? 0));
	buf[1] = fixture.colourMapType ?? 0;
	buf[2] = fixture.type ?? 2;
	buf.writeUInt16LE(fixture.width, 12);
	buf.writeUInt16LE(fixture.height, 14);
	buf[16] = fixture.bitsPerPixel ?? 32;
	buf.set(fixture.data ?? [], 18);
	return buf;
}

describe("PNG reading", () => {
	const png = makePng(3, 2, new Array<number>(24).fill(7));

	it("tells a PNG from anything else by its signature", () => {
		assert.strictEqual(isPngBuffer(png), true);
		assert.strictEqual(isPngBuffer(png.subarray(0, 7)), false);
		assert.strictEqual(isPngBuffer(makeDds({ width: 1, height: 1, data: 4 })), false);
	});

	it("reads the size from the header alone", () => {
		assert.deepStrictEqual(readPngHeaderDimensions(png), { width: 3, height: 2 });
		// Enough for the header, with none of the pixel data behind it.
		assert.deepStrictEqual(readPngHeaderDimensions(png.subarray(0, 24)), { width: 3, height: 2 });
	});

	it("reads no size from a header that is cut short, is not a PNG, or does not start with IHDR", () => {
		const otherChunk = Buffer.from(png);
		otherChunk.write("IDAT", 12, "ascii");
		for (const buffer of [png.subarray(0, 23), Buffer.alloc(64), otherChunk]) {
			assert.strictEqual(readPngHeaderDimensions(buffer), undefined);
		}
	});

	it("decodes a PNG to its pixels", () => {
		const decoded = pngToPng(makePng(1, 2, [1, 2, 3, 4, 5, 6, 7, 8]));
		assert.deepStrictEqual([decoded.width, decoded.height, ...decoded.data], [1, 2, 1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("refuses a PNG over the size limit before inflating it", () => {
		const huge = Buffer.from(png);
		huge.writeUInt32BE(65535, 16);
		assert.throws(() => pngToPng(huge), isUserError(/PNG image size 65535x2 exceeds the supported maximum/));
	});

	it("reports a broken PNG as bad input, not as a failure of the tool", () => {
		assert.throws(() => pngToPng(png.subarray(0, 40)), isUserError(/^Unsupported png format: /));
		assert.throws(() => pngToPng(Buffer.from("not a png at all")), isUserError(/^Unsupported png format: /));
	});
});

describe("ddsToPng", () => {
	it("writes the first image of a DDS file", () => {
		const png = ddsToPng(parseDds(makeDds({ width: 2, height: 1, data: [10, 20, 30, 40, 50, 60, 70, 80] })));
		assert.deepStrictEqual([png.width, png.height, ...png.data], [2, 1, 30, 20, 10, 40, 70, 60, 50, 80]);
	});

	it("refuses a DDS that holds no image", () => {
		assert.throws(() => ddsToPng({ images: [] } as never), isUserError(/DDS contains no images/));
	});

	it("uses the decoded view's exact backing storage without a PNG canvas or pixel copy", () => {
		const dds = parseDds(makeDds({ width: 16, height: 16, data: 16 * 16 * 4 }));
		const pixels = new Uint8Array(16 * 16 * 4 + 23).subarray(7, 7 + 16 * 16 * 4);
		pixels.fill(41);
		dds.images[0].getFullRgba = () => pixels;
		const png = withoutRasterAllocation(() => ddsToPng(dds), pixels.byteLength);
		assert.strictEqual(png.data.buffer, pixels.buffer);
		assert.strictEqual(png.data.byteOffset, pixels.byteOffset);
		assert.strictEqual(png.data.byteLength, pixels.byteLength);
		assert.deepStrictEqual(PNG.sync.write(png), makePng(16, 16, Array.from(pixels)));
	});

	for (const compressed of [false, true]) {
		it(`keeps ${compressed ? "compressed" : "raw"} conversions independent of their source and later conversions`, () => {
			const source = makeDds(compressed
				? { width: 4, height: 4, fourCC: "DXT1", data: [0, 0xf8, 0, 0, 0, 0, 0, 0] }
				: { width: 4, height: 4, data: Uint8Array.from({ length: 64 }, (_, i) => i) });
			const dds = parseDds(source);
			const first = ddsToPng(dds);
			const expected = Buffer.from(first.data);
			const sourceBefore = Buffer.from(source);
			const second = ddsToPng(dds);
			first.data.fill(0);
			assert.deepStrictEqual(second.data, expected);
			assert.deepStrictEqual(source, sourceBefore);
			source.fill(0);
			assert.deepStrictEqual(second.data, expected);
		});
	}
});

describe("tgaToPng", () => {
	const decoded: [name: string, fixture: TgaFixture, rgba: number[]][] = [
		// Stored blue, green, red, alpha.
		["a true-colour image", { width: 1, height: 1, data: [10, 20, 30, 40] }, [30, 20, 10, 40]],
		["a fully transparent image, which stays transparent", { width: 1, height: 1, data: [10, 20, 30, 0] }, [30, 20, 10, 0]],
		["a 24-bit image as opaque", { width: 1, height: 1, bitsPerPixel: 24, data: [10, 20, 30] }, [30, 20, 10, 255]],
		[
			"rows from the bottom up",
			{ width: 1, height: 2, type: 3, bitsPerPixel: 8, data: [1, 2] },
			[2, 2, 2, 255, 1, 1, 1, 255],
		],
		[
			"a run-length packet",
			{ width: 2, height: 1, type: 10, data: [0x81, 10, 20, 30, 40] },
			[30, 20, 10, 40, 30, 20, 10, 40],
		],
	];
	for (const [name, fixture, rgba] of decoded) {
		it(`decodes ${name}`, () => {
			const png = tgaToPng(makeTga(fixture));
			assert.deepStrictEqual([png.width, png.height, ...png.data], [fixture.width, fixture.height, ...rgba]);
		});
	}

	it("retains the decoder-owned pixels without allocating a PNG canvas or pixel copy", () => {
		const source = makeTga({ width: 16, height: 16, data: new Array<number>(16 * 16 * 4).fill(37) });
		const parse = TGA.prototype.parse;
		let pixels: Uint8Array | undefined;
		TGA.prototype.parse = function () {
			parse.call(this);
			pixels = this.pixels;
		};
		try {
			const png = withoutRasterAllocation(() => tgaToPng(source), 16 * 16 * 4);
			assert.ok(pixels);
			assert.strictEqual(png.data.buffer, pixels.buffer);
			assert.strictEqual(png.data.byteOffset, pixels.byteOffset);
			assert.strictEqual(png.data.byteLength, pixels.byteLength);
			assert.deepStrictEqual(PNG.sync.write(png), makePng(16, 16, Array.from(pixels)));
		} finally {
			TGA.prototype.parse = parse;
		}
	});

	const refused: [name: string, file: Buffer, message: RegExp][] = [
		["a header cut short", Buffer.alloc(10), /TGA header is truncated/],
		["a size over the limit", makeTga({ width: 65535, height: 65535 }), /TGA image size 65535x65535 exceeds the supported maximum/],
		["a zero width", makeTga({ width: 0, height: 2 }), /TGA image size 0x2 is not valid/],
		["a header with no image data", makeTga({ width: 2, height: 2, type: 0 }), /^Unsupported tga format$/],
		["a colour-mapped image with no colour map", makeTga({ width: 2, height: 2, type: 1 }), /^Unsupported tga format$/],
		["a pixel depth the decoder does not handle", makeTga({ width: 2, height: 2, bitsPerPixel: 12, data: new Array<number>(16).fill(0) }), /^Unsupported tga format$/],
		["true-colour pixels cut short", makeTga({ width: 2, height: 2, data: new Array<number>(8).fill(0) }), /TGA pixel data is truncated/],
		["greyscale pixels cut short", makeTga({ width: 2, height: 2, type: 3, bitsPerPixel: 8, data: [0, 0, 0] }), /TGA pixel data is truncated/],
		["a run that overruns the image", makeTga({ width: 1, height: 1, type: 10, data: [0x81, 10, 20, 30, 40] }), /^Unsupported tga format: /],
	];
	for (const [name, file, message] of refused) {
		it(`refuses ${name}`, () => {
			assert.throws(() => tgaToPng(file), isUserError(message));
		});
	}
});
