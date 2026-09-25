import {
	DDSHeader,
	HEADER_LENGTH_INT,
	DDS_MAGIC,
	DDPF_FOURCC,
	DDSCAPS2_CUBEMAP,
	DDSCAPS2_VOLUME,
	DDSCAPS_MIPMAP,
	DDSCAPS2_CUBEMAP_POSITIVEX,
	DDSCAPS2_CUBEMAP_NEGATIVEX,
	DDSCAPS2_CUBEMAP_POSITIVEY,
	DDSCAPS2_CUBEMAP_NEGATIVEY,
	DDSCAPS2_CUBEMAP_POSITIVEZ,
	DDSCAPS2_CUBEMAP_NEGATIVEZ,
	DDSHeaderDXT10,
	FOURCC_DX10,
	HEADER_DXT10_LENGTH_INT,
	DDS_RESOURCE_MISC_TEXTURECUBE,
	ResourceDimension,
} from "./typedef";
import { Surface } from "./surface";
import {
	convertPixelFormat,
	PixelFormat,
	getImageSizeInBytes,
} from "./pixelformat";
import { UserError } from "../../common";
import {
	assertImageDimensions,
	MAX_IMAGE_DIMENSION,
	MAX_IMAGE_PIXELS,
} from "../imagelimits";

export class DDS {
	private constructor(
		readonly header: DDSHeader,
		readonly headerDxt10: DDSHeaderDXT10 | undefined,
		readonly images: Surface[],
		readonly type: "texture" | "cubemap" | "volume",
		readonly arraySize: number,
		readonly mipmapCount: number,
	) {}

	public static parse(buffer: ArrayBuffer, byteOffset: number): DDS {
		if (
			!Number.isSafeInteger(byteOffset) ||
			byteOffset < 0 ||
			byteOffset + HEADER_LENGTH_INT * 4 > buffer.byteLength
		) {
			throw new UserError("DDS header is truncated");
		}
		const headerArray = new Int32Array(buffer, byteOffset, HEADER_LENGTH_INT);
		if (headerArray[0] !== DDS_MAGIC) {
			throw new UserError("Invalid magic number in DDS header");
		}

		const header = extractHeader(headerArray);
		assertImageDimensions(header.dwWidth, header.dwHeight, "DDS");
		if (
			(header.ddspf.dwFlags & DDPF_FOURCC) !== 0 &&
			header.ddspf.dwFourCC === FOURCC_DX10
		) {
			const dxt10Offset = byteOffset + HEADER_LENGTH_INT * 4;
			if (dxt10Offset + HEADER_DXT10_LENGTH_INT * 4 > buffer.byteLength) {
				throw new UserError("DDS DX10 header is truncated");
			}
			const dxt10HeaderArray = new Int32Array(
				buffer,
				dxt10Offset,
				HEADER_DXT10_LENGTH_INT,
			);
			const dxt10Header = extractDxt10Header(dxt10HeaderArray);
			return DDS.parseDxt10(buffer, byteOffset, header, dxt10Header);
		} else {
			return DDS.parseStandard(buffer, byteOffset, header);
		}
	}

