import {
	PixelFormat,
	RawPixelFormat,
	CompressedPixelFormat,
	getBlockSize,
	CompressFormat,
	PixelValueType,
	ChannelFormat,
} from "./pixelformat";
import { UserError } from "../../common";

// Every index below is in range by construction: a surface is as long as its size and format
// say, and DDS.parse checked that the file holds that many bytes. Hence the `!` on each read.
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
		const normalizer = pixelNormalizers[valueType];
		if (normalizer === undefined) {
			throw new UserError("Can't get rgba from typeless pixel value");
		}
		if (
			valueType === PixelValueType.float &&
			pixelFormat.channelLengthInPixel.some((l) => l !== 32)
		) {
			throw new UserError("Pixel value type float supports only 32 bits channel");
		}

		const channelFormat = pixelFormat.channelFormat;
		const resultPutter = resultPutters[channelFormat];
		if (resultPutter === undefined) {
			throw new UserError(
				`Channel format ${channelFormat} is not supported to get rgba`,
			);
		}

		const length = this.length;
		const { reader, readerState } = getChannelReader(
			this.buffer,
			this.offset,
			length,
			pixelFormat,
		);

		const channelCount = pixelFormat.channelCount;

		const result = new Uint8Array(this.width * this.height * 4);
		// An rgb pixel never writes channel 3, so its alpha stays 1 and it shares the rgba putter.
		const pixel = new Float64Array(Math.max(channelCount, 4));
		pixel[3] = 1;
		const rawPixel = new Float64Array(channelCount);

		const channelOrder = pixelFormat.channelOrderInPixel;
		const channelLength = pixelFormat.channelLengthInPixel;
		const channelStart = pixelFormat.channelStartInPixel;
		const channelLengthByOrder = channelOrder.map((channel) => channelLength[channel]!);
		const channelStartByOrder = channelOrder.map((channel) => channelStart[channel]!);
		const channelValueRange = channelLength.map((l) => 2 ** l - 1);

		// It makes sense only when bitPerPixel <= 32.
		const channelMaskByOrder = channelOrder.map(
			(channel) => ((1 << channelLength[channel]!) - 1) << channelStart[channel]!,
		);

		const bitsPerPixel = pixelFormat.bitsPerPixel;
		const bitsPerRow = bitsPerPixel * this.width;
		const pitch = Math.ceil(bitsPerRow / 8);

		let resultOffset = 0;

		for (let i = 0; i < length; i += pitch) {
			for (let pb = 0; pb < bitsPerRow; pb += bitsPerPixel, resultOffset += 4) {
				reader(
					readerState,
					i + (pb >> 3),
					pb & 7,
					channelStartByOrder,
					channelLengthByOrder,
					channelMaskByOrder,
					rawPixel,
				);

				for (let j = 0; j < channelCount; j++) {
					const channel = channelOrder[j]!;
					pixel[channel] = normalizer(rawPixel[j]!, channelValueRange[channel]!);
				}

				resultPutter(result, resultOffset, pixel);
			}
		}

		return result;
	}

	private getFullRgbaFromCompressedPixels(
		pixelFormat: CompressedPixelFormat,
	): Uint8Array {
		const decompress = blockDecoders[pixelFormat.compressFormat];
		if (decompress === undefined) {
			throw new UserError(
				"Compress format not implemented yet: bc" + pixelFormat.compressFormat,
			);
		}

		const result = new Uint8Array(this.width * this.height * 4);
		const block = new Uint8Array(4 * 4 * 4);
		const length = this.length;
		const buffer = new Uint8Array(this.buffer, this.offset, length);
		const blockSize = getBlockSize(pixelFormat.compressFormat);
		const width = this.width;
		const height = this.height;
		const blocksPerLine = Math.ceil(width / 4);
		const premultiplied = pixelFormat.alphaPremultiplied;

		for (let i = 0, k = 0; i < length; i += blockSize, k++) {
			decompress(buffer, i, block);

			const xBlock = k % blocksPerLine;
			const yBlock = Math.floor(k / blocksPerLine);
			for (let y = yBlock * 4, yi = 0; y < height && yi < 4; y++, yi++) {
				for (let x = xBlock * 4, xi = 0; x < width && xi < 4; x++, xi++) {
					const index = (y * width + x) << 2;
					const indexInBlock = (yi * 4 + xi) << 2;
					const alpha = block[indexInBlock + 3]!;
					const unmultiply = premultiplied && alpha !== 0;
					for (let j = 0; j < 3; j++) {
						const value = block[indexInBlock + j]!;
						result[index + j] = unmultiply ? value / (alpha / 255) : value;
					}
					result[index + 3] = alpha;
				}
			}
		}

		return result;
	}
}

