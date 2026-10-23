import zlib from "zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(body));
	return Buffer.concat([length, body, crc]);
}

// An IHDR chunk for an 8-bit RGBA image.
export function pngHeader(width: number, height: number, interlace: 0 | 1): Buffer {
	const data = Buffer.alloc(13);
	data.writeUInt32BE(width, 0);
	data.writeUInt32BE(height, 4);
	data[8] = 8;
	data[9] = 6;
	data[12] = interlace;
	return pngChunk("IHDR", data);
}

export function pngEnd(): Buffer {
	return pngChunk("IEND", Buffer.alloc(0));
}

export function pngFile(...chunks: Buffer[]): Buffer {
	return Buffer.concat([SIGNATURE, ...chunks]);
}

// A PNG made of the given header chunks and pixel data that is all zeros, which deflates to almost
// nothing at any size. `inflatesTo` is how far that data inflates, whatever the headers claim.
export function makeZeroPng(headers: Buffer[], inflatesTo: number): Buffer {
	return pngFile(...headers, pngChunk("IDAT", zlib.deflateSync(Buffer.alloc(inflatesTo))), pngEnd());
}
