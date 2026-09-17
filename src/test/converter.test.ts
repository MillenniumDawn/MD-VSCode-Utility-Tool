import * as assert from "assert";
import { ddsToPng, tgaToPng } from "../util/image/converter";
import { DDS } from "../util/image/dds";
import {
	assertImageDimensions,
	MAX_IMAGE_DIMENSION,
	MAX_IMAGE_PIXELS,
} from "../util/image/imagelimits";
import { UserError } from "../util/common";

const TGA = require("tga") as typeof import("tga");

// A 128-byte uncompressed A8R8G8B8 DDS header claiming the given size, followed by `pixelBytes`
// bytes of pixel data. The dimension fields are written unsigned so a value with the top bit set
// reads back negative from the parser's Int32Array view, as it would from a hostile file.
interface DdsOptions {
	depth?: number;
	mipmapCount?: number;
	caps?: number;
	caps2?: number;
	bitsPerPixel?: number;
}

function makeDdsHeader(
	width: number,
	height: number,
	pixelBytes: number,
	options: DdsOptions = {},
): Buffer {
	const buf = Buffer.alloc(128 + pixelBytes);
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const setInt = (intIndex: number, value: number) =>
		dv.setInt32(intIndex * 4, value, true);
	setInt(0, 0x20534444); // DDS magic 'DDS '
	setInt(1, 124); // dwSize
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // dwFlags: CAPS|HEIGHT|WIDTH|PIXELFORMAT
	dv.setUint32(3 * 4, height, true);
	dv.setUint32(4 * 4, width, true);
	setInt(6, options.depth ?? 0); // dwDepth
	setInt(7, options.mipmapCount ?? 0); // dwMipMapCount
	setInt(19, 32); // ddspf.dwSize
	setInt(20, 0x40 | 0x1); // ddspf.dwFlags: DDPF_RGB | DDPF_ALPHA
	setInt(22, options.bitsPerPixel ?? 32); // dwRGBBitCount
	setInt(23, 0x00ff0000); // R mask
	setInt(24, 0x0000ff00); // G mask
	setInt(25, 0x000000ff); // B mask
	dv.setUint32(26 * 4, 0xff000000, true); // A mask
	setInt(27, options.caps ?? 0x1000); // dwCaps
	setInt(28, options.caps2 ?? 0); // dwCaps2
	return buf;
}

function makeDdsDx10Header(
	width: number,
	height: number,
	arraySize: number,
): Buffer {
	const buf = Buffer.alloc(148);
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const setInt = (intIndex: number, value: number) =>
		dv.setInt32(intIndex * 4, value, true);
	setInt(0, 0x20534444); // DDS magic 'DDS '
	setInt(1, 124); // dwSize
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // dwFlags: CAPS|HEIGHT|WIDTH|PIXELFORMAT
	setInt(3, height);
	setInt(4, width);
	setInt(19, 32); // ddspf.dwSize
	setInt(20, 0x4); // ddspf.dwFlags: DDPF_FOURCC
	setInt(21, 0x30315844); // DX10
	setInt(27, 0x1000); // dwCaps: DDSCAPS_TEXTURE
	setInt(32, 28); // DXGI_FORMAT_R8G8B8A8_UNORM
	setInt(33, 3); // DDS_DIMENSION_TEXTURE2D
	setInt(35, arraySize);
	return buf;
}

function parseDds(buf: Buffer): DDS {
	return DDS.parse(buf.buffer as ArrayBuffer, buf.byteOffset);
}

// A bare 18-byte uncompressed true-colour (type 2, 32 bpp) TGA header with no pixel data.
function makeTgaHeader(width: number, height: number): Buffer {
	const buf = Buffer.alloc(18);
	buf.writeInt8(2, 2);
	buf.writeUInt16LE(width, 12);
	buf.writeUInt16LE(height, 14);
	buf.writeInt8(32, 16);
	return buf;
}

function isUserError(pattern: RegExp): (e: unknown) => boolean {
	return (e: unknown) => e instanceof UserError && pattern.test(e.message);
}

