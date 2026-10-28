import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";

const TGA_HEADER_LENGTH = 18;
// Colour-mapped (1, 9), true-colour (2, 10) and greyscale (3, 11), raw and run-length encoded.
const TGA_SUPPORTED_TYPES = new Set([1, 2, 3, 9, 10, 11]);
const TGA_COLOUR_MAPPED_TYPES = new Set([1, 9]);
const TGA_GREYSCALE_TYPES = new Set([3, 11]);
const TGA_UNCOMPRESSED_TYPES = new Set([2, 3]);
const TGA_SUPPORTED_DEPTHS = new Set([8, 16, 24, 32]);

// Writes one stored colour to target[at..at + 3] as RGBA. The caller has checked the bytes exist.
function readColour(source: Buffer, offset: number, depth: number, hasAlpha: boolean, target: Uint8Array, at: number): void {
	const low = source[offset] ?? 0;
	switch (depth) {
		case 8:
			target[at] = target[at + 1] = target[at + 2] = low;
			target[at + 3] = 255;
			return;
		case 16: {
			const high = source[offset + 1] ?? 0;
			target[at] = (high & 0x7c) << 1;
			target[at + 1] = ((high & 0x03) << 6) | ((low & 0xe0) >> 2);
			target[at + 2] = (low & 0x1f) << 3;
			target[at + 3] = hasAlpha ? high & 0x80 : 255;
			return;
		}
		default:
			target[at] = source[offset + 2] ?? 0;
			target[at + 1] = source[offset + 1] ?? 0;
			target[at + 2] = low;
			target[at + 3] = depth === 32 && hasAlpha ? source[offset + 3] ?? 0 : 255;
	}
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
	const pixelDepth = buffer.readUInt8(16);
	if (
		!TGA_SUPPORTED_TYPES.has(dataType) ||
		(TGA_COLOUR_MAPPED_TYPES.has(dataType) && colourMapType !== 1) ||
		!TGA_SUPPORTED_DEPTHS.has(pixelDepth)
	) {
		throw new UserError("Unsupported tga format");
	}

	// Reject short uncompressed data before walking the pixels.
	if (TGA_UNCOMPRESSED_TYPES.has(dataType)) {
		const pixelBytes = width * height * (pixelDepth / 8);
		if (TGA_HEADER_LENGTH + pixelBytes > buffer.length) {
			throw new UserError("TGA pixel data is truncated");
		}
	}

	const idLength = buffer.readUInt8(0);
	const colourMapFirst = buffer.readUInt16LE(3);
	const colourMapLength = buffer.readUInt16LE(5);
	const colourMapDepth = buffer.readUInt8(7);
	const descriptor = buffer.readUInt8(17);
	const greyscale = TGA_GREYSCALE_TYPES.has(dataType);
	let hasAlpha = (descriptor & 0x0f) !== 0 || pixelDepth === 32 || (TGA_COLOUR_MAPPED_TYPES.has(dataType) && colourMapDepth === 32) || (greyscale && pixelDepth === 16);
	if (buffer.length >= 26 && buffer.toString("ascii", buffer.length - 18, buffer.length - 1) === "TRUEVISION-XFILE.") {
		const extensionOffset = buffer.readUInt32LE(buffer.length - 26);
		if (extensionOffset > 0 && extensionOffset + 495 <= buffer.length) {
			const attributesType = buffer[extensionOffset + 494];
			hasAlpha = attributesType === 3 || attributesType === 4;
		}
	}

	let offset = TGA_HEADER_LENGTH + idLength;
	let colourMap: Uint8Array | undefined;
	if (colourMapType === 1) {
		if (!TGA_SUPPORTED_DEPTHS.has(colourMapDepth) || offset + colourMapLength * (colourMapDepth / 8) > buffer.length) {
			throw new UserError("TGA colour map is truncated or unsupported");
		}
		colourMap = new Uint8Array(colourMapLength * 4);
		for (let i = 0; i < colourMapLength; i++) {
			readColour(buffer, offset, colourMapDepth, hasAlpha, colourMap, i * 4);
			offset += colourMapDepth / 8;
		}
	}
	const palette = TGA_COLOUR_MAPPED_TYPES.has(dataType) ? colourMap : undefined;

	const pixelBytes = pixelDepth / 8;
	const readPixel = (target: Uint8Array, at: number) => {
		if (offset + pixelBytes > buffer.length) {
			throw new UserError("TGA pixel data is truncated");
		}
		if (greyscale) {
			const grey = buffer[offset] ?? 0;
			target[at] = target[at + 1] = target[at + 2] = grey;
			target[at + 3] = pixelDepth === 16 && hasAlpha ? buffer[offset + 1] ?? 0 : 255;
		} else if (palette) {
			const entry = ((pixelDepth === 16 ? buffer.readUInt16LE(offset) : buffer[offset] ?? 0) - colourMapFirst) * 4;
			// An index outside the map stays transparent black, as the old decoder left it.
			const inMap = entry >= 0 && entry < palette.length;
			for (let i = 0; i < 4; i++) {
				target[at + i] = inMap ? palette[entry + i] ?? 0 : 0;
			}
		} else {
			readColour(buffer, offset, pixelDepth, hasAlpha, target, at);
		}
		offset += pixelBytes;
	};

	const pixels = Buffer.alloc(width * height * 4);
	const repeat = new Uint8Array(4);
	const rle = dataType === 9 || dataType === 10 || dataType === 11;
	const flipX = (descriptor & 0x10) !== 0;
	const topDown = (descriptor & 0x20) !== 0;
	let remaining = width * height;
	let x = 0;
	let y = 0;
	while (remaining > 0) {
		let count = 1;
		let repeated = false;
		if (rle) {
			if (offset >= buffer.length) {
				throw new UserError("TGA pixel data is truncated");
			}
			const packet = buffer.readUInt8(offset++);
			count = (packet & 0x7f) + 1;
			repeated = (packet & 0x80) !== 0;
			if (count > remaining) {
				throw new UserError("Unsupported tga format: run exceeds image size");
			}
			if (repeated) {
				readPixel(repeat, 0);
			}
		}
		remaining -= count;
		for (; count > 0; count--) {
			const at = ((topDown ? y : height - 1 - y) * width + (flipX ? width - 1 - x : x)) * 4;
			if (repeated) {
				pixels.set(repeat, at);
			} else {
				readPixel(pixels, at);
			}
			if (++x === width) {
				x = 0;
				y++;
			}
		}
	}
	return { width, height, pixels };
}
