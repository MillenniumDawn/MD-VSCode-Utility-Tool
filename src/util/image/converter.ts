import { DDS } from "./dds";
import { PNG } from "pngjs";
import { UserError } from "../common";
import { assertImageDimensions } from "./imagelimits";
import { decodeTga } from "./tga";

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

export function tgaToPng(buffer: Buffer): PNG {
	const decoded = decodeTga(buffer);
	const png = new PNG();
	png.width = decoded.width;
	png.height = decoded.height;
	png.data = decoded.pixels;
	return png;
}
