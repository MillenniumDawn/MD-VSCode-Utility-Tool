import "./setup";
import * as assert from "assert";
import { WorldMapData } from "../../previewdef/worldmap/definitions";
import { buildWorldMapChangeMessages } from "../../previewdef/worldmap/worldmapchanges";
import { Loader, FEWorldMapClass } from "../../../webviewsrc/worldmap/loader";
import { inBBox } from "../../../webviewsrc/worldmap/graphutils";
import { Zone } from "../../../webviewsrc/worldmap/definitions";
import { vscode } from "../../../webviewsrc/util/vscode";

function buildMap() {
	const state1 = { id: 1, provinces: [10, 11] };
	const state2 = { id: 2, provinces: [20] };
	const strategicRegion1 = { id: 1, provinces: [10, 20] };
	const supplyArea1 = { id: 1, states: [1, 2] };
	const railwayA = { provinces: [10, 11], level: 2 };
	const railwayB = { provinces: [11], level: 5 };
	const supplyNode = { province: 20, level: 1 };

	return new FEWorldMapClass({
		states: [undefined, state1, state2],
		statesCount: 3,
		badStatesCount: 0,
		strategicRegions: [undefined, strategicRegion1],
		strategicRegionsCount: 2,
		badStrategicRegionsCount: 0,
		supplyAreas: [undefined, supplyArea1],
		supplyAreasCount: 2,
		badSupplyAreasCount: 0,
		railways: [railwayA, railwayB],
		railwaysCount: 2,
		supplyNodes: [supplyNode],
		supplyNodesCount: 1,
	} as any);
}

