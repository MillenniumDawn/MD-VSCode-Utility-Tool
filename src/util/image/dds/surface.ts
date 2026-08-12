import {
	PixelFormat,
	RawPixelFormat,
	CompressedPixelFormat,
	getBlockSize,
	CompressFormat,
	PixelValueType,
	ChannelFormat,
	pixelFormatToString,
} from "./pixelformat";
import { UserError } from "../../common";

type Indexed<T> = Record<number, T>;

function arrayAt<T>(
	array: { readonly [index: number]: T | undefined },
	index: number,
): T {
	const value = array[index];
	if (value === undefined) {
		throw new UserError(`Array index ${index} is out of bounds`);
	}
	return value;
}

export class Surface {
	constructor(
		private readonly buffer: ArrayBuffer,
		private readonly offset: number,
		private readonly length: number,
		readonly name: string,
		readonly width: number,
		readonly height: number,
		readonly pixelFormat: PixelFormat,
	) {}

	public getFullRgba(): Uint8Array {
		if (!this.pixelFormat.compressed) {
			return this.getFullRgbaFromRawPixels(this.pixelFormat);
		} else {
			return this.getFullRgbaFromCompressedPixels(this.pixelFormat);
		}
	}

	private getFullRgbaFromRawPixels(pixelFormat: RawPixelFormat): Uint8Array {
		const valueType = pixelFormat.valueType;
		if (valueType === PixelValueType.typeless) {
			throw new UserError("Can't get rgba from typeless pixel value");
		}
		if (valueType === PixelValueType.shardedexp) {
			throw new UserError(
				"Pixel value type shardedexp are not supported to get rgba",
			);
		}
		if (pixelFormat.channelLengthInPixel.some((l) => l > 32)) {
			throw new UserError("Some channel length larger than 32");
		}
		if (valueType === PixelValueType.float) {
			if (
				pixelFormat.channelLengthInPixel.some((l) => l !== 32) ||
				pixelFormat.bitsPerPixel % 32 !== 0
			) {
				throw new UserError(
					"Pixel value type float supports only 32 bits channel and bitsPerPixel should be multiply of 32",
				);
			}
		}

		const channelFormat = pixelFormat.channelFormat;
		const resultPutter = resultPutters[channelFormat];
		if (resultPutter === undefined) {
			throw new UserError(
				`Channel format ${channelFormat} is not supported to get rgba`,
			);
		}

		const normalizer = pixelNormalizers[valueType];
		if (normalizer === undefined) {
			throw new UserError(
				`Value type ${valueType} is not supported to get rgba`,
			);
		}

		const length = this.length;
		const channelReader = getChannelReader(
			this.buffer,
			this.offset,
			length,
			pixelFormat,
		);
		if (channelReader === undefined) {
			throw new UserError(
				`Unsupported pixel format to read: ${pixelFormatToString(pixelFormat)}`,
			);
		}

		const readerState = channelReader.readerState;
		const reader = channelReader.reader;

		const channelCount = pixelFormat.channelCount;

		const result = new Uint8Array(this.width * this.height * 4);
		const pixel = new Float64Array(channelCount);
		const rawPixel = new Float64Array(channelCount);

		const channelOrder = pixelFormat.channelOrderInPixel as number[] &
			Indexed<number>;
		const channelLength = pixelFormat.channelLengthInPixel as number[] &
			Indexed<number>;
		const channelLengthByOrder = channelOrder.map(
			(channel) => channelLength[channel] ?? 0,
		) as number[] & Indexed<number>;
		const channelStartByOrder = channelOrder.map(
			(channel) => pixelFormat.channelStartInPixel[channel] ?? 0,
		) as number[] & Indexed<number>;
		const channelValueRange = channelLength.map((l) =>
			l === 32 ? 4294967295 : ((1 << l) - 1) & 0xffffffff,
		) as number[] & Indexed<number>;

		// It makes sense only when bitPerPixel <= 32.
		const channelMaskByOrder = channelOrder.map((channel) => {
			const length = channelLength[channel] ?? 0;
			const start = pixelFormat.channelStartInPixel[channel] ?? 0;
			return ((1 << length) - 1) << start;
		});

		const bitsPerPixel = pixelFormat.bitsPerPixel;
		const bitsPerRow = bitsPerPixel * this.width;
		const pitch = (bitsPerRow + 7) >>> 3;

		let resultOffset = 0;

		for (let i = 0; i < length; i += pitch) {
			for (let pb = 0; pb < bitsPerRow; pb += bitsPerPixel, resultOffset += 4) {
				reader(
					readerState,
					i + (pb >> 3),
					pb & 3,
					channelStartByOrder,
					channelLengthByOrder,
					channelMaskByOrder,
					rawPixel,
				);

				for (let j = 0; j < channelCount; j++) {
					const channel = channelOrder[j];
					if (channel === undefined) {
						continue;
					}
					const channelValue = arrayAt(rawPixel, j);
					pixel[channel] = normalizer(
						channelValue,
						arrayAt(channelValueRange, channel),
					);
				}

				resultPutter(result, resultOffset, pixel);
			}
		}

		return result;
	}

