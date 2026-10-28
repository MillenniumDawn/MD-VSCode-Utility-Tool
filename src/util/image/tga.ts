import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";

const TGA_HEADER_LENGTH = 18;
// Image types the tga library decodes: colour-mapped (1, 9), true-colour (2, 10), greyscale (3, 11).
const TGA_SUPPORTED_TYPES = new Set([1, 2, 3, 9, 10, 11]);
const TGA_COLOUR_MAPPED_TYPES = new Set([1, 9]);
const TGA_UNCOMPRESSED_TYPES = new Set([2, 3]);
const TGA_SUPPORTED_DEPTHS = new Set([8, 16, 24, 32]);

function readByte(buffer: Buffer, offset: number): number {
	return buffer[offset] ?? 0;
}

function tgaColour(buffer: Buffer, offset: number, depth: number, hasAlpha: boolean): [number, number, number, number] {
	switch (depth) {
		case 8:
			return [readByte(buffer, offset), readByte(buffer, offset), readByte(buffer, offset), 255];
		case 16: {
			return [(readByte(buffer, offset + 1) & 0x7c) << 1, ((readByte(buffer, offset + 1) & 0x03) << 6) | ((readByte(buffer, offset) & 0xe0) >> 2), (readByte(buffer, offset) & 0x1f) << 3, hasAlpha ? (readByte(buffer, offset + 1) & 0x80) : 255];
		}
		case 24:
			return [readByte(buffer, offset + 2), readByte(buffer, offset + 1), readByte(buffer, offset), 255];
		case 32:
			return [readByte(buffer, offset + 2), readByte(buffer, offset + 1), readByte(buffer, offset), hasAlpha ? readByte(buffer, offset + 3) : 255];
		default:
			throw new UserError("Unsupported tga format");
	}
}

function tgaPixel(buffer: Buffer, offset: number, imageType: number, depth: number,
	colourMap: [number, number, number, number][] | undefined, firstMapIndex: number, hasAlpha: boolean): [number, number, number, number] {
	if (imageType === 3 || imageType === 11) {
		const gray = readByte(buffer, offset);
		return depth === 16 ? [gray, gray, gray, hasAlpha ? readByte(buffer, offset + 1) : 255] : [gray, gray, gray, 255];
	}
	if (imageType === 1 || imageType === 9) {
		const index = depth === 16 ? buffer.readUInt16LE(offset) : readByte(buffer, offset);
		const colour = colourMap?.[index - firstMapIndex];
		if (colour === undefined) {
			throw new UserError("Unsupported tga format: colour map index is out of range");
		}
		return colour;
	}
	return tgaColour(buffer, offset, depth, hasAlpha);
}

export function decodeTga(buffer: Buffer): { width: number; height: number; pixels: Buffer } {
	// Check dimensions before allocating the RGBA output buffer.
	if (buffer.length < TGA_HEADER_LENGTH) {
		throw new UserError("TGA header is truncated");
	}
	const width = buffer.readUInt16LE(12);
	const height = buffer.readUInt16LE(14);
	assertImageDimensions(width, height, "TGA");

	// Reject unsupported formats before entering the pixel decoder.
	const colourMapType = buffer.readUInt8(1);
	const dataType = buffer.readUInt8(2);
	const bitsPerPixel = buffer.readUInt8(16);
	if (
		!TGA_SUPPORTED_TYPES.has(dataType) ||
		(TGA_COLOUR_MAPPED_TYPES.has(dataType) && colourMapType !== 1) ||
		!TGA_SUPPORTED_DEPTHS.has(bitsPerPixel)
	) {
		throw new UserError("Unsupported tga format");
	}

	// Reject short uncompressed data before walking the pixels.
	if (TGA_UNCOMPRESSED_TYPES.has(dataType)) {
		const pixelBytes = width * height * Math.ceil(bitsPerPixel / 8);
		if (TGA_HEADER_LENGTH + pixelBytes > buffer.length) {
			throw new UserError("TGA pixel data is truncated");
		}
	}

	const idLength = (buffer[0] ?? 0);
	const colourMapFirst = buffer.readUInt16LE(3);
	const colourMapLength = buffer.readUInt16LE(5);
	const colourMapDepth = (buffer[7] ?? 0);
	const pixelDepth = (buffer[16] ?? 0);
	const descriptor = (buffer[17] ?? 0);
	let hasAlpha = (descriptor & 0x0f) !== 0 || pixelDepth === 32 || (TGA_COLOUR_MAPPED_TYPES.has(dataType) && colourMapDepth === 32) || ((dataType === 3 || dataType === 11) && pixelDepth === 16);
	if (buffer.length >= 26 && buffer.toString("ascii", buffer.length - 18, buffer.length - 1) === "TRUEVISION-XFILE.") {
		const extensionOffset = buffer.readUInt32LE(buffer.length - 26);
		if (extensionOffset > 0 && extensionOffset + 495 <= buffer.length) {
			const attributesType = buffer[extensionOffset + 494];
			hasAlpha = attributesType === 3 || attributesType === 4;
		}
	}
	const pixelBytes = Math.ceil(pixelDepth / 8);
	let offset = TGA_HEADER_LENGTH + idLength;
	let colourMap: [number, number, number, number][] | undefined;
	if ((buffer[1] ?? 0) === 1) {
		if (!TGA_SUPPORTED_DEPTHS.has(colourMapDepth) || offset + colourMapLength * Math.ceil(colourMapDepth / 8) > buffer.length) {
			throw new UserError("TGA colour map is truncated or unsupported");
		}
		colourMap = [];
		for (let i = 0; i < colourMapLength; i++) {
			colourMap.push(tgaColour(buffer, offset, colourMapDepth, hasAlpha));
			offset += Math.ceil(colourMapDepth / 8);
		}
	}
	const pixels = Buffer.alloc(width * height * 4);
	let pixelIndex = 0;
	const writePixel = (pixel: [number, number, number, number]) => {
		const x = pixelIndex % width;
		const y = Math.floor(pixelIndex / width);
		const destinationX = (descriptor & 0x10) !== 0 ? width - 1 - x : x;
		const destinationY = (descriptor & 0x20) !== 0 ? y : height - 1 - y;
		pixels.set(pixel, (destinationY * width + destinationX) * 4);
		pixelIndex++;
	};
	const rle = dataType === 9 || dataType === 10 || dataType === 11;
	while (pixelIndex < width * height) {
		let count = 1;
		let repeated = false;
		if (rle) {
			if (offset >= buffer.length) {
				throw new UserError("TGA pixel data is truncated");
			}
			const packet = buffer[offset++] ?? 0;
			count = (packet & 0x7f) + 1;
			repeated = (packet & 0x80) !== 0;
			if (pixelIndex + count > width * height) {
				throw new UserError("Unsupported tga format: run exceeds image size");
			}
		}
		let pixel: [number, number, number, number] | undefined;
		if (repeated) {
			if (offset + pixelBytes > buffer.length) {
				throw new UserError("TGA pixel data is truncated");
			}
			pixel = tgaPixel(buffer, offset, dataType, pixelDepth, colourMap, colourMapFirst, hasAlpha);
			offset += pixelBytes;
		}
		for (let i = 0; i < count; i++) {
			if (!repeated) {
				if (offset + pixelBytes > buffer.length) {
					throw new UserError("TGA pixel data is truncated");
				}
				pixel = tgaPixel(buffer, offset, dataType, pixelDepth, colourMap, colourMapFirst, hasAlpha);
				offset += pixelBytes;
			}
			writePixel(pixel!);
		}
	}
	return { width, height, pixels };
}
