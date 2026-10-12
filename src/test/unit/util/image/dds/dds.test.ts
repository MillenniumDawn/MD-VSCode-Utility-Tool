import * as assert from "assert";
import { DDS } from "../../../../../util/image/dds";
import {
	DDSCAPS2_CUBEMAP,
	DDSCAPS2_CUBEMAP_NEGATIVEX,
	DDSCAPS2_CUBEMAP_NEGATIVEZ,
	DDSCAPS2_CUBEMAP_POSITIVEX,
	DDSCAPS2_VOLUME,
	DDSCAPS_MIPMAP,
	DDS_RESOURCE_MISC_TEXTURECUBE,
	DxgiFormat,
	ResourceDimension,
} from "../../../../../util/image/dds/typedef";
import { MAX_IMAGE_DIMENSION } from "../../../../../util/image/imagelimits";
import { DdsFixture, isUserError, makeDds, parseDds } from "../../../dds";

const mipmapped = 0x1000 | DDSCAPS_MIPMAP;
const allFaces = DDSCAPS2_CUBEMAP | 0xfc00;
const rgba8 = { format: DxgiFormat.DXGI_FORMAT_R8G8B8A8_UNORM };
const volume3d = ResourceDimension.DDS_DIMENSION_TEXTURE3D;
const faces = ["X+ 1x1", "X- 1x1", "Y+ 1x1", "Y- 1x1", "Z+ 1x1", "Z- 1x1"];

// The first `length` bytes in a buffer of their own, so the parser sees where the file ends.
function cut(buf: Buffer, length: number): Buffer {
	const out = Buffer.alloc(length);
	buf.copy(out, 0, 0, length);
	return out;
}

