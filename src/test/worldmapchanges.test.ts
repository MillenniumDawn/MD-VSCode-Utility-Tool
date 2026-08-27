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

	for (const key of [
		"width",
		"height",
		"provincesCount",
		"statesCount",
		"countriesCount",
		"strategicRegionsCount",
		"supplyAreasCount",
		"railwaysCount",
		"supplyNodesCount",
		"badProvincesCount",
		"badStatesCount",
		"badStrategicRegionsCount",
		"badSupplyAreasCount",
	] as const) {
		it(`rejects delta updates when ${key} changes`, () => {
			const changed = map();
			changed[key] += 1;
			assert.strictEqual(
				buildWorldMapChangeMessages(map(), changed),
				undefined,
			);
		});
	}

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

	it("sends a changed bad province at its negative id", () => {
		const cached = map({ badProvincesCount: 1 });
		const changed = map({ badProvincesCount: 1 });
		const cachedProvinces = cached.provinces as unknown as Record<
			number,
			unknown
		>;
		const changedProvinces = changed.provinces as unknown as Record<
			number,
			unknown
		>;
		cachedProvinces[-1] = { id: -1, name: "before" };
		changedProvinces[-1] = { id: -1, name: "after" };

		assert.deepStrictEqual(buildWorldMapChangeMessages(cached, changed), [
			{
				command: "provinces",
				data: JSON.stringify([changedProvinces[-1]]),
				start: -1,
				end: 0,
			},
		]);
	});

	it("rejects changes that need more than 30 messages", () => {
		const countries = Array.from({ length: 61 }, (_, index) => ({
			tag: `C${index}`,
			color: index,
		}));
		const changedCountries = countries.map((country, index) =>
			index % 2 === 0 ? { ...country, color: index + 100 } : country,
		);
		const cached = map({
			countries,
			countriesCount: countries.length,
		});
		const changed = map({
			countries: changedCountries,
			countriesCount: changedCountries.length,
		});

		assert.strictEqual(buildWorldMapChangeMessages(cached, changed), undefined);
	});
});
