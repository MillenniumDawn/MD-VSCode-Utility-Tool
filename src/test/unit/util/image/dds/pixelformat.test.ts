import * as assert from "assert";
import {
	ChannelFormat,
	CompressFormat,
	convertPixelFormat,
	getImageSizeInBytes,
	PixelFormat,
	PixelValueType,
} from "../../../../../util/image/dds/pixelformat";
import {
	DDPF_ALPHA,
	DDPF_ALPHA_CHANNEL,
	DDPF_FOURCC,
	DDPF_LUMINANCE,
	DDPF_RGB,
	DDPF_YUV,
	DDSPixelFormat,
	DxgiFormat,
	ResourceDimension,
} from "../../../../../util/image/dds/typedef";
import { isUserError } from "../../../dds";

function header(fields: Partial<DDSPixelFormat>): DDSPixelFormat {
	return { dwFlags: 0, dwFourCC: 0, dwRGBBitCount: 0, dwRBitMask: 0, dwGBitMask: 0, dwBBitMask: 0, dwABitMask: 0, ...fields };
}

function convertFourCC(code: string): PixelFormat {
	return convertPixelFormat(header({ dwFlags: DDPF_FOURCC, dwFourCC: Buffer.from(code, "ascii").readInt32LE(0) }));
}

function convertDx10(dxgiFormat: DxgiFormat): PixelFormat {
	return convertPixelFormat(header({ dwFlags: DDPF_FOURCC }), {
		dxgiFormat,
		resourceDimension: ResourceDimension.DDS_DIMENSION_TEXTURE2D,
		miscFlag: 0,
		arraySize: 1,
		miscFlags2: 0,
	});
}

function convertMasks(bitsPerPixel: number, r: number, g: number, b: number, a: number): PixelFormat {
	return convertPixelFormat(
		header({ dwFlags: DDPF_RGB | DDPF_ALPHA, dwRGBBitCount: bitsPerPixel, dwRBitMask: r, dwGBitMask: g, dwBBitMask: b, dwABitMask: a }),
	);
}

