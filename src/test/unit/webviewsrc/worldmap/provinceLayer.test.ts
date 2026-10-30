import * as assert from "assert";
import type { Province, ProvinceEdge } from "../../../../../webviewsrc/worldmap/definitions";
import type { FEWorldMap } from "../../../../../webviewsrc/worldmap/loader";
import type { RenderContext } from "../../../../../webviewsrc/worldmap/renderContext";

function province(id: number, edge: ProvinceEdge): Province {
	return {
		id,
		edges: [edge],
		boundingBox: { x: 0, y: 0, w: 2, h: 2 },
	} as Province;
}

describe("worldmap provinceLayer edges", function () {
	afterEach(function () {
		delete (globalThis as any).window;
		delete (globalThis as any).acquireVsCodeApi;
	});

	it("classifies each rendered edge once and strokes black before red", function () {
		(globalThis as any).window = { __i18ntable: {} };
		(globalThis as any).acquireVsCodeApi = () => ({
			postMessage() {},
			getState() { return {}; },
			setState() {},
		});
		const { renderAllEdges } = require("../../../../../webviewsrc/worldmap/provinceLayer") as typeof import("../../../../../webviewsrc/worldmap/provinceLayer");
		const calls: string[] = [];
		let strokeStyle = "";
		const canvas = {
			set strokeStyle(value: string) {
				strokeStyle = value;
			},
			beginPath() {
				calls.push(`begin:${strokeStyle}`);
			},
			moveTo(x: number, y: number) {
				calls.push(`move:${strokeStyle}:${x},${y}`);
			},
			lineTo(x: number, y: number) {
				calls.push(`line:${strokeStyle}:${x},${y}`);
			},
			stroke() {
				calls.push(`stroke:${strokeStyle}`);
			},
		} as unknown as Parameters<typeof renderAllEdges>[2];
		const black = province(
			1,
			{ to: 0, type: "", path: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] } as ProvinceEdge,
		);
		const red = province(
			2,
			{ to: 0, type: "impassable", path: [[{ x: 2, y: 0 }, { x: 3, y: 1 }]] } as ProvinceEdge,
		);
		const higherNeighbor = province(
			3,
			{ to: 4, type: "", path: [[{ x: 4, y: 0 }, { x: 5, y: 1 }]] } as ProvinceEdge,
		);
		let stateLookups = 0;
		const worldMap = {
			getStateById() {
				stateLookups++;
				return undefined;
			},
		} as unknown as FEWorldMap;
		const renderContext = {
			renderedProvincesByOffset: { 0: [red, higherNeighbor, black] },
			renderedProvincesById: {},
			provinceToState: {},
			provinceToStrategicRegion: {},
			stateToSupplyArea: {},
			preciseEdge: true,
			viewPoint: {
				scale: 1,
				convertX: (x: number) => x,
				convertY: (y: number) => y,
			},
			topBar: { viewMode$: { value: "province" } },
		} as unknown as RenderContext;

		renderAllEdges(renderContext, worldMap, canvas, 0);

		assert.strictEqual(
			stateLookups,
			4,
			"two state lookups for each eligible edge; the higher-neighbor duplicate is skipped",
		);
		assert.ok(calls.includes("move:black:0,0"));
		assert.ok(calls.includes("line:black:1,1"));
		assert.ok(calls.includes("move:red:2,0"));
		assert.ok(calls.includes("line:red:3,1"));
		assert.ok(!calls.includes("move:black:4,0"), "the higher-neighbor duplicate is absent");
		assert.deepStrictEqual(
			calls.filter((call) => call.startsWith("stroke:")),
			["stroke:black", "stroke:red"],
		);
	});
});