type BlockDecoder = (buffer: Uint8Array, offset: number, block: Uint8Array) => void;
const blockDecoders: Partial<Record<CompressFormat, BlockDecoder>> = {
	[CompressFormat.bc1]: decompressDXT1,
	[CompressFormat.bc2]: decompressDXT3,
	[CompressFormat.bc3]: decompressDXT5,
};

const colors = Array.from({ length: 4 }, () => new Uint8Array(4));
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
		result[i] = Math.floor(v1[i]! * p1 + v2[i]! * p2);
	}
}

function decompressDXT1(
	buffer: Uint8Array,
	offset: number,
	block: Uint8Array,
	ignoreAlpha: boolean = false,
): void {
	const color0 = buffer[offset]! | (buffer[offset + 1]! << 8);
	const color1 = buffer[offset + 2]! | (buffer[offset + 3]! << 8);
	const [color0Data, color1Data, color2Data, color3Data] = colors as [
		Uint8Array,
		Uint8Array,
		Uint8Array,
		Uint8Array,
	];
	r5g6b5ToRgb(color0, color0Data);
	r5g6b5ToRgb(color1, color1Data);
	if (color0 > color1 || ignoreAlpha) {
		powerAverage(color0Data, 2 / 3, color1Data, 1 / 3, color2Data);
		powerAverage(color0Data, 1 / 3, color1Data, 2 / 3, color3Data);
	} else {
		powerAverage(color0Data, 1 / 2, color1Data, 1 / 2, color2Data);
		color3Data.fill(0);
	}

	for (let i = 4, k = 0; i < 8; i++, k += 16) {
		let v = buffer[offset + i]!;
		for (let j = 0; j < 4; j++) {
			const color = colors[v & 0x3]!;
			v >>= 2;
			for (let l = 0; l < 4; l++) {
				block[k + j * 4 + l] = color[l]!;
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
		let v = buffer[offset + i]!;
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

	const alpha0 = buffer[offset]!;
	const alpha1 = buffer[offset + 1]!;
	alphas[0] = alpha0;
	alphas[1] = alpha1;
	if (alpha0 > alpha1) {
		alphas[2] = Math.floor((6 * alpha0 + 1 * alpha1) / 7);
		alphas[3] = Math.floor((5 * alpha0 + 2 * alpha1) / 7);
		alphas[4] = Math.floor((4 * alpha0 + 3 * alpha1) / 7);
		alphas[5] = Math.floor((3 * alpha0 + 4 * alpha1) / 7);
		alphas[6] = Math.floor((2 * alpha0 + 5 * alpha1) / 7);
		alphas[7] = Math.floor((1 * alpha0 + 6 * alpha1) / 7);
	} else {
		alphas[2] = Math.floor((4 * alpha0 + 1 * alpha1) / 5);
		alphas[3] = Math.floor((3 * alpha0 + 2 * alpha1) / 5);
		alphas[4] = Math.floor((2 * alpha0 + 3 * alpha1) / 5);
		alphas[5] = Math.floor((1 * alpha0 + 4 * alpha1) / 5);
		alphas[6] = 0;
		alphas[7] = 255;
	}

	let v = 0;
	let bits = 0;
	let j = 0;
	for (let i = 2; i < 8; i++) {
		v |= buffer[offset + i]! << bits;
		bits += 8;
		while (bits >= 3) {
			const alpha = alphas[v & 0x7]!;
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
		result |= buffer[offset]! >> bitOffset;
		filled += 8 - bitOffset;
		rest -= 8 - bitOffset;
		bitOffset = 0;
		offset++;
	}
	while (rest >= 8) {
		result |= buffer[offset]! << filled;
		filled += 8;
		rest -= 8;
		offset++;
	}
	if (rest > 0) {
		result |= ((buffer[offset]! >> bitOffset) & ((1 << rest) - 1)) << filled;
		filled += 8 - bitOffset;
		rest -= 8 - bitOffset;
		offset++;
	}
	if (rest > 0) {
		result |= (buffer[offset]! & ((1 << rest) - 1)) << filled;
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
	[ChannelFormat.rgb]: rgbaResultPutter,
	[ChannelFormat.rgba]: rgbaResultPutter,
	[ChannelFormat.l]: luminanceResultPutter,
	[ChannelFormat.la]: luminanceAlphaResultPutter,
	[ChannelFormat.a]: alphaResultPutter,
	[ChannelFormat.d]: luminanceResultPutter,
	[ChannelFormat.r]: rResultPutter,
	[ChannelFormat.rg]: rgResultPutter,
};

function rResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = pixel[0]! * 255;
	result[offset + 1] = 0;
	result[offset + 2] = 0;
	result[offset + 3] = 255;
}

function rgResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = pixel[0]! * 255;
	result[offset + 1] = pixel[1]! * 255;
	result[offset + 2] = 0;
	result[offset + 3] = 255;
}

function rgbaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = pixel[0]! * 255;
	result[offset + 1] = pixel[1]! * 255;
	result[offset + 2] = pixel[2]! * 255;
	result[offset + 3] = pixel[3]! * 255;
}

function alphaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = result[offset + 1] = result[offset + 2] = 255;
	result[offset + 3] = pixel[0]! * 255;
}

function luminanceResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	const value = pixel[0]! * 255;
	result[offset] = result[offset + 1] = result[offset + 2] = value;
	result[offset + 3] = 255;
}

