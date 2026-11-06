import * as assert from "assert";
import { decodeTga } from "../../../../util/image/tga";

describe("16-bit TGA colors", () => {
	function pixel(value: number, alphaBits: number): number[] {
		const data = Buffer.alloc(20);
		data[2] = 2;
		data.writeUInt16LE(1, 12);
		data.writeUInt16LE(1, 14);
		data[16] = 16;
		data[17] = alphaBits;
		data.writeUInt16LE(value, 18);
		return [...decodeTga(data).pixels];
	}

	it("expands color and one-bit alpha", () => {
		assert.deepStrictEqual(pixel(0xffff, 1), [255, 255, 255, 255]);
		assert.deepStrictEqual(pixel(0x7fff, 1), [255, 255, 255, 0]);
		assert.deepStrictEqual(pixel(0x4210, 0), [132, 132, 132, 255]);
		assert.deepStrictEqual(pixel(0x0000, 0), [0, 0, 0, 255]);
	});
});