describe("DDS.parse", () => {
	// Pixels are four bytes each unless the fixture says otherwise.
	const layouts: [name: string, fixture: DdsFixture, surfaces: string[]][] = [
		["a plain texture", { width: 2, height: 2, data: 16 }, ["Main image 2x2"]],
		[
			"a mipmap chain",
			{ width: 4, height: 4, data: 64 + 16 + 4, mipmapCount: 3, caps: mipmapped },
			["Main image 4x4", "Mipmap #1 2x2", "Mipmap #2 1x1"],
		],
		[
			"a mipmap chain that reaches one pixel on one side first",
			{ width: 4, height: 1, data: 16 + 8 + 4, mipmapCount: 3, caps: mipmapped },
			["Main image 4x1", "Mipmap #1 2x1", "Mipmap #2 1x1"],
		],
		["a cubemap", { width: 1, height: 1, data: 24, caps2: allFaces }, faces],
		[
			"a cubemap with some of its faces",
			{
				width: 1,
				height: 1,
				data: 8,
				caps2: DDSCAPS2_CUBEMAP | DDSCAPS2_CUBEMAP_POSITIVEX | DDSCAPS2_CUBEMAP_NEGATIVEZ,
			},
			["X+ 1x1", "Z- 1x1"],
		],
		[
			"a mipmapped cubemap",
			{
				width: 2,
				height: 2,
				data: 2 * (16 + 4),
				mipmapCount: 2,
				caps: mipmapped,
				caps2: DDSCAPS2_CUBEMAP | DDSCAPS2_CUBEMAP_POSITIVEX | DDSCAPS2_CUBEMAP_NEGATIVEX,
			},
			["X+ 2x2", "Mipmap of X+ #1 1x1", "X- 2x2", "Mipmap of X- #1 1x1"],
		],
		[
			"a volume",
			{ width: 2, height: 2, depth: 2, data: 32, caps2: DDSCAPS2_VOLUME },
			["Main image depth #1 2x2", "Main image depth #2 2x2"],
		],
		[
			"a mipmapped volume, which halves its depth too",
			{ width: 4, height: 4, depth: 4, data: 4 * 64 + 2 * 16, mipmapCount: 2, caps: mipmapped, caps2: DDSCAPS2_VOLUME },
			[
				"Main image depth #1 4x4",
				"Main image depth #2 4x4",
				"Main image depth #3 4x4",
				"Main image depth #4 4x4",
				"Mipmap #1 depth #1 2x2",
				"Mipmap #1 depth #2 2x2",
			],
		],
		["a DX10 texture", { width: 2, height: 2, data: 16, dx10: rgba8 }, ["Main image 2x2"]],
		[
			"a DX10 texture array",
			{ width: 1, height: 1, data: 8, dx10: { ...rgba8, arraySize: 2 } },
			["Main image 1x1", "Main image 1x1"],
		],
		[
			"a DX10 cubemap",
			{ width: 1, height: 1, data: 24, dx10: { ...rgba8, miscFlag: DDS_RESOURCE_MISC_TEXTURECUBE } },
			faces,
		],
		[
			"a DX10 volume",
			{ width: 1, height: 1, depth: 2, data: 8, dx10: { ...rgba8, dimension: volume3d } },
			["Main image depth #1 1x1", "Main image depth #2 1x1"],
		],
		[
			"a DX10 one-dimensional texture, whatever height its header gives",
			{ width: 2, height: 7, data: 8, dx10: { ...rgba8, dimension: ResourceDimension.DDS_DIMENSION_TEXTURE1D } },
			["Main image 2x1"],
		],
	];
	for (const [name, fixture, surfaces] of layouts) {
		it(`lists the surfaces of ${name}`, () => {
			assert.deepStrictEqual(
				parseDds(makeDds(fixture)).images.map((image) => `${image.name} ${image.width}x${image.height}`),
				surfaces,
			);
		});
	}

	const refused: [name: string, fixture: DdsFixture, message: RegExp][] = [
		["a size over the limit", { width: 65535, height: 65535 }, /DDS image size 65535x65535 exceeds the supported maximum/],
		["a width with the top bit set", { width: 0x80000000, height: 2 }, /is not valid/],
		["a zero width", { width: 0, height: 2 }, /DDS image size 0x2 is not valid/],
		[
			"a volume depth over the limit",
			{ width: 1, height: 1, depth: MAX_IMAGE_DIMENSION + 1, caps2: DDSCAPS2_VOLUME },
			/DDS depth 16385 is not valid/,
		],
		["a volume with no depth", { width: 1, height: 1, caps2: DDSCAPS2_VOLUME }, /DDS depth 0 is not valid/],
		[
			"more mipmaps than the size has room for",
			{ width: 4, height: 4, mipmapCount: 100, caps: mipmapped },
			/DDS mipmap count 99 is not valid for 4x4/,
		],
		["a mipmap flag without a count", { width: 4, height: 4, data: 64, caps: mipmapped }, /DDS mipmap count 0 is not valid/],
		["an impossible pixel width", { width: 2, height: 2, bitsPerPixel: 0x7fffffff }, /DDS bits-per-pixel value 2147483647 is not valid/],
		[
			"a DX10 array over the limit",
			{ width: 1, height: 1, dx10: { ...rgba8, arraySize: MAX_IMAGE_DIMENSION + 1 } },
			/DDS DX10 array size 16385 is not valid/,
		],
		[
			"cubemap faces that add up past the pixel limit",
			{ width: 2048, height: 2048, caps2: allFaces },
			/DDS decoded surface pixel work 25165824 exceeds the supported maximum/,
		],
		["a cubemap with no faces", { width: 1, height: 1, caps2: DDSCAPS2_CUBEMAP }, /DDS cubemap face count 0 is not valid/],
		[
			"a cubemap that is also a volume",
			{ width: 2, height: 2, data: 16, caps2: DDSCAPS2_CUBEMAP | DDSCAPS2_VOLUME },
			/DDSCAPS2_CUBEMAP and DDSCAPS2_VOLUME at same time/,
		],
		[
			"a DX10 cubemap that is also a volume",
			{ width: 1, height: 1, dx10: { ...rgba8, miscFlag: DDS_RESOURCE_MISC_TEXTURECUBE, dimension: volume3d } },
			/DDS_RESOURCE_MISC_TEXTURECUBE and use DDS_DIMENSION_TEXTURE3D at same time/,
		],
		[
			"a DX10 array of volumes",
			{ width: 1, height: 1, depth: 1, dx10: { ...rgba8, dimension: volume3d, arraySize: 2 } },
			/DX10 volume textures must have one array item/,
		],
		["an unknown FourCC", { width: 4, height: 4, data: 64, fourCC: "ABCD" }, /fourCC value not supported/],
		["pixel format flags that name no layout", { width: 2, height: 2, data: 16, flags: 0 }, /Unknown pixel format flags 0/],
		[
			"an unsupported DXGI format",
			{ width: 2, height: 2, dx10: { format: DxgiFormat.DXGI_FORMAT_UNKNOWN } },
			/Not supported DXGI format DXGI_FORMAT_UNKNOWN \(0\)/,
		],
		["a main image past the end of the file", { width: 4, height: 4 }, /Image Main image \(start 128, end 192\) exceeds buffer size 128/],
		[
			"a mipmap past the end of the file",
			{ width: 4, height: 4, data: 64, mipmapCount: 3, caps: mipmapped },
			/Image Mipmap #1 \(start 192, end 208\) exceeds buffer size 192/,
		],
		[
			"a block-compressed mipmap past the end of the file",
			{ width: 8, height: 8, data: 32, fourCC: "DXT1", mipmapCount: 4, caps: mipmapped },
			/Image Mipmap #1 .* exceeds buffer size/,
		],
		[
			"a cubemap face past the end of the file",
			{ width: 1, height: 1, data: 4, caps2: allFaces },
			/Image X- .* exceeds buffer size/,
		],
		[
			"a volume slice past the end of the file",
			{ width: 2, height: 2, depth: 2, data: 16, caps2: DDSCAPS2_VOLUME },
			/Image Main image depth #2 .* exceeds buffer size/,
		],
	];
	for (const [name, fixture, message] of refused) {
		it(`refuses ${name}`, () => {
			assert.throws(() => parseDds(makeDds(fixture)), isUserError(message));
		});
	}

	it("refuses a file cut short of its header", () => {
		const file = makeDds({ width: 2, height: 2, data: 16 });
		for (const length of [0, 8, 127]) {
			assert.throws(() => parseDds(cut(file, length)), isUserError(/DDS header is truncated/), `${length} bytes`);
		}
		assert.throws(
			() => parseDds(cut(makeDds({ width: 2, height: 2, dx10: rgba8 }), 128)),
			isUserError(/DDS DX10 header is truncated/),
		);
	});

	it("refuses a wrong magic number", () => {
		const file = makeDds({ width: 2, height: 2, data: 16 });
		file.write("PNG ", 0, "ascii");
		assert.throws(() => parseDds(file), isUserError(/Invalid magic number in DDS header/));
	});

	it("reads a file that starts part-way into its buffer, and refuses a start outside it", () => {
		const file = makeDds({ width: 1, height: 1, data: [10, 20, 30, 40] });
		const padded = Buffer.alloc(8 + file.length);
		file.copy(padded, 8);
		const buffer = padded.buffer as ArrayBuffer;

		assert.deepStrictEqual(Array.from(DDS.parse(buffer, 8).images[0]!.getFullRgba()), [30, 20, 10, 40]);
		for (const offset of [-4, 1.5, 16, NaN]) {
			assert.throws(() => DDS.parse(buffer, offset), isUserError(/DDS header is truncated/), `offset ${offset}`);
		}
	});
});
