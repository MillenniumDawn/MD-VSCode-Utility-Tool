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
const TGA_TYPE_UNCOMPRESSED = 2;

export function tgaToPng(buffer: Buffer): PNG {
	// The tga library allocates width * height * 4 bytes in its constructor, so the header
	// has to be checked before the buffer reaches it.
	if (buffer.length < TGA_HEADER_LENGTH) {
		throw new UserError("TGA header is truncated");
	}
	const width = buffer.readUInt16LE(12);
	const height = buffer.readUInt16LE(14);
	assertImageDimensions(width, height, "TGA");

	// An uncompressed image has a known size; the library reads it straight after the header
	// and reads past the end of a short buffer without complaint, returning garbage pixels.
	if (buffer[2] === TGA_TYPE_UNCOMPRESSED) {
		const pixelBytes = width * height * Math.ceil(buffer.readUInt8(16) / 8);
		if (TGA_HEADER_LENGTH + pixelBytes > buffer.length) {
			throw new UserError("TGA pixel data is truncated");
		}
	}

	const tga = new TGA(buffer);
	if (!tga.pixels) {
		throw new UserError("Unsupported tga format");
	}

	const png = new PNG({ width: tga.width, height: tga.height });
	png.data = Buffer.from(tga.pixels);

	return png;
}
