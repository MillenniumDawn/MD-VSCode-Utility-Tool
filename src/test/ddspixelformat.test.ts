import * as assert from "assert";
import {
	CompressFormat,
	convertPixelFormat,
	PixelValueType,
} from "../util/image/dds/pixelformat";
import {
	DDPF_FOURCC,
	DxgiFormat,
	FOURCC_DX10,
	ResourceDimension,
} from "../util/image/dds/typedef";

function convertDx10(dxgiFormat: DxgiFormat) {
	return convertPixelFormat(
		{
			dwFlags: DDPF_FOURCC,
			dwFourCC: FOURCC_DX10,
			dwRGBBitCount: 0,
			dwRBitMask: 0,
			dwGBitMask: 0,
			dwBBitMask: 0,
			dwABitMask: 0,
		},
		{
			dxgiFormat,
			resourceDimension: ResourceDimension.DDS_DIMENSION_TEXTURE2D,
			miscFlag: 0,
			arraySize: 1,
			miscFlags2: 0,
		},
	);
}

describe("DX10 compressed pixel formats", () => {
	it("maps every BC7 format to the BC7 codec", () => {
		const cases: [DxgiFormat, PixelValueType][] = [
			[DxgiFormat.DXGI_FORMAT_BC7_TYPELESS, PixelValueType.typeless],
			[DxgiFormat.DXGI_FORMAT_BC7_UNORM, PixelValueType.unorm],
			[DxgiFormat.DXGI_FORMAT_BC7_UNORM_SRGB, PixelValueType.unorm_srgb],
		];
		for (const [dxgiFormat, valueType] of cases) {
			const format = convertDx10(dxgiFormat);
			assert.ok(format.compressed, DxgiFormat[dxgiFormat]);
			assert.strictEqual(format.compressFormat, CompressFormat.bc7, DxgiFormat[dxgiFormat]);
			assert.strictEqual(format.valueType, valueType, DxgiFormat[dxgiFormat]);
		}
	});

	it("keeps BC6H on the BC6H codec", () => {
		const format = convertDx10(DxgiFormat.DXGI_FORMAT_BC6H_TYPELESS);
		assert.ok(format.compressed);
		assert.strictEqual(format.compressFormat, CompressFormat.bc6h);
	});
});
