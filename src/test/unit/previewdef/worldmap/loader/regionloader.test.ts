import * as assert from "assert";
import type { Province, WorldMapWarning } from "../../../../../previewdef/worldmap/definitions";
import { sortItems } from "../../../../../previewdef/worldmap/loader/common";
import {
	fillRegions,
	RegionKind,
	sortRegionItems,
} from "../../../../../previewdef/worldmap/loader/regionloader";

const kind: RegionKind = {
	sourceType: "state",
	idTooLarge: [
		"worldmap.warnings.stateidtoolarge",
		"Max state id is too large: {0}",
	],
	idConflict: [
		"worldmap.warnings.stateidconflict",
		"There're more than one states using state id {0}.",
	],
	invalidId: [
		"worldmap.warnings.stateidinvalid",
		"State has an invalid id: {0}.",
	],
	notExist: [
		"worldmap.warnings.statenotexist",
		"State with id {0} doesn't exist.",
	],
	subRegionNotExist: [
		"worldmap.warnings.stateprovincenotexist",
		"Province {0} used in state {1} doesn't exist.",
	],
	noValidSubRegions: [
		"worldmap.warnings.statenovalidprovinces",
		"State {0} doesn't have valid provinces.",
	],
};

const zone = (x: number, y: number): { x: number; y: number; w: number; h: number } => ({
	x,
	y,
	w: 1,
	h: 1,
});

function province(id: number, x: number, y: number): Province {
	return {
		id,
		color: id,
		type: "land",
		coastal: false,
		terrain: "",
		continent: 1,
		boundingBox: zone(x, y),
		centerOfMass: { x, y },
		mass: 1,
		coverZones: [zone(x, y)],
		edges: [],
	};
}

function regionItem(
	id: number,
	provinces: number[],
	file = `history/states/${id}.txt`,
): { id: number; file: string; provinces: number[] } {
	return { id, file, provinces };
}

describe("previewdef/worldmap/loader/regionloader malformed region ids", () => {
	it("displaces a fractional id with a warning and the region pipeline still fills it", () => {
		const valid = regionItem(1, [1]);
		const fractional = regionItem(1.5, [2], "history/states/fractional.txt");
		const warnings: WorldMapWarning[] = [];

		const { sorted, badId } = sortRegionItems(
			[valid, fractional],
			kind,
			warnings,
		);
		assert.strictEqual(badId, -2);
		assert.deepStrictEqual(warnings, [
			{
				source: [{ type: "state", id: -1 }],
				relatedFiles: ["history/states/fractional.txt"],
				text: "State has an invalid id: 1.5.",
			},
		]);

		const { filled, badCount } = fillRegions(
			sorted,
			badId,
			"provinces",
			[undefined, province(1, 0, 0), province(2, 1, 1)],
			100,
			kind,
			warnings,
		);
		assert.strictEqual(badCount, 1);
		assert.strictEqual(filled[1], valid);
		assert.strictEqual(filled[-1], fractional);
		assert.strictEqual(filled[-1]?.id, -1);
	});

	it("displaces a malformed negative id instead of letting it silently leave the pipeline", () => {
		const negative = regionItem(-7, [1], "history/states/negative.txt");
		const warnings: WorldMapWarning[] = [];

		const { sorted, badId } = sortRegionItems([negative], kind, warnings);
		assert.strictEqual(badId, -2);
		assert.deepStrictEqual(warnings, [
			{
				source: [{ type: "state", id: -1 }],
				relatedFiles: ["history/states/negative.txt"],
				text: "State has an invalid id: -7.",
			},
		]);

		const { filled, badCount } = fillRegions(
			sorted,
			badId,
			"provinces",
			[undefined, province(1, 0, 0)],
			100,
			kind,
			warnings,
		);
		assert.strictEqual(badCount, 1);
		assert.strictEqual(filled[-1], negative);
	});

	it("reports a NaN id like any other nonnumeric one", () => {
		const invalid = regionItem(NaN, [], "history/states/invalid.txt");
		const warnings: WorldMapWarning[] = [];

		const { sorted, badId } = sortRegionItems([invalid], kind, warnings);
		assert.strictEqual(sorted.length, 1);
		assert.strictEqual(sorted[-1], invalid);
		assert.strictEqual(badId, -2);
		assert.deepStrictEqual(
			warnings.map((warning) => warning.text),
			["State has an invalid id: NaN."],
		);
	});

	it("keeps gap and conflict warnings working alongside the invalid-id path", () => {
		const first = regionItem(1, [1]);
		const third = regionItem(3, [1]);
		const duplicate = regionItem(1, [1], "history/states/dup.txt");
		const fractional = regionItem(2.5, [1], "history/states/frac.txt");
		const warnings: WorldMapWarning[] = [];

		const { sorted, badId } = sortRegionItems(
			[first, third, duplicate, fractional],
			kind,
			warnings,
		);
		assert.strictEqual(badId, -3);
		assert.deepStrictEqual(
			warnings.map((warning) => warning.text),
			[
				"There're more than one states using state id 1.",
				"State has an invalid id: 2.5.",
				"State with id 2 doesn't exist.",
			],
		);
		assert.strictEqual(sorted[1], duplicate);
		assert.strictEqual(sorted[3], third);
		assert.strictEqual(sorted[-1], first);
		assert.strictEqual(sorted[-2], fractional);

		// The displaced row also survives through sortItems' own bad-id bookkeeping.
		const reRun = sortItems([regionItem(-1, [1]), regionItem(2.5, [1], "f.txt")], 10, () => {}, () => {}, () => {});
		assert.strictEqual(reRun.badId, -3);
		assert.strictEqual(reRun.sorted[-1]!.id, -1);
		assert.strictEqual(reRun.sorted[-2]!.id, -2);
	});
});
