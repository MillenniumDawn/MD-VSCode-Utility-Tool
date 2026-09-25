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
	pixelFormatFlags?: number;
	fourCC?: string;
}

const DDPF_FOURCC = 0x4;
const DDSCAPS_MIPMAP = 0x400000;
const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_VOLUME = 0x200000;
const DXGI_FORMAT_UNKNOWN = 0;
const DXGI_FORMAT_BC4_UNORM = 80;

function fourCC(code: string): number {
	return Buffer.from(code, "ascii").readInt32LE(0);
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
	if (options.fourCC !== undefined) {
		setInt(20, options.pixelFormatFlags ?? DDPF_FOURCC);
		setInt(21, fourCC(options.fourCC));
	} else {
		setInt(20, options.pixelFormatFlags ?? (0x40 | 0x1)); // ddspf.dwFlags: DDPF_RGB | DDPF_ALPHA
	}
	setInt(22, options.bitsPerPixel ?? 32); // dwRGBBitCount
	setInt(23, 0x00ff0000); // R mask
	setInt(24, 0x0000ff00); // G mask
	setInt(25, 0x000000ff); // B mask
	dv.setUint32(26 * 4, 0xff000000, true); // A mask
	setInt(27, options.caps ?? 0x1000); // dwCaps
	setInt(28, options.caps2 ?? 0); // dwCaps2
	return buf;
}

interface Dx10Options {
	arraySize?: number;
	dxgiFormat?: number;
	pixelBytes?: number;
	pixelFormatFlags?: number;
}

function makeDdsDx10Header(
	width: number,
	height: number,
	options: Dx10Options = {},
): Buffer {
	const buf = Buffer.alloc(148 + (options.pixelBytes ?? 0));
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const setInt = (intIndex: number, value: number) =>
		dv.setInt32(intIndex * 4, value, true);
	setInt(0, 0x20534444); // DDS magic 'DDS '
	setInt(1, 124); // dwSize
	setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // dwFlags: CAPS|HEIGHT|WIDTH|PIXELFORMAT
	setInt(3, height);
	setInt(4, width);
	setInt(19, 32); // ddspf.dwSize
	setInt(20, options.pixelFormatFlags ?? DDPF_FOURCC);
	setInt(21, fourCC("DX10"));
	setInt(27, 0x1000); // dwCaps: DDSCAPS_TEXTURE
	setInt(32, options.dxgiFormat ?? 28); // DXGI_FORMAT_R8G8B8A8_UNORM
	setInt(33, 3); // DDS_DIMENSION_TEXTURE2D
	setInt(35, options.arraySize ?? 1);
	return buf;
}

function parseDds(buf: Buffer): DDS {
	return DDS.parse(buf.buffer as ArrayBuffer, buf.byteOffset);
}

// A block-compressed DDS whose pixel data is `blocks`, in file order, after the 128-byte header.
function makeBlockDds(
	code: string,
	width: number,
	height: number,
	blocks: number[][],
	options: DdsOptions = {},
): Buffer {
	const data = Buffer.concat(blocks.map((block) => Buffer.from(block)));
	const buf = makeDdsHeader(width, height, data.length, {
		...options,
		fourCC: code,
	});
	data.copy(buf, 128);
	return buf;
}

type Rgba = [number, number, number, number];

// The pixels of one 4x4 block in row order, each index naming an entry of `palette`.
function blockPixels(palette: Rgba[], indices: number[]): Rgba[] {
	return indices.map((i) => palette[i]!);
}

// The decoder's flat width*height*4 output for 4x4 blocks laid out left to right, top to bottom.
function layoutBlocks(width: number, height: number, blocks: Rgba[][]): number[] {
	const out = new Array<number>(width * height * 4).fill(-1);
	const blocksPerRow = Math.ceil(width / 4);
	blocks.forEach((block, k) => {
		const x0 = (k % blocksPerRow) * 4;
		const y0 = Math.floor(k / blocksPerRow) * 4;
		block.forEach((pixel, p) => {
			const x = x0 + (p % 4);
			const y = y0 + Math.floor(p / 4);
			if (x < width && y < height) {
				out.splice((y * width + x) * 4, 4, ...pixel);
			}
		});
	});
	return out;
}