	private getFullRgbaFromCompressedPixels(
		pixelFormat: CompressedPixelFormat,
	): Uint8Array {
		const result = new Uint8Array(this.width * this.height * 4);
		const block = new Uint8Array(4 * 4 * 4);
		const length = this.length;
		const buffer = new Uint8Array(this.buffer, this.offset, length);
		const blockSize = getBlockSize(pixelFormat.compressFormat);
		const width = this.width;
		const height = this.height;
		const blocksPerLine = (width + 3) >> 2;

		for (let i = 0, k = 0; i < length; i += blockSize, k++) {
			switch (pixelFormat.compressFormat) {
				case CompressFormat.bc1:
					decompressDXT1(buffer, i, block);
					break;
				case CompressFormat.bc2:
					decompressDXT3(buffer, i, block);
					break;
				case CompressFormat.bc3:
					decompressDXT5(buffer, i, block);
					break;
				default:
					throw new UserError(
						"Compress format not implemented yet: bc" +
							pixelFormat.compressFormat,
					);
			}

			const xBlock = k % blocksPerLine;
			const yBlock = Math.floor(k / blocksPerLine);
			for (let y = yBlock * 4, yi = 0; y < height && yi < 4; y++, yi++) {
				for (let x = xBlock * 4, xi = 0; x < width && xi < 4; x++, xi++) {
					const index = (y * width + x) << 2;
					const indexInBlock = (yi * 4 + xi) << 2;
					for (let j = 0; j < 4; j++) {
						result[index + j] = arrayAt(block, indexInBlock + j);
						const alpha = arrayAt(block, indexInBlock + 3);
						if (pixelFormat.alphaPremultiplied && j !== 3 && alpha !== 0) {
							result[index + j] = arrayAt(result, index + j) / (alpha / 255);
						}
					}
				}
			}
		}

		return result;
	}
}

const colors = Array.from({ length: 8 }, () => new Uint8Array(4));
function r5g6b5ToRgb(value: number, result: Uint8Array): void {
	result[0] = Math.floor((((value & 0xf800) >> 11) * 255) / 0x1f);
	result[1] = Math.floor((((value & 0x07e0) >> 5) * 255) / 0x3f);
	result[2] = Math.floor(((value & 0x001f) * 255) / 0x1f);
	result[3] = 255;
}

function powerAverage(
	v1: Uint8Array,
	p1: number,
	v2: Uint8Array,
	p2: number,
	result: Uint8Array,
): void {
	for (let i = 0; i < v1.length; i++) {
		result[i] = Math.floor(arrayAt(v1, i) * p1 + arrayAt(v2, i) * p2);
	}
}