describe("assertImageDimensions", () => {
	it("accepts a wide texture within the per-side and pixel bounds", () => {
		assert.doesNotThrow(() =>
			assertImageDimensions(MAX_IMAGE_DIMENSION, 1, "DDS"),
		);
	});

	it("rejects a side over the limit even when the pixel count is small", () => {
		assert.throws(
			() => assertImageDimensions(MAX_IMAGE_DIMENSION + 1, 1, "DDS"),
			isUserError(/exceeds the supported maximum/),
		);
	});

	it("accepts the pixel limit and rejects one pixel over it", () => {
		assert.doesNotThrow(() => assertImageDimensions(6000, 4000, "DDS"));
		assert.strictEqual(6000 * 4000, MAX_IMAGE_PIXELS);
		assert.throws(
			() => assertImageDimensions(6000, 4001, "DDS"),
			isUserError(/exceeds the supported maximum/),
		);
	});

	it("rejects zero and negative sides", () => {
		assert.throws(
			() => assertImageDimensions(0, 4, "TGA"),
			isUserError(/is not valid/),
		);
		assert.throws(
			() => assertImageDimensions(4, -4, "TGA"),
			isUserError(/is not valid/),
		);
	});
});

describe("DDS dimension bound", () => {
	it("refuses a header claiming 65535x65535 before touching the pixel data", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(65535, 65535, 0)),
			isUserError(/65535x65535 exceeds the supported maximum/),
		);
	});

	it("refuses a width that reads back negative from the Int32 header view", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(0x80000000, 2, 0)),
			isUserError(/is not valid/),
		);
	});

	it("refuses a zero width", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(0, 2, 0)),
			isUserError(/is not valid/),
		);
	});

	it("still decodes a small texture", () => {
		const png = ddsToPng(parseDds(makeDdsHeader(2, 2, 16)));
		assert.strictEqual(png.width, 2);
		assert.strictEqual(png.height, 2);
	});

	it("refuses malicious volume depth before entering the depth loop", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(1, 1, 0, {
						depth: MAX_IMAGE_DIMENSION + 1,
						caps2: 0x200000,
					}),
				),
			isUserError(/depth .* is not valid/),
		);
	});

	it("refuses an excessive mipmap count before entering the mip loop", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(4, 4, 0, {
						mipmapCount: 100,
						caps: 0x1000 | 0x400000,
					}),
				),
			isUserError(/mipmap count .* is not valid/),
		);
	});

	it("refuses impossible bits-per-pixel row sizing", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(2, 2, 0, { bitsPerPixel: 0x7fffffff })),
			isUserError(/bits-per-pixel value .* is not valid/),
		);
	});

	it("refuses DX10 arrays over the surface count bound", () => {
		assert.throws(
			() => parseDds(makeDdsDx10Header(1, 1, MAX_IMAGE_DIMENSION + 1)),
			isUserError(/DX10 array size .* is not valid/),
		);
	});

	it("refuses cubemap surface work over the aggregate pixel bound", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(2048, 2048, 0, {
						caps2: 0x200 | 0x400 | 0x800 | 0x1000 | 0x2000 | 0x4000 | 0x8000,
					}),
				),
			isUserError(/decoded surface pixel work .* exceeds/),
		);
	});
});

describe("TGA dimension bound", () => {
	it("refuses a header claiming 65535x65535 before the library allocates", () => {
		assert.throws(
			() => tgaToPng(makeTgaHeader(65535, 65535)),
			isUserError(/65535x65535 exceeds the supported maximum/),
		);
	});

	it("refuses a truncated header with a UserError rather than a read error", () => {
		assert.throws(() => tgaToPng(Buffer.alloc(10)), isUserError(/truncated/));
	});

	it("refuses a zero width", () => {
		assert.throws(
			() => tgaToPng(makeTgaHeader(0, 2)),
			isUserError(/is not valid/),
		);
	});

	it("still decodes a small image", () => {
		const rgba = [
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 128,
		];
		const png = tgaToPng(
			TGA.createTgaBuffer(2, 2, rgba as unknown as [], false),
		);
		assert.strictEqual(png.width, 2);
		assert.strictEqual(png.height, 2);
	});
});
