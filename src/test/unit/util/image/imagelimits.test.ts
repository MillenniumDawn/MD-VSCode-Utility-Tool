import * as assert from "assert";
import {
	assertImageDimensions,
	MAX_IMAGE_DIMENSION,
	MAX_IMAGE_PIXELS,
} from "../../../../util/image/imagelimits";
import { isUserError } from "../../dds";

describe("assertImageDimensions", () => {
	it("accepts sizes up to the per-side and pixel limits", () => {
		assert.strictEqual(6000 * 4000, MAX_IMAGE_PIXELS);
		for (const [width, height] of [[1, 1], [MAX_IMAGE_DIMENSION, 1], [1, MAX_IMAGE_DIMENSION], [6000, 4000]] as const) {
			assert.doesNotThrow(() => assertImageDimensions(width, height, "DDS"), `${width}x${height}`);
		}
	});

	const refused: [width: number, height: number, message: RegExp][] = [
		[MAX_IMAGE_DIMENSION + 1, 1, /DDS image size 16385x1 exceeds the supported maximum/],
		[1, MAX_IMAGE_DIMENSION + 1, /exceeds the supported maximum/],
		[6000, 4001, /exceeds the supported maximum/],
		[0, 4, /DDS image size 0x4 is not valid/],
		[4, -4, /is not valid/],
		[1.5, 4, /is not valid/],
		[4, NaN, /is not valid/],
	];
	for (const [width, height, message] of refused) {
		it(`refuses ${width}x${height}`, () => {
			assert.throws(() => assertImageDimensions(width, height, "DDS"), isUserError(message));
		});
	}
});
