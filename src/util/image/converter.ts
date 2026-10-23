import { DDS } from "./dds";
import { PNG } from "pngjs";
import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";
const TGA = require("tga") as typeof import("tga");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngBuffer(buffer: Buffer): boolean {
	return (
		buffer.length >= PNG_SIGNATURE.length &&
		PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
	);
}

// Reads dimensions without inflating the image. A missing or malformed header returns undefined.
export function readPngHeaderDimensions(
	buffer: Buffer,
): { width: number; height: number } | undefined {
	if (buffer.length < 24 || !isPngBuffer(buffer)) {
		return undefined;
	}
	if (buffer.toString("ascii", 12, 16) !== "IHDR") {
		return undefined;
	}

	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// The last byte of the IHDR data, after the 8 byte signature and the 8 byte chunk header.
const PNG_INTERLACE_OFFSET = 28;
const CHUNK_IHDR = 0x49484452;
const CHUNK_IEND = 0x49454e44;

// pngjs honors every IHDR it meets, so a second one could swap the checked header for another.
// Chunks are stepped as pngjs steps them: 4 length, 4 type, the data, 4 CRC.
function repeatsIhdr(buffer: Buffer): boolean {
	let seen = 0;
	for (let offset = PNG_SIGNATURE.length; offset + 8 <= buffer.length; ) {
		const type = buffer.readUInt32BE(offset + 4);
		if (type === CHUNK_IHDR && ++seen > 1) {
			return true;
		}
		if (type === CHUNK_IEND) {
			break;
		}
		offset += 12 + buffer.readUInt32BE(offset);
	}
	return false;
}

// Every PNG decode starts here. pngjs inflates an interlaced image with no output limit, so those
// are refused, along with any size over the image limit. No pixel data is read.
export function assertDecodablePng(buffer: Buffer): { width: number; height: number } {
	const dimensions = readPngHeaderDimensions(buffer);
	if (dimensions === undefined) {
		throw new UserError("Unsupported png format: the header is missing");
	}
	assertImageDimensions(dimensions.width, dimensions.height, "PNG");
	if (buffer.length <= PNG_INTERLACE_OFFSET) {
		throw new UserError("Unsupported png format: the header is cut short");
	}
	if (buffer[PNG_INTERLACE_OFFSET] !== 0) {
		throw new UserError("Unsupported png format: interlaced images are not supported");
	}
	if (repeatsIhdr(buffer)) {
		throw new UserError("Unsupported png format: the header is repeated");
	}
	return dimensions;
}

export function pngToPng(buffer: Buffer): PNG {
	assertDecodablePng(buffer);
	// PNG.sync.read throws a plain Error for every malformed payload, which getImage would log as a
	// tool failure instead of bad user input; classify it like tgaToPng does.
	try {
		return PNG.sync.read(buffer);
	} catch (e) {
		throw new UserError(`Unsupported png format: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export function ddsToPng(dds: DDS): PNG {
	const img = dds.images[0];
	if (img === undefined) {
		throw new UserError("DDS contains no images");
	}

	const png = new PNG();
	png.width = img.width;
	png.height = img.height;
	const imgbuffer = img.getFullRgba();
	// Surface returns fresh RGBA storage; keep it rather than allocating two more image buffers.
	png.data = Buffer.from(imgbuffer.buffer, imgbuffer.byteOffset, imgbuffer.byteLength);

	return png;
}

const TGA_HEADER_LENGTH = 18;
// Image types the tga library decodes: colour-mapped (1, 9), true-colour (2, 10), greyscale (3, 11).
const TGA_SUPPORTED_TYPES = new Set([1, 2, 3, 9, 10, 11]);
const TGA_COLOUR_MAPPED_TYPES = new Set([1, 9]);
const TGA_UNCOMPRESSED_TYPES = new Set([2, 3]);
const TGA_SUPPORTED_DEPTHS = new Set([8, 16, 24, 32]);

export function tgaToPng(buffer: Buffer): PNG {
	// The tga library allocates width * height * 4 bytes in its constructor, so the header
	// has to be checked before the buffer reaches it.
	if (buffer.length < TGA_HEADER_LENGTH) {
		throw new UserError("TGA header is truncated");
	}
	const width = buffer.readUInt16LE(12);
	const height = buffer.readUInt16LE(14);
	assertImageDimensions(width, height, "TGA");

	// The library no longer validates the header itself: an unknown image type decodes to
	// garbage, and a colour-mapped type without a colour map crashes inside it.
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

	// An uncompressed image has a known size; the library reads it straight after the header
	// and reads past the end of a short buffer without complaint, returning garbage pixels.
	if (TGA_UNCOMPRESSED_TYPES.has(dataType)) {
		const pixelBytes = width * height * Math.ceil(bitsPerPixel / 8);
		if (TGA_HEADER_LENGTH + pixelBytes > buffer.length) {
			throw new UserError("TGA pixel data is truncated");
		}
	}

	// dontFixAlpha: by default the library turns a fully transparent image opaque.
	let tga: InstanceType<typeof TGA>;
	try {
		tga = new TGA(buffer, { dontFixAlpha: true });
	} catch (e) {
		throw new UserError(`Unsupported tga format: ${e instanceof Error ? e.message : String(e)}`);
	}

	const png = new PNG();
	png.width = tga.width;
	png.height = tga.height;
	// The decoder owns these pixels and is no longer used after conversion.
	png.data = Buffer.from(tga.pixels.buffer, tga.pixels.byteOffset, tga.pixels.byteLength);

	return png;
}
