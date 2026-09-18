import * as assert from "assert";
import { parseBmp } from "../util/image/bmp/bmpparser";
import { UserError } from "../util/common";

// A minimal BMP: 14-byte file header, a 40-byte BITMAPINFOHEADER the parser reads width, height,
// bits-per-pixel and compression from, and `pixelBytes` bytes of pixel data at `dataOffset`.
function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixelBytes: number,
	compression = 0,
): Buffer {
	const dataOffset = 54;
	const buf = Buffer.alloc(dataOffset + pixelBytes, 200);
	buf.write("BM", 0, "ascii");
	buf.writeUInt32LE(dataOffset, 10);
	buf.writeUInt32LE(40, 14);
	buf.writeInt32LE(width, 18);
	buf.writeInt32LE(height, 22);
	buf.writeUInt16LE(bitsPerPixel, 28);
	buf.writeUInt32LE(compression, 30);
	return buf;
}

// Buffer.alloc never shares the pool, so `buf.buffer` is exactly the bytes the test wrote.
function bytes(text: string, length = text.length): Buffer {
	const buf = Buffer.alloc(length);
	buf.write(text, 0, "ascii");
	return buf;
}

function parse(buf: Buffer) {
	return parseBmp(buf.buffer as ArrayBuffer, buf.byteOffset);
}

function isUserError(pattern: RegExp): (e: unknown) => boolean {
	return (e: unknown) => e instanceof UserError && pattern.test(e.message);
}

describe("parseBmp malformed input", () => {
	it("refuses an empty buffer and a wrong signature", () => {
		assert.throws(() => parse(Buffer.alloc(0)), isUserError(/BM/));
		assert.throws(() => parse(bytes("XX")), isUserError(/BM/));
	});

	it("refuses a file header cut short", () => {
		assert.throws(
			() => parse(bytes("BM", 8)),
			isUserError(/header is truncated/),
		);
	});

	it("refuses a DIB header cut short", () => {
		const buf = bytes("BM", 20);
		buf.writeUInt32LE(40, 14);
		assert.throws(() => parse(buf), isUserError(/header is truncated/));
	});

	it("refuses a DIB header too short to hold the depth", () => {
		const buf = buildBmp(2, 2, 8, 8);
		buf.writeUInt32LE(12, 14);
		assert.throws(() => parse(buf), isUserError(/header of 12 bytes is not supported/));
	});

	it("refuses a top-down image rather than reading it upside down", () => {
		assert.throws(
			() => parse(buildBmp(2, -2, 8, 8)),
			isUserError(/Top-down BMP/),
		);
	});

	it("refuses a depth no row can be read at", () => {
		assert.throws(() => parse(buildBmp(2, 2, 0, 8)), isUserError(/bits-per-pixel value 0 is not valid/));
		assert.throws(() => parse(buildBmp(2, 2, 3, 8)), isUserError(/bits-per-pixel value 3 is not valid/));
		assert.throws(() => parse(buildBmp(2, 2, 65535, 8)), isUserError(/bits-per-pixel value 65535 is not valid/));
	});

	it("refuses a compressed image", () => {
		assert.throws(
			() => parse(buildBmp(2, 2, 8, 8, 1)),
			isUserError(/Compressed BMP \(compression 1\)/),
		);
	});

	it("refuses dimensions over the supported maximum", () => {
		assert.throws(
			() => parse(buildBmp(65535, 65535, 8, 0)),
			isUserError(/65535x65535 exceeds the supported maximum/),
		);
	});

	it("refuses a zero height", () => {
		assert.throws(
			() => parse(buildBmp(4, 0, 8, 0)),
			isUserError(/is not valid/),
		);
	});

	it("refuses pixel data that overruns the buffer", () => {
		assert.throws(
			() => parse(buildBmp(4, 4, 8, 8)),
			isUserError(/pixel data .* exceeds buffer size/),
		);
	});

	it("refuses a pixel data offset past the end of the buffer", () => {
		const buf = buildBmp(2, 2, 8, 8);
		buf.writeUInt32LE(0xfffffff0, 10);
		assert.throws(() => parse(buf), isUserError(/exceeds buffer size/));
	});

	it("still parses a complete image", () => {
		const bmp = parse(buildBmp(2, 2, 8, 8));
		assert.strictEqual(bmp.width, 2);
		assert.strictEqual(bmp.height, 2);
		assert.strictEqual(bmp.bitsPerPixel, 8);
		assert.strictEqual(bmp.bytesPerRow, 4);
		assert.strictEqual(bmp.data.length, 8);
		assert.strictEqual(bmp.data[0], 200);
	});

	// A real header is 40 bytes; read as a field count it asked for 160, so any image under 174
	// bytes was "truncated". A 2x2 image is 62 bytes and has to parse.
	it("parses an image smaller than 174 bytes", () => {
		const buf = buildBmp(2, 2, 8, 8);
		assert.ok(buf.length < 174);
		assert.strictEqual(parse(buf).data.length, 8);
	});

	it("pads a 24-bit row to four bytes", () => {
		const bmp = parse(buildBmp(3, 2, 24, 24));
		assert.strictEqual(bmp.bytesPerRow, 12);
		assert.strictEqual(bmp.data.length, 24);
	});

	it("reads a header that stops before the compression field", () => {
		const buf = buildBmp(2, 2, 8, 8);
		buf.writeUInt32LE(16, 14);
		assert.strictEqual(parse(buf).bitsPerPixel, 8);
	});
});
