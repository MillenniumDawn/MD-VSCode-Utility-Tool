import * as assert from "assert";
import { WorldMapLoader } from "../../../../../previewdef/worldmap/loader/worldmaploader";
import { LoaderSession } from "../../../../../util/loader/loader";
import { handOver } from "../../../host";

type LoaderResult = {
	result: unknown;
	warnings: unknown[];
	dependencies: string[];
};

function fakeLoader(
	name: string,
	result: LoaderResult,
	calls: string[],
): { load: () => Promise<LoaderResult>; toString: () => string } {
	return {
		load: async () => {
			calls.push(name);
			return result;
		},
		toString: () => name,
	};
}

function replaceLoaders(loader: WorldMapLoader, calls: string[]): void {
	const instance = loader as any;
	instance.defaultMapLoader = fakeLoader(
		"default",
		{
			result: {
				width: 2,
				height: 3,
				provinces: [undefined],
				badProvincesCount: 0,
				continents: [""],
				terrains: [],
				rivers: [],
				colorByPosition: new Uint32Array(6),
			},
			warnings: [],
			dependencies: ["map/default.map"],
		},
		calls,
	);
	instance.statesLoader = fakeLoader(
		"states",
		{
			result: { states: [undefined], badStatesCount: 0 },
			warnings: [],
			dependencies: ["history/states/1.txt"],
		},
		calls,
	);
	instance.countriesLoader = fakeLoader(
		"countries",
		{ result: [], warnings: [], dependencies: ["common/countries"] },
		calls,
	);
	instance.strategicRegionsLoader = fakeLoader(
		"strategic-regions",
		{
			result: { strategicRegions: [undefined], badStrategicRegionsCount: 0 },
			warnings: [],
			dependencies: ["common/strategicregions"],
		},
		calls,
	);
	instance.supplyAreasLoader = fakeLoader(
		"supply-areas",
		{
			result: { supplyAreas: [undefined], badSupplyAreasCount: 0 },
			warnings: [],
			dependencies: ["common/supplyareas"],
		},
		calls,
	);
	instance.railwayLoader = fakeLoader(
		"railways",
		{
			result: { railways: [undefined] },
			warnings: [],
			dependencies: ["map/railways.txt"],
		},
		calls,
	);
	instance.supplyNodeLoader = fakeLoader(
		"supply-nodes",
		{
			result: { supplyNodes: [undefined] },
			warnings: [],
			dependencies: ["map/supply_nodes.txt"],
		},
		calls,
	);
	instance.resourcesLoader = fakeLoader(
		"resources",
		{ result: [], warnings: [], dependencies: ["common/resources"] },
		calls,
	);
}

describe("previewdef/worldmap/loader WorldMapLoader", () => {
	it("merges every loader and uses railways when supply areas are disabled", async () => {
		handOver({
			workspace: { getConfiguration: () => ({ enableSupplyArea: false }) },
		});
		const calls: string[] = [];
		const loader = new WorldMapLoader();
		replaceLoaders(loader, calls);

		const result = await loader.loadImpl(new LoaderSession(true));

		assert.deepStrictEqual(calls, [
			"default",
			"states",
			"countries",
			"strategic-regions",
			"railways",
			"supply-nodes",
			"resources",
		]);
		assert.strictEqual(result.result.provincesCount, 1);
		assert.strictEqual(result.result.statesCount, 1);
		assert.strictEqual(result.result.railwaysCount, 1);
		assert.strictEqual(result.result.supplyNodesCount, 1);
		assert.deepStrictEqual(result.dependencies, [
			"map/default.map",
			"history/states/1.txt",
			"common/countries",
			"common/strategicregions",
			"map/railways.txt",
			"map/supply_nodes.txt",
			"common/resources",
		]);
		assert.strictEqual("colorByPosition" in result.result, false);
	});

	it("uses supply-area data instead of railway data when enabled", async () => {
		handOver({
			workspace: { getConfiguration: () => ({ enableSupplyArea: true }) },
		});
		const calls: string[] = [];
		const loader = new WorldMapLoader();
		replaceLoaders(loader, calls);

		const result = await loader.loadImpl(new LoaderSession(true));

		assert.deepStrictEqual(calls, [
			"default",
			"states",
			"countries",
			"strategic-regions",
			"supply-areas",
			"resources",
		]);
		assert.strictEqual(result.result.supplyAreasCount, 1);
		assert.strictEqual(result.result.railwaysCount, 0);
		assert.strictEqual(result.result.supplyNodesCount, 0);
		assert.deepStrictEqual(result.dependencies, [
			"map/default.map",
			"history/states/1.txt",
			"common/countries",
			"common/strategicregions",
			"common/supplyareas",
			"common/resources",
		]);
	});

	it("marks itself for reload after a shallow force request", async () => {
		const loader = new WorldMapLoader();
		assert.strictEqual(await loader.shouldReloadImpl(), false);

		loader.shallowForceReload();
		assert.strictEqual(await loader.shouldReloadImpl(), true);
	});
});