// A copy of the first `length` bytes in its own ArrayBuffer, so the parser sees the
// shortened length rather than the original allocation behind a subarray.
function truncate(buf: Buffer, length: number): Buffer {
	const out = Buffer.alloc(length);
	buf.copy(out, 0, 0, length);
	return out;
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
			() =>
				parseDds(
					makeDdsDx10Header(1, 1, { arraySize: MAX_IMAGE_DIMENSION + 1 }),
				),
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

describe("DDS malformed input", () => {
	it("refuses an empty buffer", () => {
		assert.throws(
			() => parseDds(Buffer.alloc(0)),
			isUserError(/header is truncated/),
		);
	});

	it("refuses a buffer shorter than the 128-byte header", () => {
		assert.throws(
			() => parseDds(Buffer.alloc(8)),
			isUserError(/header is truncated/),
		);
		assert.throws(
			() => parseDds(truncate(makeDdsHeader(2, 2, 16), 127)),
			isUserError(/header is truncated/),
		);
	});

	it("refuses a header with the wrong magic number", () => {
		const buf = makeDdsHeader(2, 2, 16);
		buf.write("PNG ", 0, "ascii");
		assert.throws(() => parseDds(buf), isUserError(/Invalid magic number/));
	});

	it("refuses an unknown FourCC", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(4, 4, 64, { fourCC: "ABCD" })),
			isUserError(/fourCC value not supported/),
		);
	});

	it("refuses pixel format flags that name no channel layout", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(2, 2, 16, { pixelFormatFlags: 0 })),
			isUserError(/Unknown pixel format flags/),
		);
	});

	it("refuses a DX10 header cut off after the standard header", () => {
		assert.throws(
			() => parseDds(truncate(makeDdsDx10Header(2, 2), 128)),
			isUserError(/DX10 header is truncated/),
		);
	});

	it("refuses an unsupported DXGI format", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsDx10Header(2, 2, { dxgiFormat: DXGI_FORMAT_UNKNOWN }),
				),
			isUserError(/Not supported DXGI format/),
		);
	});

	it("refuses a main image that overruns the buffer", () => {
		assert.throws(
			() => parseDds(makeDdsHeader(4, 4, 0)),
			isUserError(/Main image .* exceeds buffer size/),
		);
	});

	it("refuses a mipmap chain that overruns the buffer", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(4, 4, 64, {
						mipmapCount: 3,
						caps: 0x1000 | DDSCAPS_MIPMAP,
					}),
				),
			isUserError(/Mipmap #1 .* exceeds buffer size/),
		);
	});

	it("refuses a DXT1 mipmap chain that overruns the buffer", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(8, 8, 32, {
						fourCC: "DXT1",
						mipmapCount: 4,
						caps: 0x1000 | DDSCAPS_MIPMAP,
					}),
				),
			isUserError(/Mipmap #1 .* exceeds buffer size/),
		);
	});

	it("refuses a mipmap flag without a mipmap count", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(4, 4, 64, {
						mipmapCount: 0,
						caps: 0x1000 | DDSCAPS_MIPMAP,
					}),
				),
			isUserError(/mipmap count 0 is not valid/),
		);
	});

	it("refuses a texture flagged as both cubemap and volume", () => {
		assert.throws(
			() =>
				parseDds(
					makeDdsHeader(2, 2, 16, {
						caps2: DDSCAPS2_CUBEMAP | DDSCAPS2_VOLUME,
					}),
				),
			isUserError(/at same time/),
		);
	});

	it("reports an unimplemented block compression at decode time", () => {
		const dds = parseDds(
			makeDdsDx10Header(4, 4, {
				dxgiFormat: DXGI_FORMAT_BC4_UNORM,
				pixelBytes: 8,
			}),
		);
		assert.strictEqual(dds.images.length, 1);
		assert.throws(
			() => ddsToPng(dds),
			isUserError(/Compress format not implemented/),
		);
	});

	it("decodes a DX10 texture whose pixel format carries flags besides FourCC", () => {
		const buf = makeDdsDx10Header(2, 2, {
			pixelFormatFlags: DDPF_FOURCC | 0x1, // DDPF_ALPHAPIXELS
			pixelBytes: 16,
		});
		for (let i = 0; i < 16; i++) {
			buf[148 + i] = i + 1;
		}
		const png = ddsToPng(parseDds(buf));
		assert.strictEqual(png.width, 2);
		assert.strictEqual(png.height, 2);
		assert.deepStrictEqual(Array.from(png.data), Array.from(buf.subarray(148)));
	});

	it("still decodes a complete mipmap chain", () => {
		const dds = parseDds(
			makeDdsHeader(4, 4, 64 + 16 + 4, {
				mipmapCount: 3,
				caps: 0x1000 | DDSCAPS_MIPMAP,
			}),
		);
		assert.strictEqual(dds.images.length, 3);
		assert.strictEqual(ddsToPng(dds).width, 4);
	});
});