	private static parseStandard(
		buffer: ArrayBuffer,
		byteOffset: number,
		header: DDSHeader,
	): DDS {
		const pixelFormat = convertPixelFormat(header.ddspf);

		const cubeMap = !!(header.dwCaps2 & DDSCAPS2_CUBEMAP);
		const volume = !!(header.dwCaps2 & DDSCAPS2_VOLUME);

		if (cubeMap && volume) {
			throw new UserError(
				"Cannot set DDSCAPS2_CUBEMAP and DDSCAPS2_VOLUME at same time",
			);
		}

		const mipmapCount = getMipmapCount(header);
		const offset = byteOffset + HEADER_LENGTH_INT * 4;

		let images: Surface[];
		if (cubeMap) {
			const cubeMaps: string[] = [];
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_POSITIVEX) {
				cubeMaps.push("X+");
			}
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_NEGATIVEX) {
				cubeMaps.push("X-");
			}
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_POSITIVEY) {
				cubeMaps.push("Y+");
			}
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_NEGATIVEY) {
				cubeMaps.push("Y-");
			}
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_POSITIVEZ) {
				cubeMaps.push("Z+");
			}
			if (header.dwCaps2 & DDSCAPS2_CUBEMAP_NEGATIVEZ) {
				cubeMaps.push("Z-");
			}

			validateSurfaceWork(
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				mipmapCount,
				1,
				cubeMaps.length,
			);
			[images] = parseCubeMap(
				buffer,
				offset,
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				cubeMaps,
				mipmapCount,
			);
		} else if (volume) {
			validateSurfaceWork(
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				mipmapCount,
				header.dwDepth,
				1,
			);
			[images] = parseVolumeTexture(
				buffer,
				offset,
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				header.dwDepth,
				mipmapCount,
			);
		} else {
			validateSurfaceWork(
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				mipmapCount,
				1,
				1,
			);
			[images] = parseTexture(
				buffer,
				offset,
				pixelFormat,
				header.dwWidth,
				header.dwHeight,
				mipmapCount,
			);
		}

		return new DDS(
			header,
			undefined,
			images,
			cubeMap ? "cubemap" : volume ? "volume" : "texture",
			1,
			mipmapCount,
		);
	}

	private static parseDxt10(
		buffer: ArrayBuffer,
		byteOffset: number,
		header: DDSHeader,
		dxt10Header: DDSHeaderDXT10,
	): DDS {
		const pixelFormat = convertPixelFormat(header.ddspf, dxt10Header);

		const cubeMap = !!(dxt10Header.miscFlag & DDS_RESOURCE_MISC_TEXTURECUBE);
		const volume =
			dxt10Header.resourceDimension ===
			ResourceDimension.DDS_DIMENSION_TEXTURE3D;

		if (cubeMap && volume) {
			throw new UserError(
				"Cannot set DDS_RESOURCE_MISC_TEXTURECUBE and use DDS_DIMENSION_TEXTURE3D at same time",
			);
		}

		const mipmapCount = getMipmapCount(header);
		const arraySize = dxt10Header.arraySize;
		if (volume && arraySize !== 1) {
			throw new UserError("DX10 volume textures must have one array item");
		}
		const height =
			dxt10Header.resourceDimension ===
			ResourceDimension.DDS_DIMENSION_TEXTURE1D
				? 1
				: header.dwHeight;
		const cubeMaps: string[] = ["X+", "X-", "Y+", "Y-", "Z+", "Z-"];
		validateSurfaceWork(
			pixelFormat,
			header.dwWidth,
			height,
			mipmapCount,
			volume ? header.dwDepth : 1,
			cubeMap ? cubeMaps.length : 1,
			arraySize,
		);
		let offset = byteOffset + (HEADER_LENGTH_INT + HEADER_DXT10_LENGTH_INT) * 4;

		const allImages: Surface[] = [];

		for (let i = 0; i < arraySize; i++) {
			let images: Surface[];
			if (cubeMap) {
				[images, offset] = parseCubeMap(
					buffer,
					offset,
					pixelFormat,
					header.dwWidth,
					height,
					cubeMaps,
					mipmapCount,
				);
			} else if (volume) {
				[images, offset] = parseVolumeTexture(
					buffer,
					offset,
					pixelFormat,
					header.dwWidth,
					height,
					header.dwDepth,
					mipmapCount,
				);
			} else {
				[images, offset] = parseTexture(
					buffer,
					offset,
					pixelFormat,
					header.dwWidth,
					height,
					mipmapCount,
				);
			}

			allImages.push(...images);
		}

		return new DDS(
			header,
			dxt10Header,
			allImages,
			cubeMap ? "cubemap" : volume ? "volume" : "texture",
			arraySize,
			mipmapCount,
		);
	}
}

function getMipmapCount(header: DDSHeader): number {
	if (!(header.dwCaps & DDSCAPS_MIPMAP)) {
		return 0;
	}
	if (!Number.isSafeInteger(header.dwMipMapCount) || header.dwMipMapCount < 1) {
		throw new UserError(
			`DDS mipmap count ${header.dwMipMapCount} is not valid`,
		);
	}
	return header.dwMipMapCount - 1;
}

function validateSurfaceWork(
	pixelFormat: PixelFormat,
	width: number,
	height: number,
	mipmapCount: number,
	depth: number,
	faces: number,
	arraySize: number = 1,
): void {
	assertImageDimensions(width, height, "DDS");
	validateCount(depth, "depth");
	validateCount(faces, "cubemap face count");
	validateCount(arraySize, "DX10 array size");
	if (
		mipmapCount < 0 ||
		mipmapCount > Math.floor(Math.log2(Math.max(width, height)))
	) {
		throw new UserError(
			`DDS mipmap count ${mipmapCount} is not valid for ${width}x${height}`,
		);
	}

	let totalPixels = 0;
	let levelWidth = width;
	let levelHeight = height;
	let levelDepth = depth;
	for (let level = 0; level <= mipmapCount; level++) {
		getImageSizeInBytes(pixelFormat, levelWidth, levelHeight);
		const levelPixels = checkedProduct(
			levelWidth,
			levelHeight,
			"DDS surface pixel count",
		);
		const surfacePixels = checkedProduct(
			checkedProduct(levelPixels, levelDepth, "DDS surface pixel count"),
			checkedProduct(faces, arraySize, "DDS surface count"),
			"DDS surface pixel count",
		);
		totalPixels = checkedSum(
			totalPixels,
			surfacePixels,
			"DDS decoded pixel work",
		);
		if (totalPixels > MAX_IMAGE_PIXELS) {
			throw new UserError(
				`DDS decoded surface pixel work ${totalPixels} exceeds the supported maximum (${MAX_IMAGE_PIXELS} pixels)`,
			);
		}
		levelWidth = Math.max(1, Math.floor(levelWidth / 2));
		levelHeight = Math.max(1, Math.floor(levelHeight / 2));
		levelDepth = Math.max(1, Math.floor(levelDepth / 2));
	}
}

