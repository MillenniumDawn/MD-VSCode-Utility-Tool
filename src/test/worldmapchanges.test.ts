/// <reference types="node" />
/// <reference types="mocha" />

import * as assert from "assert";
import { WorldMapData } from "../previewdef/worldmap/definitions";
import { buildWorldMapChangeMessages } from "../previewdef/worldmap/worldmapchanges";

function map(overrides: Partial<WorldMapData> = {}): WorldMapData {
	return {
		width: 1,
		height: 1,
		provinces: [],
		states: [],
		countries: [],
		strategicRegions: [],
		supplyAreas: [],
		railways: [],
		supplyNodes: [],
		provincesCount: 0,
		statesCount: 0,
		countriesCount: 0,
		strategicRegionsCount: 0,
		supplyAreasCount: 0,
		railwaysCount: 0,
		supplyNodesCount: 0,
		badProvincesCount: 0,
		badStatesCount: 0,
		badStrategicRegionsCount: 0,
		badSupplyAreasCount: 0,
		continents: [],
		terrains: [],
		resources: [],
		rivers: [],
		warnings: [],
		...overrides,
	};
}

describe("previewdef/worldmap/worldmapchanges", () => {
	it("returns no messages for identical maps", () => {
		const worldMap = map();
		assert.deepStrictEqual(buildWorldMapChangeMessages(worldMap, worldMap), []);
	});

	it("rejects delta updates when a summary field changes", () => {
		assert.strictEqual(
			buildWorldMapChangeMessages(map(), map({ width: 2 })),
			undefined,
		);
	});

	it("keeps summary and item changes in protocol order", () => {
		const changed = map({
			warnings: [{ text: "warning", source: [], relatedFiles: [] }],
			continents: ["Europe"],
			terrains: [
				{ name: "plains", color: 1, isNaval: false, file: "terrain.txt" },
			],
			resources: [
				{ name: "steel", iconFrame: 1, imageUri: "", file: "resources.txt" },
			],
			countries: [{ tag: "AAA", color: 1 }],
			countriesCount: 1,
		});

		const messages = buildWorldMapChangeMessages(
			map({ countriesCount: 1 }),
			changed,
		);
		assert.deepStrictEqual(
			messages?.map((message) => message.command),
			["warnings", "continents", "terrains", "resources", "countries"],
		);
		assert.deepStrictEqual(messages?.at(-1), {
			command: "countries",
			data: JSON.stringify(changed.countries),
			start: 0,
			end: 1,
		});
	});
});