function decompressDXT1(
	buffer: Uint8Array,
	offset: number,
	block: Uint8Array,
	ignoreAlpha: boolean = false,
): void {
	const color0 = arrayAt(buffer, offset) | (arrayAt(buffer, offset + 1) << 8);
	const color1 =
		arrayAt(buffer, offset + 2) | (arrayAt(buffer, offset + 3) << 8);
	const color0Data = arrayAt(colors, 0);
	const color1Data = arrayAt(colors, 1);
	r5g6b5ToRgb(color0, color0Data);
	r5g6b5ToRgb(color1, color1Data);
	if (color0 > color1 || ignoreAlpha) {
		powerAverage(color0Data, 2 / 3, color1Data, 1 / 3, arrayAt(colors, 2));
		powerAverage(color0Data, 1 / 3, color1Data, 2 / 3, arrayAt(colors, 3));
	} else {
		powerAverage(color0Data, 1 / 2, color1Data, 1 / 2, arrayAt(colors, 2));
		arrayAt(colors, 3).fill(0);
	}

	for (let i = 4, k = 0; i < 8; i++, k += 16) {
		let v = arrayAt(buffer, offset + i);
		for (let j = 0; j < 4; j++) {
			const color = arrayAt(colors, v & 0x3);
			v >>= 2;
			for (let l = 0; l < 4; l++) {
				block[k + j * 4 + l] = arrayAt(color, l);
			}
		}
	}
}

function decompressDXT3(
	buffer: Uint8Array,
	offset: number,
	block: Uint8Array,
): void {
	decompressDXT1(buffer, offset + 8, block, true);

	for (let i = 0, k = 0; i < 8; i++, k += 8) {
		let v = arrayAt(buffer, offset + i);
		for (let j = 0; j < 2; j++) {
			const alpha = ((v & 0xf) * 255) / 0xf;
			v >>= 4;
			block[k + j * 4 + 3] = alpha;
		}
	}
}

const alphas = new Uint8Array(8);
function decompressDXT5(
	buffer: Uint8Array,
	offset: number,
	block: Uint8Array,
): void {
	decompressDXT1(buffer, offset + 8, block, true);

	alphas[0] = arrayAt(buffer, offset);
	alphas[1] = arrayAt(buffer, offset + 1);
	const alpha0 = arrayAt(alphas, 0);
	const alpha1 = arrayAt(alphas, 1);
	if (alpha0 > alpha1) {
		alphas[2] = Math.floor((6 * alpha0 + 1 * alpha1) / 7);
		alphas[3] = Math.floor((5 * alpha0 + 2 * alpha1) / 7);
		alphas[4] = Math.floor((4 * alpha0 + 3 * alpha1) / 7);
		alphas[5] = Math.floor((3 * alpha0 + 4 * alpha1) / 7);
		alphas[6] = Math.floor((2 * alpha0 + 5 * alpha1) / 7);
		alphas[7] = Math.floor((1 * alpha0 + 6 * alpha1) / 7);
	} else {
		alphas[2] = Math.floor((4 * alpha0 + 1 * alpha1) / 7);
		alphas[3] = Math.floor((3 * alpha0 + 2 * alpha1) / 7);
		alphas[4] = Math.floor((2 * alpha0 + 3 * alpha1) / 7);
		alphas[5] = Math.floor((1 * alpha0 + 4 * alpha1) / 7);
		alphas[6] = 0;
		alphas[7] = 255;
	}

	let v = 0;
	let bits = 0;
	let j = 0;
	for (let i = 2; i < 8; i++) {
		v |= arrayAt(buffer, offset + i) << bits;
		bits += 8;
		while (bits >= 3) {
			const alpha = arrayAt(alphas, v & 0x7);
			bits -= 3;
			v >>= 3;
			block[j + 3] = alpha;
			j += 4;
		}
	}
}

function readUnsignedBitsFromBuffer(
	buffer: Uint8Array,
	offset: number,
	bitOffset: number,
	bitsLength: number,
): number {
	let filled = 0;
	let rest = bitsLength;
	let result = 0;
	if (rest >= 8) {
		result |= arrayAt(buffer, offset) >> bitOffset;
		filled += 8 - bitOffset;
		rest -= 8 - bitOffset;
		bitOffset = 0;
		offset++;
	}
	while (rest >= 8) {
		result |= arrayAt(buffer, offset) << filled;
		filled += 8;
		rest -= 8;
		offset++;
	}
	if (rest > 0) {
		result |=
			((arrayAt(buffer, offset) >> bitOffset) & ((1 << rest) - 1)) << filled;
		filled += 8 - bitOffset;
		rest -= 8 - bitOffset;
		offset++;
	}
	if (rest > 0) {
		result |= (arrayAt(buffer, offset) & ((1 << rest) - 1)) << filled;
	}

	if (bitsLength === 32 && result < 0) {
		result += 4294967296; // In js this make number a float64
	}

	return result;
}

