import * as assert from "assert";
import {
	DDPF_ALPHA,
	DDPF_ALPHA_CHANNEL,
	DDPF_LUMINANCE,
	DDPF_RGB,
	DDPF_YUV,
	DDSCAPS_MIPMAP,
	DxgiFormat,
} from "../../../../../util/image/dds/typedef";
import { DdsFixture, decodeDds, f32, isUserError, makeDds, parseDds, u16, u32 } from "../../../dds";

type Rgba = [number, number, number, number];

describe("Surface.getFullRgba on uncompressed pixels", () => {
	// One row of pixels each; `expected` is what the format says those bytes mean, as r, g, b, a.
	const formats: [format: DxgiFormat, data: number[], expected: number[]][] = [
		[DxgiFormat.DXGI_FORMAT_R8G8B8A8_UNORM, [1, 2, 3, 4], [1, 2, 3, 4]],
		[DxgiFormat.DXGI_FORMAT_R8G8B8A8_UINT, [0, 255, 51, 255], [0, 255, 51, 255]],
		[DxgiFormat.DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, [128, 64, 255, 128], [128, 64, 255, 128]],
		[DxgiFormat.DXGI_FORMAT_R8G8B8A8_SNORM, [128, 192, 64, 127], [0, 0, 128, 255]],
		[DxgiFormat.DXGI_FORMAT_R8_SNORM, [128, 192, 64, 127], [0, 0, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255, 255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R8G8B8A8_SINT, [0, 127, 0, 127], [0, 255, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_B8G8R8A8_UNORM, [10, 20, 30, 40], [30, 20, 10, 40]],
		[DxgiFormat.DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, [10, 20, 30, 40], [30, 20, 10, 40]],
		[DxgiFormat.DXGI_FORMAT_B8G8R8X8_UNORM, [10, 20, 30, 99], [30, 20, 10, 255]],
		[DxgiFormat.DXGI_FORMAT_R16G16B16A16_UNORM, u16(0xffff, 0, 0x8080, 0xffff), [255, 0, 128, 255]],
		[DxgiFormat.DXGI_FORMAT_R16_SNORM, u16(0x8000, 0xc000, 0x4000, 0x7fff), [0, 0, 0, 255, 0, 0, 0, 255, 127, 0, 0, 255, 255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32B32A32_UINT, u32(0xffffffff, 0, 0, 0xffffffff), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32B32A32_SINT, u32(0x7fffffff, 0, 0, 0x7fffffff), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32B32A32_FLOAT, f32(1, 0, 0.2, 1), [255, 0, 51, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32B32_FLOAT, f32(0, 1, 0), [0, 255, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32_FLOAT, f32(1, 0.2), [255, 51, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32_FLOAT, f32(1), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R32G32B32A32_FLOAT, f32(1.5, -0.5, Infinity, NaN), [255, 0, 255, 0]],
		[DxgiFormat.DXGI_FORMAT_D32_FLOAT, f32(0.2), [51, 51, 51, 255]],
		[DxgiFormat.DXGI_FORMAT_R32_FLOAT_X8X24_TYPELESS, [...f32(1), 9, 9, 9, 9], [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R10G10B10A2_UNORM, u32(0xc00003ff), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R24_UNORM_X8_TYPELESS, u32(0x99ffffff), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R16G16_UNORM, u16(0xffff, 0), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R16_UNORM, u16(0xffff), [255, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_D16_UNORM, u16(0xffff), [255, 255, 255, 255]],
		[DxgiFormat.DXGI_FORMAT_R8G8_UNORM, [255, 51], [255, 51, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_R8_UNORM, [51], [51, 0, 0, 255]],
		[DxgiFormat.DXGI_FORMAT_A8_UNORM, [51], [255, 255, 255, 51]],
		[
			DxgiFormat.DXGI_FORMAT_B5G6R5_UNORM,
			u16(0xf800, 0x07e0, 0x001f),
			[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255],
		],
		[DxgiFormat.DXGI_FORMAT_B5G5R5A1_UNORM, u16(0xfc00, 0x03e0), [255, 0, 0, 255, 0, 255, 0, 0]],
		[DxgiFormat.DXGI_FORMAT_B4G4R4A4_UNORM, u16(0xff00, 0x00f0), [255, 0, 0, 255, 0, 255, 0, 0]],
	];
	for (const [format, data, expected] of formats) {
		it(`decodes ${DxgiFormat[format]}`, () => {
			assert.deepStrictEqual(decodeDds({ width: expected.length / 4, height: 1, data, dx10: { format } }), expected);
		});
	}

	const legacy: [name: string, fixture: Omit<DdsFixture, "height">, expected: number[]][] = [
		["A8R8G8B8", { width: 1, data: [10, 20, 30, 40] }, [30, 20, 10, 40]],
		["X8R8G8B8", { width: 1, flags: DDPF_RGB, data: [10, 20, 30, 99] }, [30, 20, 10, 255]],
		[
			"R8G8B8 in three-byte pixels",
			{ width: 2, flags: DDPF_RGB, bitsPerPixel: 24, data: [10, 20, 30, 40, 50, 60] },
			[30, 20, 10, 255, 60, 50, 40, 255],
		],
		[
			"R5G6B5",
			{ width: 1, flags: DDPF_RGB, bitsPerPixel: 16, masks: [0xf800, 0x07e0, 0x001f, 0], data: u16(0xf800) },
			[255, 0, 0, 255],
		],
		[
			"A4R4G4B4",
			{ width: 1, bitsPerPixel: 16, masks: [0x0f00, 0x00f0, 0x000f, 0xf000], data: u16(0xff00) },
			[255, 0, 0, 255],
		],
		[
			"L8",
			{ width: 2, flags: DDPF_LUMINANCE, bitsPerPixel: 8, masks: [0xff, 0, 0, 0], data: [0, 255] },
			[0, 0, 0, 255, 255, 255, 255, 255],
		],
		[
			"A8L8",
			{ width: 1, flags: DDPF_LUMINANCE | DDPF_ALPHA, bitsPerPixel: 16, masks: [0x00ff, 0, 0, 0xff00], data: [0x80, 0xff] },
			[128, 128, 128, 255],
		],
		[
			"A4L4",
			{ width: 1, flags: DDPF_LUMINANCE | DDPF_ALPHA, bitsPerPixel: 8, masks: [0x0f, 0, 0, 0xf0], data: [0xf0] },
			[0, 0, 0, 255],
		],
		["A8", { width: 1, flags: DDPF_ALPHA_CHANNEL, bitsPerPixel: 8, masks: [0, 0, 0, 0xff], data: [51] }, [255, 255, 255, 51]],
		[
			"four-bit alpha, two pixels to the byte",
			{ width: 2, flags: DDPF_ALPHA_CHANNEL, bitsPerPixel: 4, masks: [0, 0, 0, 0x0f], data: [0xf0] },
			[255, 255, 255, 0, 255, 255, 255, 255],
		],
		[
			"six-bit pixels that straddle bytes",
			{ width: 4, flags: DDPF_ALPHA_CHANNEL, bitsPerPixel: 6, masks: [0, 0, 0, 0x3f], data: [0x3f, 0xf0, 0x03] },
			[255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0],
		],
		[
			"two 12-bit channels across three bytes",
			{ width: 2, flags: DDPF_LUMINANCE | DDPF_ALPHA, bitsPerPixel: 24, masks: [0x000fff, 0, 0, 0xfff000], data: [0xff, 0x0f, 0x00, 0x00, 0xf0, 0xff] },
			[255, 255, 255, 0, 0, 0, 0, 255],
		],
		[
			"a 31-bit channel",
			{ width: 2, flags: DDPF_LUMINANCE, bitsPerPixel: 32, masks: [0x7fffffff, 0, 0, 0], data: u32(0x7fffffff, 0x80000000) },
			[255, 255, 255, 255, 0, 0, 0, 255],
		],
		[
			"a 32-bit channel in a 40-bit pixel",
			{ width: 1, flags: DDPF_LUMINANCE, bitsPerPixel: 40, masks: [0xffffffff, 0, 0, 0], data: [0xff, 0xff, 0xff, 0xff, 0] },
			[255, 255, 255, 255],
		],
		[
			"an RGB word with an unused leading byte",
			{
				width: 3,
				flags: DDPF_RGB,
				bitsPerPixel: 32,
				masks: [0xff000000, 0x00ff0000, 0x0000ff00, 0],
				data: [9, 30, 20, 10, 0, 0, 0, 128, 9, 30, 20, 10],
			},
			[10, 20, 30, 255, 128, 0, 0, 255, 10, 20, 30, 255],
		],
		[
			"a 16-bit channel behind an unused low halfword",
			{
				width: 2,
				flags: DDPF_LUMINANCE,
				bitsPerPixel: 32,
				masks: [0xffff0000, 0, 0, 0],
				data: u32(0x5a5a0000, 0xffff0000),
			},
			[90, 90, 90, 255, 255, 255, 255, 255],
		],
		[
			"twelve unused low bits before a 24-bit luminance sample",
			{
				width: 3,
				flags: DDPF_LUMINANCE,
				bitsPerPixel: 24,
				masks: [0xfff000, 0, 0, 0],
				data: [0, 0, 0, 0x00, 0xf0, 0xff, 0x00, 0x30, 0x33],
			},
			[0, 0, 0, 255, 255, 255, 255, 255, 51, 51, 51, 255],
		],
		[
			"eight-bit channels off the byte boundary of a 32-bit pixel",
			{
				width: 2,
				flags: DDPF_RGB,
				bitsPerPixel: 32,
				masks: [0xff0, 0xff000, 0xff00000, 0],
				data: u32(0x0efcdab0, 0x05634120),
			},
			[171, 205, 239, 255, 18, 52, 86, 255],
		],
	];
	for (const [name, fixture, expected] of legacy) {
		it(`decodes ${name} described by channel masks`, () => {
			assert.deepStrictEqual(decodeDds({ ...fixture, height: 1 }), expected);
		});
	}

	it("reads shifted 8-bit channels row after row", () => {
		assert.deepStrictEqual(
			decodeDds({
				width: 2,
				height: 2,
				flags: DDPF_RGB,
				masks: [0xff000000, 0x00ff0000, 0x0000ff00, 0],
				data: [9, 30, 20, 10, 0, 0, 0, 128, 1, 2, 3, 4, 5, 6, 7, 8],
			}),
			[10, 20, 30, 255, 128, 0, 0, 255, 4, 3, 2, 255, 8, 7, 6, 255],
		);
	});

	it("reads a channel shifted off the byte boundary when pixels are not whole bytes", () => {
		// Twelve-bit pixels put the second pixel mid-byte; each row still starts on a byte.
		assert.deepStrictEqual(
			decodeDds({
				width: 3,
				height: 2,
				flags: DDPF_ALPHA_CHANNEL,
				bitsPerPixel: 12,
				masks: [0, 0, 0, 0xf0],
				data: [0x50, 0x00, 0x05, 0x50, 0x00, 0xf0, 0x00, 0x0f, 0xf0, 0x00],
			}),
			[
				255, 255, 255, 85, 255, 255, 255, 85, 255, 255, 255, 85,
				255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
			],
		);
	});

	it("keeps every 8-bit value as it is", () => {
		const values = Array.from({ length: 256 }, (_, value) => value);
		const rgba = decodeDds({ width: 256, height: 1, data: values, dx10: { format: DxgiFormat.DXGI_FORMAT_R8_UNORM } });
		assert.deepStrictEqual(rgba.filter((_, index) => index % 4 === 0), values);
	});

	it("starts each row of sub-byte pixels on a new byte", () => {
		const rgba = decodeDds({
			width: 3,
			height: 2,
			flags: DDPF_ALPHA_CHANNEL,
			bitsPerPixel: 4,
			masks: [0, 0, 0, 0x0f],
			data: [0xf0, 0x0f, 0x0f, 0x00],
		});
		assert.deepStrictEqual(rgba.filter((_, index) => index % 4 === 3), [0, 255, 255, 255, 0, 0]);
	});

	const refused: [name: string, fixture: DdsFixture, message: RegExp][] = [
		[
			"a typeless format",
			{ width: 1, height: 1, data: 4, dx10: { format: DxgiFormat.DXGI_FORMAT_R8G8B8A8_TYPELESS } },
			/Can't get rgba from typeless pixel value/,
		],
		[
			"16-bit floats",
			{ width: 1, height: 1, data: 8, dx10: { format: DxgiFormat.DXGI_FORMAT_R16G16B16A16_FLOAT } },
			/float supports only 32 bits channel/,
		],
		["YUV channels", { width: 1, height: 1, data: 4, flags: DDPF_YUV }, /Channel format 2 is not supported to get rgba/],
		[
			"a block compression it has no decoder for",
			{ width: 4, height: 4, data: 8, dx10: { format: DxgiFormat.DXGI_FORMAT_BC4_UNORM } },
			/Compress format not implemented yet: bc4/,
		],
	];
	for (const [name, fixture, message] of refused) {
		it(`refuses ${name}`, () => {
			assert.throws(() => decodeDds(fixture), isUserError(message));
		});
	}
});

describe("Surface.getFullRgba on block-compressed pixels", () => {
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

	function decode(fourCC: string, width: number, height: number, blocks: number[][]): number[] {
		return decodeDds({ width, height, fourCC, data: blocks.flat() });
	}

	// A DXT1 block of color0 alone: color1 is 0 and every index is 0.
	function solid(color0: number): number[] {
		return [color0 & 0xff, color0 >> 8, 0, 0, 0, 0, 0, 0];
	}

	function fill(color: Rgba): Rgba[] {
		return new Array<Rgba>(16).fill(color);
	}

	// The pixels of one 4x4 block in row order, each index naming an entry of `palette`.
	function blockPixels(palette: Rgba[], indices: number[]): Rgba[] {
		return indices.map((i) => palette[i]!);
	}

	function withAlpha(pixels: Rgba[], alphas: number[]): Rgba[] {
		return pixels.map(([r, g, b], p) => [r, g, b, alphas[p]!]);
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

	it("decodes DXT1 in four-colour and in three-colour-plus-transparent mode", () => {
		assert.deepStrictEqual(
			decode("DXT1", 8, 4, [
				// color0 red > color1 blue: two interpolated colours.
				[0x00, 0xf8, 0x1f, 0x00, ...indexRows],
				// color0 blue <= color1 red: one midpoint and transparent black.
				[0x1f, 0x00, 0x00, 0xf8, ...indexRows],
			]),
			layoutBlocks(8, 4, [
				blockPixels([red, blue, [170, 0, 85, 255], [85, 0, 170, 255]], indicesOfRows),
				blockPixels([blue, red, [127, 0, 127, 255], [0, 0, 0, 0]], indicesOfRows),
			]),
		);
	});

	it("decodes DXT3 explicit alpha and always uses four colours", () => {
		assert.deepStrictEqual(
			decode("DXT3", 8, 4, [
				[
					// Four-bit alpha, lowest nibble first: pixel p has alpha p * 17.
					0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe,
					// color0 black <= color1 green still interpolates, as DXT3 has no
					// transparent colour.
					0x00, 0x00, 0xe0, 0x07, 0xe4, 0xe4, 0xe4, 0xe4,
				],
				[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...solid(0xf800)],
			]),
			layoutBlocks(8, 4, [
				withAlpha(
					blockPixels(
						[black, green, [0, 85, 0, 255], [0, 170, 0, 255]],
						[0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
					),
					Array.from({ length: 16 }, (_, p) => p * 17),
				),
				fill(red),
			]),
		);
	});

	it("decodes DXT5 interpolated alpha in eight-value and six-value mode", () => {
		const eightValue = [255, 0, 218, 182, 145, 109, 72, 36];
		// Six-value mode steps between its two ends in fifths, then adds clear and solid.
		const sixValue = [0, 255, 51, 102, 153, 204, 0, 255];
		assert.deepStrictEqual(
			decode("DXT5", 8, 4, [
				[255, 0, ...alphaIndexBytes, ...solid(0xffff)],
				[0, 255, ...alphaIndexBytes, ...solid(0x001f)],
			]),
			layoutBlocks(8, 4, [
				withAlpha(fill(white), Array.from({ length: 16 }, (_, p) => eightValue[p % 8]!)),
				withAlpha(fill(blue), Array.from({ length: 16 }, (_, p) => sixValue[p % 8]!)),
			]),
		);
	});

	// Red 4 of 31 is stored as 32. At a third alpha that is a colour of 96 before it was multiplied.
	const premultiplied = solid(0x2000);
	const cases: [fourCC: string, alpha: number[], expected: Rgba][] = [
		["DXT2", new Array<number>(8).fill(0x55), [96, 0, 0, 85]],
		["DXT2", new Array<number>(8).fill(0), [32, 0, 0, 0]],
		["DXT4", [85, 85, 0, 0, 0, 0, 0, 0], [96, 0, 0, 85]],
	];
	for (const [fourCC, alpha, expected] of cases) {
		it(`divides the alpha back out of a ${fourCC} colour with alpha ${expected[3]}`, () => {
			assert.deepStrictEqual(decode(fourCC, 4, 4, [[...alpha, ...premultiplied]]), fill(expected).flat());
		});
	}

	it("clips the edge blocks of a texture whose size is not a multiple of four", () => {
		assert.deepStrictEqual(
			decode("DXT1", 6, 6, [solid(0xf800), solid(0x001f), solid(0x07e0), solid(0xffff)]),
			layoutBlocks(6, 6, [fill(red), fill(blue), fill(green), fill(white)]),
		);
	});

	it("reads every level of a mipmapped texture from its own offset", () => {
		const dds = parseDds(
			makeDds({
				width: 8,
				height: 8,
				fourCC: "DXT1",
				mipmapCount: 4,
				caps: 0x1000 | DDSCAPS_MIPMAP,
				data: [
					...solid(0xf800),
					...solid(0xf800),
					...solid(0xf800),
					...solid(0xf800),
					...solid(0x07e0),
					// color0 red, color1 blue, each row 0,1,2,3: a 2x2 level keeps only 0,1.
					...[0x00, 0xf8, 0x1f, 0x00, 0xe4, 0xe4, 0xe4, 0xe4],
					...solid(0xffff),
				],
			}),
		);

		assert.deepStrictEqual(
			dds.images.map((image) => Array.from(image.getFullRgba())),
			[new Array<Rgba>(64).fill(red).flat(), fill(green).flat(), [...red, ...blue, ...red, ...blue], white],
		);
	});
});
