import * as assert from "assert";
import { isWorldMapHostMessage } from "../../../../previewdef/worldmap/definitions";

const syntheticCommands = ["requestprovinces", "requeststates", "requeststrategicregions", "requestsupplyareas"];

describe("world-map item request ranges", () => {
	for (const command of syntheticCommands) {
		it(`accepts synthetic negative ranges for ${command}`, () => {
			assert.ok(isWorldMapHostMessage({ command, start: -1, end: 0 }));
			assert.ok(isWorldMapHostMessage({ command, start: -1000, end: -250 }));
		});
	}

	for (const command of ["requestcountries", "requestrailways", "requestsupplynodes"]) {
		it(`keeps ${command} nonnegative`, () => {
			assert.ok(!isWorldMapHostMessage({ command, start: -1, end: 0 }));
			assert.ok(isWorldMapHostMessage({ command, start: 0, end: 1 }));
		});
	}

	for (const [start, end] of [
		["-1", 0], [-1.5, 0], [NaN, 0], [-Infinity, 0],
		[-1, Infinity], [-1, 0.5], [0, -1], [1, 1], [0, 5001],
		[-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER],
	]) {
		it(`rejects malformed or unsafe range ${start} to ${end}`, () => {
			assert.ok(!isWorldMapHostMessage({ command: "requestprovinces", start, end }));
		});
	}
});