describe("DDS sub-byte pixel decode", () => {
	it("reads a 4-bit pixel from the high half of its byte", () => {
		const DDPF_ALPHA_CHANNEL = 0x2;
		const buf = makeDdsHeader(2, 1, 1, {
			bitsPerPixel: 4,
			pixelFormatFlags: DDPF_ALPHA_CHANNEL,
		});
		buf.writeUInt32LE(0x0f, 26 * 4); // alpha mask
		buf[128] = 0xf0; // pixel 0 in the low nibble, pixel 1 in the high nibble
		const rgba = parseDds(buf).images[0]?.getFullRgba();
		assert.ok(rgba);
		assert.strictEqual(rgba[3], 0);
		assert.strictEqual(rgba[7], 255);
	});
});

describe("DDS block-compressed decode", () => {
	const red: Rgba = [255, 0, 0, 255];
	const green: Rgba = [0, 255, 0, 255];
	const blue: Rgba = [0, 0, 255, 255];
	const white: Rgba = [255, 255, 255, 255];
	const black: Rgba = [0, 0, 0, 255];

	// Two-bit colour indices per row, lowest bits first: 0,1,2,3 / 3,2,1,0 / all 0 / all 1.
	const indexRows = [0xe4, 0x1b, 0x00, 0x55];
	const indicesOfRows = [0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1];

	// Three-bit alpha indices, lowest bits first: pixel p takes index p % 8.
	const alphaIndexBytes = [0x88, 0xc6, 0xfa, 0x88, 0xc6, 0xfa];

	// A DXT1 block of color0 alone: color1 is 0 and every index is 0.
	function solid(color0: number): number[] {
		return [color0 & 0xff, color0 >> 8, 0, 0, 0, 0, 0, 0];
	}

	function withAlpha(pixels: Rgba[], alphas: number[]): Rgba[] {
		return pixels.map(([r, g, b], p) => [r, g, b, alphas[p]!]);
	}

	it("decodes DXT1 in four-colour and in three-colour-plus-transparent mode", () => {
		const png = ddsToPng(
			parseDds(
				makeBlockDds("DXT1", 8, 4, [
					// color0 red > color1 blue: two interpolated colours.
					[0x00, 0xf8, 0x1f, 0x00, ...indexRows],
					// color0 blue <= color1 red: one midpoint and transparent black.
					[0x1f, 0x00, 0x00, 0xf8, ...indexRows],
				]),
			),
		);
		assert.deepStrictEqual(
			Array.from(png.data),
			layoutBlocks(8, 4, [
				blockPixels(
					[red, blue, [170, 0, 85, 255], [85, 0, 170, 255]],
					indicesOfRows,
				),
				blockPixels(
					[blue, red, [127, 0, 127, 255], [0, 0, 0, 0]],
					indicesOfRows,
				),
			]),
		);
	});

	it("decodes DXT3 explicit alpha and always uses four colours", () => {
		const png = ddsToPng(
			parseDds(
				makeBlockDds("DXT3", 8, 4, [
					[
						// Four-bit alpha, lowest nibble first: pixel p has alpha p * 17.
						0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe,
						// color0 black <= color1 green still interpolates, as DXT3 has no
						// transparent colour.
						0x00, 0x00, 0xe0, 0x07, 0xe4, 0xe4, 0xe4, 0xe4,
					],
					[
						0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
						0x00, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
					],
				]),
			),
		);
		assert.deepStrictEqual(
			Array.from(png.data),
			layoutBlocks(8, 4, [
				withAlpha(
					blockPixels(
						[black, green, [0, 85, 0, 255], [0, 170, 0, 255]],
						[0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
					),
					Array.from({ length: 16 }, (_, p) => p * 17),
				),
				blockPixels([red], new Array<number>(16).fill(0)),
			]),
		);
	});

	it("decodes DXT5 interpolated alpha in eight-value and six-value mode", () => {
		const png = ddsToPng(
			parseDds(
				makeBlockDds("DXT5", 8, 4, [
					[255, 0, ...alphaIndexBytes, 0xff, 0xff, 0x00, 0x00, 0, 0, 0, 0],
					[0, 255, ...alphaIndexBytes, 0x1f, 0x00, 0x00, 0x00, 0, 0, 0, 0],
				]),
			),
		);
		const eightValue = [255, 0, 218, 182, 145, 109, 72, 36];
		const sixValue = [0, 255, 36, 72, 109, 145, 0, 255];
		assert.deepStrictEqual(
			Array.from(png.data),
			layoutBlocks(8, 4, [
				withAlpha(
					blockPixels([white], new Array<number>(16).fill(0)),
					Array.from({ length: 16 }, (_, p) => eightValue[p % 8]!),
				),
				withAlpha(
					blockPixels([blue], new Array<number>(16).fill(0)),
					Array.from({ length: 16 }, (_, p) => sixValue[p % 8]!),
				),
			]),
		);
	});

	it("clips the edge blocks of a DXT1 texture whose size is not a multiple of four", () => {
		const png = ddsToPng(
			parseDds(
				makeBlockDds("DXT1", 6, 6, [
					solid(0xf800),
					solid(0x001f),
					solid(0x07e0),
					solid(0xffff),
				]),
			),
		);
		const fill = (color: Rgba): Rgba[] => new Array<Rgba>(16).fill(color);
		assert.deepStrictEqual(
			Array.from(png.data),
			layoutBlocks(6, 6, [fill(red), fill(blue), fill(green), fill(white)]),
		);
	});

	it("reads every level of a mipmapped DXT1 texture from its own offset", () => {
		const dds = parseDds(
			makeBlockDds(
				"DXT1",
				8,
				8,
				[
					solid(0xf800),
					solid(0xf800),
					solid(0xf800),
					solid(0xf800),
					solid(0x07e0),
					// color0 red, color1 blue, each row 0,1,2,3: a 2x2 level keeps only 0,1.
					[0x00, 0xf8, 0x1f, 0x00, 0xe4, 0xe4, 0xe4, 0xe4],
					solid(0xffff),
				],
				{ mipmapCount: 4, caps: 0x1000 | DDSCAPS_MIPMAP },
			),
		);

		assert.strictEqual(dds.mipmapCount, 3);
		assert.deepStrictEqual(
			dds.images.map((image) => [image.width, image.height]),
			[
				[8, 8],
				[4, 4],
				[2, 2],
				[1, 1],
			],
		);
		assert.deepStrictEqual(
			Array.from(ddsToPng(dds).data),
			new Array<Rgba>(64).fill(red).flat(),
		);
		assert.deepStrictEqual(
			Array.from(dds.images[1]!.getFullRgba()),
			new Array<Rgba>(16).fill(green).flat(),
		);
		assert.deepStrictEqual(Array.from(dds.images[2]!.getFullRgba()), [
			...red,
			...blue,
			...red,
			...blue,
		]);
		assert.deepStrictEqual(Array.from(dds.images[3]!.getFullRgba()), white);
	});
});

describe("TGA malformed input", () => {
	it("refuses an image type the decoder does not handle", () => {
		const buf = makeTgaHeader(2, 2);
		buf.writeInt8(1, 2); // colour-mapped
		const originalConsoleError = console.error;
		console.error = () => undefined;
		try {
			assert.throws(() => tgaToPng(buf), isUserError(/Unsupported tga format/));
		} finally {
			console.error = originalConsoleError;
		}
	});

	it("refuses a header with no image data", () => {
		const buf = makeTgaHeader(2, 2);
		buf.writeInt8(0, 2);
		assert.throws(() => tgaToPng(buf), isUserError(/Unsupported tga format/));
	});

	it("refuses a pixel depth the decoder does not handle", () => {
		const buf = Buffer.concat([makeTgaHeader(2, 2), Buffer.alloc(16)]);
		buf.writeInt8(12, 16);
		assert.throws(() => tgaToPng(buf), isUserError(/Unsupported tga format/));
	});

	it("refuses uncompressed pixel data cut short", () => {
		const buf = Buffer.concat([makeTgaHeader(2, 2), Buffer.alloc(8)]);
		assert.throws(
			() => tgaToPng(buf),
			isUserError(/pixel data is truncated/),
		);
	});

	it("refuses uncompressed greyscale pixel data cut short", () => {
		const buf = Buffer.concat([makeTgaHeader(2, 2), Buffer.alloc(3)]);
		buf.writeInt8(3, 2); // greyscale
		buf.writeInt8(8, 16);
		assert.throws(
			() => tgaToPng(buf),
			isUserError(/pixel data is truncated/),
		);
	});

	it("decodes uncompressed greyscale pixel data", () => {
		const buf = Buffer.concat([makeTgaHeader(2, 2), Buffer.from([1, 2, 3, 4])]);
		buf.writeInt8(3, 2); // greyscale
		buf.writeInt8(8, 16);
		const png = tgaToPng(buf);
		assert.strictEqual(png.width, 2);
		assert.strictEqual(png.height, 2);
		// Bottom-left origin, so the last two bytes are the top row.
		assert.deepStrictEqual(Array.from(png.data.subarray(0, 8)), [3, 3, 3, 255, 4, 4, 4, 255]);
	});

	it("keeps a fully transparent image transparent", () => {
		const buf = Buffer.concat([makeTgaHeader(1, 1), Buffer.from([10, 20, 30, 0])]);
		const png = tgaToPng(buf);
		assert.deepStrictEqual(Array.from(png.data), [30, 20, 10, 0]);
	});

	it("still decodes uncompressed pixel data of exactly the right length", () => {
		const buf = Buffer.concat([makeTgaHeader(2, 2), Buffer.alloc(16, 0x7f)]);
		const png = tgaToPng(buf);
		assert.strictEqual(png.width, 2);
		assert.strictEqual(png.height, 2);
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
