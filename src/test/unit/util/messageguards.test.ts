import * as assert from "assert";
import {
	isOffset,
	isOptionalBytes,
	isOptionalOffset,
	isOptionalString,
	isRecord,
} from "../../../util/messageguards";

describe("util/messageguards", () => {
	// [value, isRecord, isOffset, isOptionalOffset, isOptionalString, isOptionalBytes]
	const guards: [unknown, boolean, boolean, boolean, boolean, boolean][] = [
		[undefined, false, false, true, true, true],
		[null, false, false, false, false, false],
		[0, false, true, true, false, false],
		[12, false, true, true, false, false],
		[-1, false, false, false, false, false],
		[1.5, false, false, false, false, false],
		[NaN, false, false, false, false, false],
		["12", false, false, false, true, false],
		[{ start: 0 }, true, false, false, false, false],
		[[1], true, false, false, false, false],
		[new Uint8Array(2), true, false, false, false, true],
		[new ArrayBuffer(2), true, false, false, false, true],
	];

	for (const [value, record, offset, optionalOffset, optionalString, optionalBytes] of guards) {
		it(`classifies ${Object.prototype.toString.call(value)} ${JSON.stringify(value) ?? ""}`, () => {
			assert.deepStrictEqual(
				[isRecord(value), isOffset(value), isOptionalOffset(value), isOptionalString(value), isOptionalBytes(value)],
				[record, offset, optionalOffset, optionalString, optionalBytes],
			);
		});
	}
});
