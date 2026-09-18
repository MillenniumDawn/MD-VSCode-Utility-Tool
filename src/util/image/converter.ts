import { DDS } from "./dds";
import { PNG } from "pngjs";
import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";
const TGA = require("tga") as typeof import("tga");

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