describe("webview/worldmap/FEWorldMapClass reverse maps", function () {
	describe("getter correctness", function () {
		it("resolves state by province id", function () {
			const map = buildMap();
			assert.strictEqual(map.getStateByProvinceId(10)?.id, 1);
			assert.strictEqual(map.getStateByProvinceId(11)?.id, 1);
			assert.strictEqual(map.getStateByProvinceId(20)?.id, 2);
			assert.strictEqual(map.getStateByProvinceId(999), undefined);
		});

		it("resolves strategic region by province id", function () {
			const map = buildMap();
			assert.strictEqual(map.getStrategicRegionByProvinceId(10)?.id, 1);
			assert.strictEqual(map.getStrategicRegionByProvinceId(20)?.id, 1);
			assert.strictEqual(map.getStrategicRegionByProvinceId(999), undefined);
		});

		it("resolves supply area by state id", function () {
			const map = buildMap();
			assert.strictEqual(map.getSupplyAreaByStateId(1)?.id, 1);
			assert.strictEqual(map.getSupplyAreaByStateId(2)?.id, 1);
			assert.strictEqual(map.getSupplyAreaByStateId(999), undefined);
		});

		it("takes the max railway level across railways per province", function () {
			const map = buildMap();
			assert.strictEqual(map.getRailwayLevelByProvinceId(10), 2);
			assert.strictEqual(map.getRailwayLevelByProvinceId(11), 5);
			assert.strictEqual(map.getRailwayLevelByProvinceId(20), undefined);
		});

		it("resolves supply node by province id", function () {
			const map = buildMap();
			assert.strictEqual(map.getSupplyNodeByProvinceId(20)?.province, 20);
			assert.strictEqual(map.getSupplyNodeByProvinceId(10), undefined);
		});

		it("selects a province only inside its cover zone", function () {
			const map = new FEWorldMapClass({
				provinces: [
					{
						id: 1,
						boundingBox: { x: 0, y: 0, w: 3, h: 3 },
						coverZones: [{ x: 1, y: 1, w: 1, h: 1 }],
					},
				],
				provincesCount: 1,
				badProvincesCount: 0,
			} as any);

			assert.strictEqual(map.getProvinceByPosition(0, 0), undefined);
			assert.strictEqual(map.getProvinceByPosition(1, 1)?.id, 1);
			assert.strictEqual(map.getProvinceByPosition(2, 1), undefined);
			assert.strictEqual(map.getProvinceByPosition(1, 2), undefined);
		});

		it("prefers the lowest province id when cover zones overlap, bad provinces first", function () {
			const provinces: any[] = [];
			provinces[-1] = {
				id: -1,
				boundingBox: { x: 100, y: 100, w: 10, h: 10 },
				coverZones: [{ x: 105, y: 105, w: 5, h: 5 }],
			};
			provinces[1] = {
				id: 1,
				boundingBox: { x: 100, y: 100, w: 10, h: 10 },
				coverZones: [{ x: 100, y: 100, w: 10, h: 10 }],
			};
			provinces[2] = {
				id: 2,
				boundingBox: { x: 100, y: 100, w: 10, h: 10 },
				coverZones: [{ x: 100, y: 100, w: 10, h: 10 }],
			};
			const map = new FEWorldMapClass({
				provinces,
				provincesCount: 3,
				badProvincesCount: 1,
			} as any);

			assert.strictEqual(map.getProvinceByPosition(107, 107)?.id, -1);
			assert.strictEqual(map.getProvinceByPosition(101, 101)?.id, 1);
		});

		it("finds a province spanning several grid cells from every cell it touches", function () {
			const map = new FEWorldMapClass({
				provinces: [
					undefined,
					{
						id: 1,
						boundingBox: { x: 10, y: 10, w: 200, h: 150 },
						coverZones: [{ x: 10, y: 10, w: 200, h: 150 }],
					},
					{
						id: 2,
						boundingBox: { x: 500, y: 500, w: 8, h: 8 },
						coverZones: [{ x: 500, y: 500, w: 8, h: 8 }],
					},
				],
				provincesCount: 3,
				badProvincesCount: 0,
			} as any);

			assert.strictEqual(map.getProvinceByPosition(10, 10)?.id, 1);
			assert.strictEqual(map.getProvinceByPosition(209, 159)?.id, 1);
			assert.strictEqual(map.getProvinceByPosition(100, 80)?.id, 1);
			assert.strictEqual(map.getProvinceByPosition(210, 160), undefined);
			assert.strictEqual(map.getProvinceByPosition(507, 507)?.id, 2);
			assert.strictEqual(map.getProvinceByPosition(300, 300), undefined);
			assert.strictEqual(map.getProvinceByPosition(-5, -5), undefined);
			assert.strictEqual(map.getProvinceByPosition(10000, 10000), undefined);
		});

		it("matches a full scan on a 15000-province map and stays fast", function () {
			this.timeout(20000);
			const tile = 32;
			const cols = 150;
			const rows = 100;
			const provinces: any[] = [undefined];
			for (let row = 0; row < rows; row++) {
				for (let col = 0; col < cols; col++) {
					const x = col * tile;
					const y = row * tile;
					provinces.push({
						id: provinces.length,
						boundingBox: { x, y, w: tile, h: tile },
						// Leave a one-pixel gutter uncovered so some lookups miss.
						coverZones: [{ x: x + 1, y: y + 1, w: tile - 2, h: tile - 2 }],
					});
				}
			}
			const map = new FEWorldMapClass({
				provinces,
				provincesCount: provinces.length,
				badProvincesCount: 0,
			} as any);

			let seed = 12345;
			const random = (): number => {
				seed = (seed * 1103515245 + 12345) % 2147483648;
				return seed / 2147483648;
			};
			const points = Array.from({ length: 2000 }, () => ({
				x: Math.floor(random() * (cols * tile + 20)) - 10,
				y: Math.floor(random() * (rows * tile + 20)) - 10,
			}));
			const bruteForce = (x: number, y: number): number | undefined => {
				for (let i = 1; i < provinces.length; i++) {
					const p = provinces[i];
					if (
						inBBox({ x, y }, p.boundingBox) &&
						p.coverZones.some((z: Zone) => inBBox({ x, y }, z))
					) {
						return p.id;
					}
				}
				return undefined;
			};

			map.getProvinceByPosition(0, 0);
			const start = performance.now();
			const indexed = points.map((p) => map.getProvinceByPosition(p.x, p.y)?.id);
			const elapsed = performance.now() - start;

			const expected = points.map((p) => bruteForce(p.x, p.y));
			assert.deepStrictEqual(indexed, expected);
			assert.ok(expected.some((id) => id !== undefined));
			assert.ok(expected.some((id) => id === undefined));
			assert.ok(elapsed < 100, `2000 indexed lookups took ${elapsed}ms`);
		});

		it("builds the forward maps used by the renderer", function () {
			const map = buildMap();
			assert.deepStrictEqual(map.getProvinceToStateMap(), {
				10: 1,
				11: 1,
				20: 2,
			});
			assert.deepStrictEqual(map.getProvinceToStrategicRegionMap(), {
				10: 1,
				20: 1,
			});
			assert.deepStrictEqual(map.getStateToSupplyAreaMap(), { 1: 1, 2: 1 });
		});
	});

	describe("memoization", function () {
		it("returns the same map instance on repeated calls", function () {
			const map = buildMap();
			assert.strictEqual(
				map.getProvinceToStateMap(),
				map.getProvinceToStateMap(),
			);
			assert.strictEqual(
				map.getProvinceToStrategicRegionMap(),
				map.getProvinceToStrategicRegionMap(),
			);
			assert.strictEqual(
				map.getStateToSupplyAreaMap(),
				map.getStateToSupplyAreaMap(),
			);
		});

		it("scopes memoized maps strictly per instance", function () {
			const a = buildMap();
			const b = buildMap();
			assert.notStrictEqual(
				a.getProvinceToStateMap(),
				b.getProvinceToStateMap(),
			);
			assert.notStrictEqual(
				a.getProvinceToStrategicRegionMap(),
				b.getProvinceToStrategicRegionMap(),
			);
			assert.notStrictEqual(
				a.getStateToSupplyAreaMap(),
				b.getStateToSupplyAreaMap(),
			);
		});
	});
});