function validateCount(value: number, name: string): void {
	if (
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > MAX_IMAGE_DIMENSION
	) {
		throw new UserError(`DDS ${name} ${value} is not valid`);
	}
}

function checkedProduct(left: number, right: number, name: string): number {
	if (
		!Number.isSafeInteger(left) ||
		!Number.isSafeInteger(right) ||
		left < 0 ||
		right < 0 ||
		(left !== 0 && right > Number.MAX_SAFE_INTEGER / left)
	) {
		throw new UserError(`${name} is too large`);
	}
	return left * right;
}

function checkedSum(left: number, right: number, name: string): number {
	if (
		!Number.isSafeInteger(left) ||
		!Number.isSafeInteger(right) ||
		left > Number.MAX_SAFE_INTEGER - right
	) {
		throw new UserError(`${name} is too large`);
	}
	return left + right;
}

function extractHeader(headerArray: Int32Array): DDSHeader {
	const value = (index: number): number => headerArray[index] ?? 0;
	return {
		dwFlags: value(2),
		dwHeight: value(3),
		dwWidth: value(4),
		dwPitchOrLinearSize: value(5),
		dwDepth: value(6),
		dwMipMapCount: value(7),
		ddspf: {
			dwFlags: value(20),
			dwFourCC: value(21),
			dwRGBBitCount: value(22),
			dwRBitMask: value(23),
			dwGBitMask: value(24),
			dwBBitMask: value(25),
			dwABitMask: value(26),
		},
		dwCaps: value(27),
		dwCaps2: value(28),
	};
}

function extractDxt10Header(dxt10HeaderArray: Int32Array): DDSHeaderDXT10 {
	const value = (index: number): number => dxt10HeaderArray[index] ?? 0;
	return {
		dxgiFormat: value(0),
		resourceDimension: value(1),
		miscFlag: value(2),
		arraySize: value(3),
		miscFlags2: value(4),
	};
}

function parseTexture(
	buffer: ArrayBuffer,
	offset: number,
	pixelFormat: PixelFormat,
	width: number,
	height: number,
	mipmapCount: number,
): [Surface[], number] {
	const result: Surface[] = [];

	offset = pushSurface(
		result,
		buffer,
		offset,
		width,
		height,
		pixelFormat,
		"Main image",
	);
	for (let i = 0; i < mipmapCount; i++) {
		width = Math.max(1, Math.floor(width / 2));
		height = Math.max(1, Math.floor(height / 2));
		offset = pushSurface(
			result,
			buffer,
			offset,
			width,
			height,
			pixelFormat,
			`Mipmap #${i + 1}`,
		);
	}

	return [result, offset];
}

function parseCubeMap(
	buffer: ArrayBuffer,
	offset: number,
	pixelFormat: PixelFormat,
	width: number,
	height: number,
	cubeMaps: string[],
	mipmapCount: number,
): [Surface[], number] {
	const result: Surface[] = [];

	for (const cubeMap of cubeMaps) {
		let mipWidth = width;
		let mipHeight = height;
		offset = pushSurface(
			result,
			buffer,
			offset,
			mipWidth,
			mipHeight,
			pixelFormat,
			cubeMap,
		);
		for (let i = 0; i < mipmapCount; i++) {
			mipWidth = Math.max(1, Math.floor(mipWidth / 2));
			mipHeight = Math.max(1, Math.floor(mipHeight / 2));
			offset = pushSurface(
				result,
				buffer,
				offset,
				mipWidth,
				mipHeight,
				pixelFormat,
				`Mipmap of ${cubeMap} #${i + 1}`,
			);
		}
	}

	return [result, offset];
}

function parseVolumeTexture(
	buffer: ArrayBuffer,
	offset: number,
	pixelFormat: PixelFormat,
	width: number,
	height: number,
	depth: number,
	mipmapCount: number,
): [Surface[], number] {
	const result: Surface[] = [];

	for (let i = 0; i < depth; i++) {
		offset = pushSurface(
			result,
			buffer,
			offset,
			width,
			height,
			pixelFormat,
			`Main image depth #${i + 1}`,
		);
	}

	for (let i = 0; i < mipmapCount; i++) {
		width = Math.max(1, Math.floor(width / 2));
		height = Math.max(1, Math.floor(height / 2));
		depth = Math.max(1, Math.floor(depth / 2));
		for (let j = 0; j < depth; j++) {
			offset = pushSurface(
				result,
				buffer,
				offset,
				width,
				height,
				pixelFormat,
				`Mipmap of #${i + 1} depth #${i + 1}`,
			);
		}
	}

	return [result, offset];
}

function pushSurface(
	surfaces: Surface[],
	buffer: ArrayBuffer,
	offset: number,
	width: number,
	height: number,
	pixelFormat: PixelFormat,
	name: string,
): number {
	const length = getImageSizeInBytes(pixelFormat, width, height);
	const end = offset + length;
	if (end > buffer.byteLength) {
		throw new UserError(
			`Image ${name} (start ${offset}, end ${end}) exceeds buffer size ${buffer.byteLength}`,
		);
	}

	surfaces.push(
		new Surface(buffer, offset, length, name, width, height, pixelFormat),
	);
	return end;
}