describe("convertPixelFormat", () => {
	const fourCCs: [code: string, compressFormat: CompressFormat, alphaPremultiplied: boolean][] = [
		["DXT1", CompressFormat.bc1, false],
		["DXT2", CompressFormat.bc2, true],
		["DXT3", CompressFormat.bc2, false],
		["DXT4", CompressFormat.bc3, true],
		["DXT5", CompressFormat.bc3, false],
	];
	for (const [code, compressFormat, alphaPremultiplied] of fourCCs) {
		it(`reads FourCC ${code}`, () => {
			assert.deepStrictEqual(convertFourCC(code), {
				compressed: true,
				valueType: PixelValueType.uint,
				compressFormat,
				alphaPremultiplied,
			});
		});
	}

	const compressed: [format: DxgiFormat, compressFormat: CompressFormat, valueType: PixelValueType][] = [
		[DxgiFormat.DXGI_FORMAT_BC1_UNORM, CompressFormat.bc1, PixelValueType.unorm],
		[DxgiFormat.DXGI_FORMAT_BC2_UNORM_SRGB, CompressFormat.bc2, PixelValueType.unorm],
		[DxgiFormat.DXGI_FORMAT_BC3_TYPELESS, CompressFormat.bc3, PixelValueType.typeless],
		[DxgiFormat.DXGI_FORMAT_BC4_SNORM, CompressFormat.bc4, PixelValueType.snorm],
		[DxgiFormat.DXGI_FORMAT_BC5_UNORM, CompressFormat.bc5, PixelValueType.unorm],
		[DxgiFormat.DXGI_FORMAT_BC6H_TYPELESS, CompressFormat.bc6h, PixelValueType.typeless],
		[DxgiFormat.DXGI_FORMAT_BC7_TYPELESS, CompressFormat.bc7, PixelValueType.typeless],
		[DxgiFormat.DXGI_FORMAT_BC7_UNORM, CompressFormat.bc7, PixelValueType.unorm],
		[DxgiFormat.DXGI_FORMAT_BC7_UNORM_SRGB, CompressFormat.bc7, PixelValueType.unorm],
	];
	for (const [format, compressFormat, valueType] of compressed) {
		it(`maps ${DxgiFormat[format]} to its codec`, () => {
			assert.deepStrictEqual(convertDx10(format), { compressed: true, compressFormat, valueType, alphaPremultiplied: false });
		});
	}

	// A DXGI format's name spells out its layout: each channel from the lowest bit up with its
	// width, X for unused bits, then how the values read. The table has to agree with the name.
	it("lays out every uncompressed DXGI format the way its name says", () => {
		const plain = /^DXGI_FORMAT_((?:[RGBADX]\d+)+)_(TYPELESS|FLOAT|UINT|SINT|UNORM|SNORM)(_SRGB)?$/;
		let checked = 0;
		for (const [name, format] of Object.entries(DxgiFormat)) {
			const match = plain.exec(name);
			if (!match || typeof format !== "number") {
				continue;
			}
			let converted: PixelFormat;
			try {
				converted = convertDx10(format);
			} catch {
				continue; // a format the decoder does not support
			}

			const starts: Record<string, number> = {};
			const lengths: Record<string, number> = {};
			let bits = 0;
			for (const [, channel = "", width] of match[1]!.matchAll(/([A-Z])(\d+)/g)) {
				starts[channel] = bits;
				lengths[channel] = Number(width);
				bits += Number(width);
			}
			const channels = [..."RGBAD"].filter((channel) => channel in starts);

			assert.ok(!converted.compressed, name);
			assert.deepStrictEqual(
				{
					format: ChannelFormat[converted.channelFormat],
					valueType: PixelValueType[converted.valueType],
					bitsPerPixel: converted.bitsPerPixel,
					channelCount: converted.channelCount,
					starts: converted.channelStartInPixel,
					lengths: converted.channelLengthInPixel,
				},
				{
					format: channels.join("").toLowerCase(),
					valueType: match[2]!.toLowerCase(),
					bitsPerPixel: bits,
					channelCount: channels.length,
					starts: channels.map((channel) => starts[channel]),
					lengths: channels.map((channel) => lengths[channel]),
				},
				name,
			);
			checked++;
		}
		assert.ok(checked > 50, `only ${checked} formats were checked`);
	});

	it("reads a layout from channel masks, in whatever order they sit in the pixel", () => {
		assert.deepStrictEqual(convertMasks(16, 0x0f00, 0x00f0, 0x000f, 0xf000), {
			compressed: false,
			channelFormat: ChannelFormat.rgba,
			channelCount: 4,
			bitsPerPixel: 16,
			channelOrderInPixel: [2, 1, 0, 3],
			channelStartInPixel: [8, 4, 0, 12],
			channelLengthInPixel: [4, 4, 4, 4],
			valueType: PixelValueType.uint,
		});
	});

	// Alpha sits above whichever channels the flags name, so its mask moves with them.
	const channelNames: [flags: number, channels: string, alphaMask: number][] = [
		[DDPF_RGB, "rgb", 0],
		[DDPF_RGB | DDPF_ALPHA, "rgba", 0xff000000],
		[DDPF_YUV, "yuv", 0],
		[DDPF_YUV | DDPF_ALPHA, "yuva", 0xff000000],
		[DDPF_LUMINANCE, "l", 0],
		[DDPF_LUMINANCE | DDPF_ALPHA, "la", 0xff00],
		[DDPF_ALPHA_CHANNEL, "a", 0xff],
	];
	for (const [flags, channels, alphaMask] of channelNames) {
		it(`takes ${channels} channels from pixel format flags ${flags}`, () => {
			const format = convertPixelFormat(
				header({ dwFlags: flags, dwRGBBitCount: 32, dwRBitMask: 0xff, dwGBitMask: 0xff00, dwBBitMask: 0xff0000, dwABitMask: alphaMask }),
			);
			assert.ok(!format.compressed);
			assert.strictEqual(ChannelFormat[format.channelFormat], channels);
			assert.strictEqual(format.channelCount, channels.length);
		});
	}

	it("gives a channel with an empty mask no bits", () => {
		const format = convertPixelFormat(header({ dwFlags: DDPF_LUMINANCE, dwRGBBitCount: 8 }));
		assert.ok(!format.compressed);
		assert.deepStrictEqual([format.channelStartInPixel, format.channelLengthInPixel], [[0], [0]]);
	});

	const badMasks: [name: string, masks: [number, number, number, number, number], message: RegExp][] = [
		["a mask with a hole in it", [32, 0x00ff0000, 0x0000ff00, 0x000000f5, 0xff000000], /Not valid mask: 245/],
		["channels that leave a gap", [32, 0x00ff0000, 0x00000f00, 0x000000ff, 0xff000000], /Masks not compact: 255,3840,16711680,4278190080/],
		["channels that overlap", [32, 0x00ff0000, 0x0000ff00, 0x00000fff, 0xff000000], /Masks not compact/],
		["a channel past the end of the pixel", [16, 0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000], /Masks not compact/],
	];
	for (const [name, masks, message] of badMasks) {
		it(`refuses ${name}`, () => {
			assert.throws(() => convertMasks(...masks), isUserError(message));
		});
	}
});

describe("getImageSizeInBytes", () => {
	const bc1 = convertFourCC("DXT1");
	const bc3 = convertFourCC("DXT5");
	const raw = (bitsPerPixel: number) => ({ ...convertMasks(32, 0xff0000, 0xff00, 0xff, 0xff000000), bitsPerPixel }) as PixelFormat;

	const sizes: [name: string, format: PixelFormat, width: number, height: number, bytes: number][] = [
		["one block for a single DXT1 pixel", bc1, 1, 1, 8],
		["whole blocks for a DXT5 size that is not a multiple of four", bc3, 5, 5, 64],
		["four bytes per 32-bit pixel", raw(32), 3, 2, 24],
		["rows of three-byte pixels with no padding", raw(24), 3, 2, 18],
		["each row of sub-byte pixels rounded up to a byte", raw(4), 3, 2, 4],
	];
	for (const [name, format, width, height, bytes] of sizes) {
		it(`counts ${name}`, () => {
			assert.strictEqual(getImageSizeInBytes(format, width, height), bytes);
		});
	}

	for (const bitsPerPixel of [0, 129, 1.5]) {
		it(`refuses ${bitsPerPixel} bits per pixel`, () => {
			assert.throws(() => getImageSizeInBytes(raw(bitsPerPixel), 2, 2), isUserError(/bits-per-pixel value .* is not valid/));
		});
	}
});
