import * as assert from "assert";
import { parseBmp } from "../util/image/bmp/bmpparser";
import { UserError } from "../util/common";

// A minimal BMP: 14-byte file header, a DIB header the parser reads width, height and
// bits-per-pixel from, and `pixelBytes` bytes of pixel data at `dataOffset`.
function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixelBytes: number,
): Buffer {
	const dataOffset = 30;
	const buf = Buffer.alloc(dataOffset + pixelBytes, 200);
	buf.write("BM", 0, "ascii");
	buf.writeUInt32LE(dataOffset, 10);
	buf.writeUInt32LE(4, 14);
	buf.writeUInt32LE(width, 18);
	buf.writeUInt32LE(height, 22);
	buf.writeUInt16LE(bitsPerPixel, 28);
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
});