describe("webview/worldmap/FEWorldMapClass warning lookups", function () {
	const province = { id: 10, color: 0x101010 };
	const otherProvince = { id: 11, color: 0x111111 };
	const state = { id: 1 };
	const strategicRegion = { id: 1 };
	const supplyArea = { id: 1 };

	function buildWarnedMap(sourceReads?: { count: number }) {
		const warnings = [
			{
				text: "province by id",
				source: [{ type: "province", id: 10, color: 0x999999 }],
			},
			{
				text: "province by color",
				source: [{ type: "province", id: null, color: 0x101010 }],
			},
			{
				text: "province and its state",
				source: [
					{ type: "province", id: 10, color: 0x101010 },
					{ type: "state", id: 1 },
				],
			},
			{ text: "state", source: [{ type: "state", id: 1 }] },
			{
				text: "strategic region",
				source: [{ type: "strategicregion", id: 1 }],
			},
			{ text: "supply area", source: [{ type: "supplyarea", id: 1 }] },
			{ text: "river", source: [{ type: "river", index: 2, name: "r" }] },
			{ text: "other state", source: [{ type: "state", id: 2 }] },
		].map((warning) =>
			sourceReads
				? Object.defineProperty({ text: warning.text }, "source", {
						get() {
							sourceReads.count++;
							return warning.source;
						},
					})
				: warning,
		);
		return new FEWorldMapClass({ warnings } as any);
	}

	it("finds province warnings by id or by colour", function () {
		const map = buildWarnedMap();
		assert.deepStrictEqual(map.getProvinceWarnings(province as any), [
			"province by id",
			"province by color",
			"province and its state",
		]);
		assert.deepStrictEqual(map.getProvinceWarnings(otherProvince as any), []);
	});

	it("reports a warning once when several of its sources match, in file order", function () {
		const map = buildWarnedMap();
		assert.deepStrictEqual(
			map.getProvinceWarnings(
				province as any,
				state as any,
				strategicRegion as any,
				supplyArea as any,
			),
			[
				"province by id",
				"province by color",
				"province and its state",
				"state",
				"strategic region",
				"supply area",
			],
		);
		assert.deepStrictEqual(map.getProvinceWarnings(), []);
	});

	it("finds state, strategic region, supply area and river warnings", function () {
		const map = buildWarnedMap();
		assert.deepStrictEqual(map.getStateWarnings(state as any), [
			"province and its state",
			"state",
		]);
		assert.deepStrictEqual(
			map.getStateWarnings(state as any, supplyArea as any),
			["province and its state", "state", "supply area"],
		);
		assert.deepStrictEqual(
			map.getStrategicRegionWarnings(strategicRegion as any),
			["strategic region"],
		);
		assert.deepStrictEqual(map.getSupplyAreaWarnings(supplyArea as any), [
			"supply area",
		]);
		assert.deepStrictEqual(map.getRiverWarnings(2), ["river"]);
		assert.deepStrictEqual(map.getRiverWarnings(3), []);
	});

	it("answers the predicates the same as the getters", function () {
		const map = buildWarnedMap();
		assert.strictEqual(map.hasProvinceWarnings(province as any), true);
		assert.strictEqual(map.hasProvinceWarnings(otherProvince as any), false);
		assert.strictEqual(
			map.hasProvinceWarnings(otherProvince as any, state as any),
			true,
		);
		assert.strictEqual(
			map.hasProvinceWarnings(undefined, undefined, strategicRegion as any),
			true,
		);
		assert.strictEqual(
			map.hasProvinceWarnings(undefined, undefined, undefined, supplyArea as any),
			true,
		);
		assert.strictEqual(map.hasProvinceWarnings(), false);
		assert.strictEqual(map.hasRiverWarnings(2), true);
		assert.strictEqual(map.hasRiverWarnings(3), false);
	});

	it("reads the warning sources once per instance", function () {
		const reads = { count: 0 };
		const map = buildWarnedMap(reads);
		map.hasProvinceWarnings(province as any);
		map.getProvinceWarnings(province as any, state as any);
		map.getStateWarnings(state as any);
		map.hasRiverWarnings(2);
		assert.strictEqual(reads.count, 8);
	});
});