type ResultPutter = (
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
) => void;
const resultPutters: Partial<Record<ChannelFormat, ResultPutter>> = {
	[ChannelFormat.rgb]: rgbResultPutter,
	[ChannelFormat.rgba]: rgbaResultPutter,
	[ChannelFormat.l]: luminanceResultPutter,
	[ChannelFormat.la]: luminanceAlphaResultPutter,
	[ChannelFormat.a]: alphaResultPutter,
	[ChannelFormat.d]: luminanceResultPutter,
	[ChannelFormat.r]: rResultPutter,
	[ChannelFormat.g]: gResultPutter,
	[ChannelFormat.rg]: rgResultPutter,
};

function rResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = arrayAt(pixel, 0) * 255;
	result[offset + 1] = 0;
	result[offset + 2] = 0;
	result[offset + 3] = 255;
}

function gResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = 0;
	result[offset + 1] = arrayAt(pixel, 0) * 255;
	result[offset + 2] = 0;
	result[offset + 3] = 255;
}

function rgResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = arrayAt(pixel, 0) * 255;
	result[offset + 1] = arrayAt(pixel, 1) * 255;
	result[offset + 2] = 0;
	result[offset + 3] = 255;
}

function rgbResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = arrayAt(pixel, 0) * 255;
	result[offset + 1] = arrayAt(pixel, 1) * 255;
	result[offset + 2] = arrayAt(pixel, 2) * 255;
	result[offset + 3] = 255;
}

function rgbaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = arrayAt(pixel, 0) * 255;
	result[offset + 1] = arrayAt(pixel, 1) * 255;
	result[offset + 2] = arrayAt(pixel, 2) * 255;
	result[offset + 3] = arrayAt(pixel, 3) * 255;
}

function alphaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = result[offset + 1] = result[offset + 2] = 255;
	result[offset + 3] = arrayAt(pixel, 0) * 255;
}

function luminanceResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	const value = arrayAt(pixel, 0);
	result[offset] = result[offset + 1] = result[offset + 2] = value;
	result[offset + 3] = 255;
}

function luminanceAlphaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = result[offset + 1] = result[offset + 2] = arrayAt(pixel, 0);
	result[offset + 3] = arrayAt(pixel, 1);
}

type PixelNormalizer = (value: number, max: number) => number;
const pixelNormalizers: Partial<Record<PixelValueType, PixelNormalizer>> = {
	[PixelValueType.uint]: uintNormalizer,
	[PixelValueType.unorm]: uintNormalizer,
	[PixelValueType.unorm_srgb]: unormSrgbNormalizer,
	[PixelValueType.sint]: sintNormalizer,
	[PixelValueType.snorm]: sintNormalizer,
	[PixelValueType.float]: floatNormalizer,
};

function uintNormalizer(value: number, max: number): number {
	return value / max;
}

function sintNormalizer(value: number, max: number): number {
	const midValue = (max - 1) / 2;
	return value === midValue + 1
		? -1
		: value <= midValue
			? value / midValue
			: -(max - value + 1) / midValue;
}

function floatNormalizer(value: number, _max: number): number {
	return value;
}

function unormSrgbNormalizer(value: number, max: number): number {
	return Math.pow(value / max, 2.2);
}

