import * as assert from "assert";
import { mock } from "node:test";
import { PNG } from "pngjs";
import zlib from "zlib";
import {
	assertDecodablePng,
	ddsToPng,
	isPngBuffer,
	pngToPng,
	readPngHeaderDimensions,
	tgaToPng,
} from "../../../../util/image/converter";
import { isUserError, makeDds, parseDds } from "../../dds";
import { makeZeroPng, pngChunk, pngEnd, pngFile, pngHeader } from "../../png";
import * as tgaDecoder from "../../../../util/image/tga";

function withoutRasterAllocation(convert: () => PNG, rasterBytes: number): PNG {
	const original = Buffer.alloc;
	const sizes: number[] = [];
	Buffer.alloc = (size, fill?, encoding?) => {
		sizes.push(size);
		return original(size, fill, encoding);
	};
	try {
		const png = convert();
		assert.ok(!sizes.includes(rasterBytes), "conversion must not allocate an unused RGBA canvas");
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

describe("PNG memory bound", () => {
	// pngjs inflates an interlaced image with no limit, so a spy on zlib shows whether a refusal
	// came before the allocation or after it.
	afterEach(() => mock.restoreAll());

	const inflatedBytes = 8 * 1024 * 1024;
	const rgba = Array.from({ length: 8 * 8 * 4 }, (_, i) => (i * 37) % 256);
	const flat = makePng(8, 8, rgba);
	const interlaced = makeZeroPng([pngHeader(16, 16, 1)], inflatedBytes);
	// An 8x8 image of zeros (a filter byte and 32 pixel bytes a row), its data cut into three chunks.
	const deflated = zlib.deflateSync(Buffer.alloc(8 * 33));
	const idats = [deflated.subarray(0, 4), deflated.subarray(4, 8), deflated.subarray(8)].map((part) =>
		pngChunk("IDAT", part),
	);

	it("is needed: pngjs inflates an interlaced 16x16 image to many times what it holds", () => {
		const inflate = mock.method(zlib, "inflateSync");
		assert.ok(interlaced.length < 64 * 1024);
		assert.throws(() => PNG.sync.read(interlaced));
		assert.strictEqual(inflate.mock.callCount(), 1);
		assert.strictEqual(inflate.mock.calls[0]?.result?.length, inflatedBytes);
	});

	const refused: [name: string, file: Buffer, message: RegExp][] = [
		["an interlaced PNG whose data inflates past its header", interlaced, /interlaced images are not supported/],
		[
			"a flat header followed by an interlaced one",
			makeZeroPng([pngHeader(16, 16, 0), pngHeader(16, 16, 1)], inflatedBytes),
			/header is repeated/,
		],
		[
			"a header repeated after the pixel data",
			pngFile(pngHeader(8, 8, 0), ...idats, pngHeader(8, 8, 1), pngEnd()),
			/header is repeated/,
		],
		[
			"a header over the size limit",
			makeZeroPng([pngHeader(20000, 20000, 0)], 1024),
			/PNG image size 20000x20000 exceeds the supported maximum/,
		],
		["no header", Buffer.from("not a png at all"), /header is missing/],
		["a header cut before its last byte", interlaced.subarray(0, 28), /header is cut short/],
	];
	for (const [name, file, message] of refused) {
		it(`refuses ${name} before inflating it`, () => {
			const inflate = mock.method(zlib, "inflateSync");
			assert.throws(() => assertDecodablePng(file), isUserError(message));
			assert.throws(() => pngToPng(file), isUserError(message));
			assert.strictEqual(inflate.mock.callCount(), 0);
		});
	}

	it("reads the size of a flat PNG and decodes it to the pixels pngjs gives", () => {
		assert.deepStrictEqual(assertDecodablePng(flat), { width: 8, height: 8 });
		const decoded = pngToPng(flat);
		assert.deepStrictEqual(decoded.data, Buffer.from(rgba));
		assert.deepStrictEqual(decoded.data, PNG.sync.read(flat).data);
	});

	it("walks past every chunk of a PNG whose pixel data is split into several", () => {
		const split = pngFile(pngHeader(8, 8, 0), ...idats, pngEnd());
		assert.deepStrictEqual(assertDecodablePng(split), { width: 8, height: 8 });
		assert.deepStrictEqual(pngToPng(split).data, Buffer.alloc(8 * 8 * 4));
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

	it("decodes every supported image type to the expected RGBA bytes", () => {
		const colourMap = Buffer.from([0, 0, 255, 255, 255, 0, 0, 255]);
		const fixtures: [number, Buffer, number[]][] = [
			[1, Buffer.from([0, 1]), [255, 0, 0, 255, 0, 0, 255, 255]],
			[2, Buffer.from([0, 0, 255, 255, 0, 255, 0, 255]), [255, 0, 0, 255, 0, 255, 0, 255]],
			[3, Buffer.from([12, 200]), [12, 12, 12, 255, 200, 200, 200, 255]],
			[9, Buffer.from([1, 0, 1]), [255, 0, 0, 255, 0, 0, 255, 255]],
			[10, Buffer.from([1, 0, 0, 255, 255, 0, 255, 0, 255]), [255, 0, 0, 255, 0, 255, 0, 255]],
			[11, Buffer.from([1, 12, 200]), [12, 12, 12, 255, 200, 200, 200, 255]],
		];
		for (const [type, payload, expected] of fixtures) {
			const indexed = type === 1 || type === 9;
			const header = Buffer.alloc(18);
			header[1] = indexed ? 1 : 0;
			header[2] = type;
			header.writeUInt16LE(2, 5);
			header[7] = indexed ? 32 : 0;
			header.writeUInt16LE(2, 12);
			header.writeUInt16LE(1, 14);
			header[16] = indexed ? 8 : type === 3 || type === 11 ? 8 : 32;
			const image = Buffer.concat([header, ...(indexed ? [colourMap] : []), payload]);
			const png = tgaToPng(image);
			assert.deepStrictEqual(Array.from(png.data), expected, `TGA image type ${type}`);
		}
	});

	it("decodes mixed raw and repeated RLE packets across a row boundary", () => {
		const file = makeTga({
			width: 2,
			height: 2,
			type: 10,
			data: [1, 0, 0, 255, 255, 0, 255, 0, 255, 0x80, 255, 0, 0, 255, 0x80, 0, 255, 255, 255],
		});
		assert.deepStrictEqual(Array.from(tgaToPng(file).data), [0, 0, 255, 255, 255, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
	});

	it("honours the image ID, colour-map first index, descriptor origins, and 16-bit alpha", () => {
		const header = Buffer.alloc(18);
		header[0] = 1;
		header[1] = 1;
		header[2] = 1;
		header.writeUInt16LE(1, 3);
		header.writeUInt16LE(4, 5);
		header[7] = 32;
		header.writeUInt16LE(2, 12);
		header.writeUInt16LE(2, 14);
		header[16] = 8;
		const palette = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 255, 255]);
		const indices = Buffer.from([1, 2, 3, 4]);
		const colours = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]];
		for (const origin of [0, 0x10, 0x20, 0x30]) {
			header[17] = origin;
			const png = tgaToPng(Buffer.concat([header, Buffer.from([65]), palette, indices]));
			const flipX = (origin & 0x10) !== 0;
			const flipY = (origin & 0x20) === 0;
			const expected: number[][] = new Array(4);
			for (let i = 0; i < 4; i++) {
				const x = i % 2;
				const y = Math.floor(i / 2);
				expected[(flipY ? 1 - y : y) * 2 + (flipX ? 1 - x : x)] = colours[(indices[i] - 1)];
			}
			assert.deepStrictEqual(Array.from(png.data), expected.flat());
		}
		const trueColour = Buffer.alloc(20);
		trueColour[2] = 2;
		trueColour.writeUInt16LE(1, 12);
		trueColour.writeUInt16LE(1, 14);
		trueColour[16] = 16;
		trueColour[17] = 1;
		trueColour.writeUInt16LE(0x8000 | (31 << 10), 18);
		assert.deepStrictEqual(Array.from(tgaToPng(trueColour).data), [248, 0, 0, 128]);
		const grayscale = Buffer.alloc(20);
		grayscale[2] = 3;
		grayscale.writeUInt16LE(1, 12);
		grayscale.writeUInt16LE(1, 14);
		grayscale[16] = 16;
		grayscale.set([80, 64], 18);
		assert.deepStrictEqual(Array.from(tgaToPng(grayscale).data), [80, 80, 80, 64]);
	});

	it("uses TGA 2.0 extension attributes to determine whether 32-bit alpha is meaningful", () => {
		const image = Buffer.alloc(18 + 4 + 495 + 26);
		image[2] = 2;
		image.writeUInt16LE(1, 12);
		image.writeUInt16LE(1, 14);
		image[16] = 32;
		image.set([0, 0, 255, 0], 18);
		image.writeUInt32LE(22, image.length - 26);
		image[22 + 494] = 0;
		image.write("TRUEVISION-XFILE.\0", image.length - 18, "ascii");
		assert.deepStrictEqual(Array.from(tgaToPng(image).data), [255, 0, 0, 255]);
		image[22 + 494] = 3;
		assert.deepStrictEqual(Array.from(tgaToPng(image).data), [255, 0, 0, 0]);
		const grayscale = Buffer.alloc(18 + 2 + 495 + 26);
		grayscale[2] = 3;
		grayscale.writeUInt16LE(1, 12);
		grayscale.writeUInt16LE(1, 14);
		grayscale[16] = 16;
		grayscale.set([80, 64], 18);
		grayscale.writeUInt32LE(20, grayscale.length - 26);
		grayscale[20 + 494] = 0;
		grayscale.write("TRUEVISION-XFILE.\0", grayscale.length - 18, "ascii");
		assert.deepStrictEqual(Array.from(tgaToPng(grayscale).data), [80, 80, 80, 255]);
		grayscale[20 + 494] = 3;
		assert.deepStrictEqual(Array.from(tgaToPng(grayscale).data), [80, 80, 80, 64]);
	});

	it("keeps the decoder-owned pixels without allocating a PNG canvas or copy", () => {
		const pixels = new Uint8Array(16 * 16 * 4 + 23).subarray(7, 7 + 16 * 16 * 4);
		pixels.fill(37);
		const decoder = mock.method(tgaDecoder, "decodeTga", () => ({ width: 16, height: 16, pixels: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength) }));
		try {
			const png = withoutRasterAllocation(() => tgaToPng(Buffer.alloc(18)), pixels.byteLength);
			assert.strictEqual(png.data.buffer, pixels.buffer);
			assert.strictEqual(png.data.byteOffset, pixels.byteOffset);
			assert.strictEqual(png.data.byteLength, pixels.byteLength);
			assert.deepStrictEqual(PNG.sync.write(png), makePng(16, 16, Array.from(pixels)));
		} finally {
			decoder.mock.restore();
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
