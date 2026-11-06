import * as assert from "assert";
import { decodeTga } from "../../../../util/image/tga";

describe("TGA alpha representation", () => {
	function decode(attributes: number): number[] {
		const extension = 18 + 12;
		const data = Buffer.alloc(extension + 495 + 26);
		data[2] = 2;
		data.writeUInt16LE(3, 12);
		data.writeUInt16LE(1, 14);
		data[16] = 32;
		data[17] = 8;
		Buffer.from([0, 0, 64, 128, 0, 0, 200, 0, 0, 0, 80, 255]).copy(data, 18);
		data[extension + 494] = attributes;
		data.writeUInt32LE(extension, data.length - 26);
		data.write("TRUEVISION-XFILE.", data.length - 18, "ascii");
		return [...decodeTga(data).pixels];
	}

	it("converts premultiplied RGB to straight alpha", () => {
		assert.deepStrictEqual(decode(4), [128, 0, 0, 128, 0, 0, 0, 0, 80, 0, 0, 255]);
	});

	it("keeps straight alpha unchanged", () => {
		assert.deepStrictEqual(decode(3), [64, 0, 0, 128, 200, 0, 0, 0, 80, 0, 0, 255]);
	});
});
