import { DDS } from "./dds";
import { PNG } from "pngjs";
import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";
const TGA = require("tga") as typeof import("tga");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngSignature(buffer: Buffer): boolean {
	return (
		buffer.length >= PNG_SIGNATURE.length &&
		PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
	);
}

export function isPngBuffer(buffer: Buffer): boolean {
	return hasPngSignature(buffer);
}

// Reads dimensions without inflating the image. A missing or malformed header returns undefined so
// the caller can use PNG.sync.read for full validation.
export function readPngHeaderDimensions(
	buffer: Buffer,
): { width: number; height: number } | undefined {
	if (buffer.length < 24 || !hasPngSignature(buffer)) {
		return undefined;
	}
	if (buffer.toString("ascii", 12, 16) !== "IHDR") {
		return undefined;
	}

	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function pngToPng(buffer: Buffer): PNG {
	const dimensions = readPngHeaderDimensions(buffer);
	if (dimensions) {
		assertImageDimensions(dimensions.width, dimensions.height, "PNG");
	}
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

	const png = new PNG({ width: img.width, height: img.height });
	const imgbuffer = img.getFullRgba();
	png.data = Buffer.from(imgbuffer);

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
	if (!tga.pixels) {
		throw new UserError("Unsupported tga format");
	}

	const png = new PNG({ width: tga.width, height: tga.height });
	png.data = Buffer.from(tga.pixels);

	return png;
}