describe("webview/worldmap/Loader protocol", function () {
	it("applies requested chunks and later deltas after a map summary", function () {
		const posted: unknown[] = [];
		const originalPostMessage = vscode.postMessage;
		const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
		globalThis.requestAnimationFrame = (callback): number => {
			callback(0);
			return 0;
		};
		vscode.postMessage = <T>(message: T): void => {
			posted.push(message);
		};
		const loader = new Loader();
		posted.length = 0;

		const summary: WorldMapData = {
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
			countriesCount: 1,
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
		};
		const send = (data: unknown): void => {
			window.dispatchEvent(new window.MessageEvent("message", { data }));
		};

		try {
			send({ command: "provincemapsummary", data: summary });
			assert.deepStrictEqual(posted, [
				{ command: "requestcountries", start: 0, end: 1 },
			]);

			send({
				command: "countries",
				data: JSON.stringify([{ tag: "AAA", color: 1 }]),
				start: 0,
				end: 1,
			});
			assert.strictEqual(loader.worldMap.countries[0].tag, "AAA");
			assert.strictEqual(loader.loading$.getValue(), false);
			assert.strictEqual(loader.progress, 1);

			const updated: WorldMapData = {
				...summary,
				countries: [{ tag: "BBB", color: 2 }],
				warnings: [{ text: "updated", source: [], relatedFiles: [] }],
			};
			const messages = buildWorldMapChangeMessages(
				{ ...summary, countries: [{ tag: "AAA", color: 1 }] },
				updated,
			);
			assert.deepStrictEqual(
				messages?.map((message) => message.command),
				["warnings", "countries"],
			);
			for (const message of messages ?? []) {
				send(message);
			}

			assert.strictEqual(loader.worldMap.warnings[0].text, "updated");
			assert.strictEqual(loader.worldMap.countries[0].tag, "BBB");
		} finally {
			loader.dispose();
			vscode.postMessage = originalPostMessage;
			globalThis.requestAnimationFrame = originalRequestAnimationFrame;
		}
	});
});