// Don't use js clossure for better performance
interface ChannelReader {
	reader: (
		buffer: any,
		offset: number,
		bitOffset: number,
		channelStart: number[],
		channelLength: number[],
		channelMask: number[],
		rawPixel: Float64Array,
	) => void;
	readerState: unknown;
}
function getChannelReader(
	inputBuffer: ArrayBuffer,
	inputBufferOffset: number,
	length: number,
	pixelFormat: RawPixelFormat,
): ChannelReader | undefined {
	if (pixelFormat.valueType === PixelValueType.float) {
		if (
			pixelFormat.channelLengthInPixel.every((p) => p === 32) &&
			pixelFormat.bitsPerPixel % 8 === 0
		) {
			return {
				reader: all32Reader,
				readerState: new Float32Array(
					inputBuffer,
					inputBufferOffset,
					length >> 2,
				),
			};
		}

		return undefined;
	}

	if (pixelFormat.bitsPerPixel % 32 === 0) {
		if (pixelFormat.channelLengthInPixel.every((p) => p === 32)) {
			return {
				reader: all32Reader,
				readerState: new Uint32Array(
					inputBuffer,
					inputBufferOffset,
					length >> 2,
				),
			};
		}
	}

	if (pixelFormat.bitsPerPixel % 16 === 0) {
		if (pixelFormat.channelLengthInPixel.every((p) => p === 16)) {
			return {
				reader: all16Reader,
				readerState: new Uint16Array(
					inputBuffer,
					inputBufferOffset,
					length >> 1,
				),
			};
		}
	}

	if (pixelFormat.bitsPerPixel % 8 === 0) {
		if (pixelFormat.channelLengthInPixel.every((p) => p === 8)) {
			return {
				reader: all8Reader,
				readerState: new Uint8Array(inputBuffer, inputBufferOffset, length),
			};
		}
	}

	if (pixelFormat.bitsPerPixel === 32) {
		return {
			reader: masked32Reader,
			readerState: new Uint32Array(inputBuffer, inputBufferOffset, length >> 2),
		};
	}

	if (pixelFormat.bitsPerPixel === 16) {
		return {
			reader: masked16Reader,
			readerState: new Uint16Array(inputBuffer, inputBufferOffset, length >> 1),
		};
	}

	if (pixelFormat.bitsPerPixel === 8) {
		return {
			reader: masked8Reader,
			readerState: new Uint8Array(inputBuffer, inputBufferOffset, length),
		};
	}

	return {
		reader: defaultUint8Reader,
		readerState: new Uint8Array(inputBuffer, inputBufferOffset, length),
	};
}

function defaultUint8Reader(
	buffer: Uint8Array,
	offset: number,
	bitOffset: number,
	_channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	for (let i = 0; i < channelLength.length; i++) {
		const bitCount = channelLength[i];
		if (bitCount === undefined) {
			continue;
		}
		rawPixel[i] = readUnsignedBitsFromBuffer(
			buffer,
			offset,
			bitOffset,
			bitCount,
		);
		offset += (bitOffset + bitCount) >> 3;
		bitOffset = (bitOffset + bitCount) & 7;
	}
}

function all8Reader(
	buffer: Uint8Array,
	offset: number,
	_bitOffset: number,
	_channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = arrayAt(buffer, offset + i);
	}
}

function all16Reader(
	buffer: Uint16Array,
	offset: number,
	_bitOffset: number,
	_channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = arrayAt(buffer, (offset >> 1) + i);
	}
}

function all32Reader(
	buffer: Float32Array | Uint32Array,
	offset: number,
	_bitOffset: number,
	_channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = arrayAt(buffer, (offset >> 2) + i);
	}
}

function masked8Reader(
	buffer: Uint8Array,
	offset: number,
	_bitOffset: number,
	channelStart: number[],
	channelLength: number[],
	channelMask: number[],
	rawPixel: Float64Array,
): void {
	const v = arrayAt(buffer, offset);
	for (let i = 0; i < channelLength.length; i++) {
		const mask = channelMask[i];
		const start = channelStart[i];
		if (mask === undefined || start === undefined) {
			continue;
		}
		rawPixel[i] = (v & mask) >>> start;
	}
}

function masked16Reader(
	buffer: Uint16Array,
	offset: number,
	_bitOffset: number,
	channelStart: number[],
	channelLength: number[],
	channelMask: number[],
	rawPixel: Float64Array,
): void {
	const v = arrayAt(buffer, offset >> 1);
	for (let i = 0; i < channelLength.length; i++) {
		const mask = channelMask[i];
		const start = channelStart[i];
		if (mask === undefined || start === undefined) {
			continue;
		}
		rawPixel[i] = (v & mask) >>> start;
	}
}

function masked32Reader(
	buffer: Uint32Array,
	offset: number,
	_bitOffset: number,
	channelStart: number[],
	channelLength: number[],
	channelMask: number[],
	rawPixel: Float64Array,
): void {
	const v = arrayAt(buffer, offset >> 2);
	for (let i = 0; i < channelLength.length; i++) {
		const mask = channelMask[i];
		const start = channelStart[i];
		if (mask === undefined || start === undefined) {
			continue;
		}
		rawPixel[i] = (v & mask) >>> start;
	}
}
