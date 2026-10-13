import { UserError } from "../../util/common";
import { DDS } from "../../util/image/dds";
import { DDPF_ALPHA, DDPF_FOURCC, DDPF_RGB } from "../../util/image/dds/typedef";

export interface DdsFixture {
	width: number;
	height: number;
	// The pixel data: the bytes themselves, or how many zero bytes to leave room for.
	data?: number | ArrayLike<number>;
	depth?: number;
	mipmapCount?: number;
	caps?: number;
	caps2?: number;
	// Pixel format flags. Defaults to an RGB format with alpha, or to FourCC when one is given.
	flags?: number;
	bitsPerPixel?: number;
	// Red, green, blue and alpha masks. Defaults to A8R8G8B8.
	masks?: [number, number, number, number];
	fourCC?: string;
	// Writes the DX10 header behind the standard one.
	dx10?: { format: number; dimension?: number; miscFlag?: number; arraySize?: number };
}

// A DDS file in a buffer of its own. Fields are written unsigned, so a value with the top bit set
// reads back negative from the parser's Int32Array view, as it would from a hostile file.
export function makeDds(fixture: DdsFixture): Buffer {
	const data = typeof fixture.data === "number" ? new Uint8Array(fixture.data) : Uint8Array.from(fixture.data ?? []);
	const headerLength = fixture.dx10 ? 148 : 128;
	const buf = Buffer.alloc(headerLength + data.length);
	const set = (index: number, value: number) => buf.writeUInt32LE(value >>> 0, index * 4);
	const fourCC = fixture.dx10 ? "DX10" : fixture.fourCC;
	const masks = fixture.masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];

	buf.write("DDS ", 0, "ascii");
	set(1, 124);
	set(2, 0x1007); // caps, height, width and pixel format are present
	set(3, fixture.height);
	set(4, fixture.width);
	set(6, fixture.depth ?? 0);
	set(7, fixture.mipmapCount ?? 0);
	set(19, 32);
	set(20, fixture.flags ?? (fourCC ? DDPF_FOURCC : DDPF_RGB | DDPF_ALPHA));
	if (fourCC) {
		buf.write(fourCC, 21 * 4, "ascii");
	}
	set(22, fixture.bitsPerPixel ?? 32);
	masks.forEach((mask, index) => set(23 + index, mask));
	set(27, fixture.caps ?? 0x1000);
	set(28, fixture.caps2 ?? 0);
	if (fixture.dx10) {
		set(32, fixture.dx10.format);
		set(33, fixture.dx10.dimension ?? 3); // a 2D texture
		set(34, fixture.dx10.miscFlag ?? 0);
		set(35, fixture.dx10.arraySize ?? 1);
	}
	buf.set(data, headerLength);
	return buf;
}

export function parseDds(buf: Buffer): DDS {
	return DDS.parse(buf.buffer as ArrayBuffer, buf.byteOffset);
}

// The first image of a DDS file, decoded to RGBA bytes.
export function decodeDds(fixture: DdsFixture): number[] {
	const image = parseDds(makeDds(fixture)).images[0];
	return Array.from(image?.getFullRgba() ?? []);
}

export function isUserError(pattern: RegExp): (e: unknown) => boolean {
	return (e: unknown) => e instanceof UserError && pattern.test(e.message);
}

// Little-endian bytes of 16-bit, 32-bit and float values, for pixel data wider than a byte.
export function u16(...values: number[]): number[] {
	return Array.from(new Uint8Array(Uint16Array.from(values).buffer));
}

export function u32(...values: number[]): number[] {
	return Array.from(new Uint8Array(Uint32Array.from(values).buffer));
}

export function f32(...values: number[]): number[] {
	return Array.from(new Uint8Array(Float32Array.from(values).buffer));
}