function luminanceAlphaResultPutter(
	result: Uint8Array,
	offset: number,
	pixel: Float64Array,
): void {
	result[offset] = result[offset + 1] = result[offset + 2] = pixel[0]! * 255;
	result[offset + 3] = pixel[1]! * 255;
}

type PixelNormalizer = (value: number, max: number) => number;
const pixelNormalizers: Partial<Record<PixelValueType, PixelNormalizer>> = {
	[PixelValueType.uint]: uintNormalizer,
	[PixelValueType.unorm]: uintNormalizer,
	[PixelValueType.sint]: sintNormalizer,
	[PixelValueType.snorm]: sintNormalizer,
	[PixelValueType.float]: floatNormalizer,
};

function uintNormalizer(value: number, max: number): number {
	return value / max;
}

function sintNormalizer(value: number, max: number): number {
	const midValue = (max - 1) / 2;
	const normalized = value === midValue + 1
		? -1
		: value <= midValue
			? value / midValue
			: -(max - value + 1) / midValue;
	return clampPixelValue(normalized);
}

function floatNormalizer(value: number, _max: number): number {
	return clampPixelValue(value);
}

function clampPixelValue(value: number): number {
	return Math.max(0, Math.min(1, value));
}

type ChannelBuffer = Uint8Array | Uint16Array | Uint32Array | Float32Array;

// Don't use js clossure for better performance
interface ChannelReader {
	// Method shorthand on purpose: its parameters are bivariant, so a reader written for one
	// buffer type still fits, and readerState is the buffer it was written for.
	reader(
		buffer: ChannelBuffer,
		offset: number,
		bitOffset: number,
		channelStart: number[],
		channelLength: number[],
		channelMask: number[],
		rawPixel: Float64Array,
	): void;
	readerState: ChannelBuffer;
}
function getChannelReader(
	inputBuffer: ArrayBuffer,
	inputBufferOffset: number,
	length: number,
	pixelFormat: RawPixelFormat,
): ChannelReader {
	// The caller has checked that a float format has 32-bit channels only.
	if (pixelFormat.valueType === PixelValueType.float) {
		return {
			reader: wholeElementReader,
			readerState: new Float32Array(inputBuffer, inputBufferOffset, length >> 2),
		};
	}

	for (const View of [Uint32Array, Uint16Array, Uint8Array]) {
		const bits = View.BYTES_PER_ELEMENT * 8;
		if (
			pixelFormat.bitsPerPixel % bits === 0 &&
			pixelFormat.channelLengthInPixel.every((p) => p === bits) &&
			pixelFormat.channelStartInPixel.every((s) => s % bits === 0)
		) {
			return {
				reader: wholeElementReader,
				readerState: new View(inputBuffer, inputBufferOffset, length / View.BYTES_PER_ELEMENT),
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
	channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	for (let i = 0; i < channelLength.length; i++) {
		const bitCount = channelLength[i]!;
		const start = bitOffset + channelStart[i]!;
		rawPixel[i] = readUnsignedBitsFromBuffer(
			buffer,
			offset + (start >> 3),
			start & 7,
			bitCount,
		);
	}
}

// Each channel fills one element of the buffer. An element of 1, 2 or 4 bytes shifts by 0, 1 or 2.
function wholeElementReader(
	buffer: ChannelBuffer,
	offset: number,
	_bitOffset: number,
	channelStart: number[],
	channelLength: number[],
	_channelMask: number[],
	rawPixel: Float64Array,
): void {
	const shift = buffer.BYTES_PER_ELEMENT >> 1;
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = buffer[(offset >> shift) + (channelStart[i]! >> (shift + 3))]!;
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
	const v = buffer[offset]!;
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = (v & channelMask[i]!) >>> channelStart[i]!;
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
	const v = buffer[offset >> 1]!;
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = (v & channelMask[i]!) >>> channelStart[i]!;
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
	const v = buffer[offset >> 2]!;
	for (let i = 0; i < channelLength.length; i++) {
		rawPixel[i] = (v & channelMask[i]!) >>> channelStart[i]!;
	}
}
