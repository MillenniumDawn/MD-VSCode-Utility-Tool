import "./setup";
import * as assert from "assert";
import { Province, State } from "../../previewdef/worldmap/definitions";
import { FEWorldMapClass } from "../../../webviewsrc/worldmap/loader";
import {
	getColorByColorSet,
	getHighConstrastColor,
	landNoWarning,
	landWarning,
	toColor,
	waterWarning,
} from "../../../webviewsrc/worldmap/colors";
import {
	isEdgeVisible,
	isLabelVisible,
	isRiverVisible,
	renderAllOffsets,
	RenderContext,
} from "../../../webviewsrc/worldmap/renderContext";
import {
	getResourcesSize,
	renderMapLabels,
} from "../../../webviewsrc/worldmap/stateLayer";
import { renderAllEdges } from "../../../webviewsrc/worldmap/provinceLayer";
import {
	renderHoverSelectionByViewMode,
	renderLoadingText,
	renderRivers,
	renderSupplyRelated,
} from "../../../webviewsrc/worldmap/overlayLayer";
import { Renderer } from "../../../webviewsrc/worldmap/renderer";
import { TopBar, topBarHeight } from "../../../webviewsrc/worldmap/topbar";
import { ViewPoint } from "../../../webviewsrc/worldmap/viewpoint";

function province(overrides: Partial<Province> = {}): Province {
	return {
		id: 1,
		color: 0xabcdef,
		type: "land",
		coastal: false,
		terrain: "plains",
		continent: 1,
		boundingBox: { x: 0, y: 0, w: 2, h: 2 },
		coverZones: [{ x: 0, y: 0, w: 2, h: 2 }],
		centerOfMass: { x: 1, y: 1 },
		edges: [],
		...overrides,
	} as Province;
}

function emptyMap(overrides: Record<string, unknown> = {}) {
	return new FEWorldMapClass({
		width: 8,
		height: 8,
		provinces: [],
		provincesCount: 0,
		states: [],
		statesCount: 0,
		countries: [],
		warnings: [],
		continents: [],
		terrains: [],
		strategicRegions: [],
		supplyAreas: [],
		railways: [],
		supplyNodes: [],
		resources: [],
		rivers: [],
		badProvincesCount: 0,
		badStatesCount: 0,
		badStrategicRegionsCount: 0,
		badSupplyAreasCount: 0,
		countriesCount: 0,
		railwaysCount: 0,
		supplyNodesCount: 0,
		...overrides,
	} as any);
}

function context(overrides: Partial<RenderContext> = {}): RenderContext {
	return {
		topBar: {
			viewMode$: { value: "province" },
			colorSet$: { value: "provinceid" },
			warningFilter: { selectedValues$: { value: ["province"] } },
			display: { selectedValues$: { value: [] } },
		} as unknown as TopBar,
		viewPoint: { scale: 1 } as ViewPoint,
		mapCanvasContext: {} as CanvasRenderingContext2D,
		provinceToState: {},
		provinceToStrategicRegion: {},
		stateToSupplyArea: {},
		renderedProvincesByOffset: {},
		renderedProvincesById: {},
		extraState: undefined,
		...overrides,
	};
}

function displayBar(selected: string[], viewMode = "province") {
	return {
		viewMode$: { value: viewMode },
		display: { selectedValues$: { value: selected } },
	} as unknown as TopBar;
}

function recordingContext() {
	const calls: {
		method: string;
		fillStyle: string;
		strokeStyle: string;
		lineWidth: number;
		args: unknown[];
	}[] = [];
	const canvasContext: any = {
		fillStyle: "",
		strokeStyle: "",
		font: "",
		textAlign: "",
		textBaseline: "",
		lineWidth: 0,
		fillRect(...args: unknown[]) {
			calls.push(record("fillRect", args));
		},
		beginPath() {
			calls.push(record("beginPath", []));
		},
		moveTo(...args: unknown[]) {
			calls.push(record("moveTo", args));
		},
		lineTo(...args: unknown[]) {
			calls.push(record("lineTo", args));
		},
		stroke() {
			calls.push(record("stroke", []));
		},
		fillText(...args: unknown[]) {
			calls.push(record("fillText", args));
		},
		strokeRect(...args: unknown[]) {
			calls.push(record("strokeRect", args));
		},
		measureText() {
			return { width: 0 };
		},
		drawImage() {},
	};
	function record(method: string, args: unknown[]) {
		return {
			method,
			fillStyle: canvasContext.fillStyle,
			strokeStyle: canvasContext.strokeStyle,
			lineWidth: canvasContext.lineWidth,
			args,
		};
	}
	return { canvasContext, calls };
}

function identityViewPoint(): ViewPoint {
	return {
		scale: 1,
		bboxInView: (_box: unknown, xOffset: number) => xOffset === 0,
		lineInView: () => false,
		convertX: (x: number) => x,
		convertY: (y: number) => y,
		convertBackX: (x: number) => x,
		convertBackY: (y: number) => y,
	} as unknown as ViewPoint;
}

function sharedEdge(
	type = "",
	path: { x: number; y: number }[][] = [
		[
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
		],
	],
) {
	const a = province({
		id: 1,
		edges: [{ to: 2, type, path: [] } as any],
	});
	const b = province({
		id: 2,
		boundingBox: { x: 2, y: 0, w: 2, h: 2 },
		coverZones: [{ x: 2, y: 0, w: 2, h: 2 }],
		centerOfMass: { x: 3, y: 1 },
		edges: [{ to: 1, type, path } as any],
	});
	return { a, b };
}

function drewStroke(
	calls: { method: string; strokeStyle: string; args: unknown[] }[],
	style: string,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
) {
	return (
		calls.some(
			(call) =>
				call.method === "moveTo" &&
				call.strokeStyle === style &&
				call.args[0] === x0 &&
				call.args[1] === y0,
		) &&
		calls.some(
			(call) =>
				call.method === "lineTo" &&
				call.strokeStyle === style &&
				call.args[0] === x1 &&
				call.args[1] === y1,
		)
	);
}

function paintEdges(
	viewMode: string,
	provinceToState: Record<number, number | undefined>,
	provinceToStrategicRegion: Record<number, number | undefined> = {},
	stateToSupplyArea: Record<number, number | undefined> = {},
	mapOverrides: Record<string, unknown> = {},
	edgeType = "",
	path?: { x: number; y: number }[][],
) {
	const { a, b } = sharedEdge(edgeType, path);
	const { canvasContext, calls } = recordingContext();
	const worldMap = emptyMap({
		provinces: [undefined, a, b],
		provincesCount: 3,
		...mapOverrides,
	});
	renderAllEdges(
		context({
			topBar: {
				viewMode$: { value: viewMode },
				display: { selectedValues$: { value: ["edge"] } },
			} as unknown as TopBar,
			viewPoint: identityViewPoint(),
			provinceToState,
			provinceToStrategicRegion,
			stateToSupplyArea,
			renderedProvincesByOffset: { 0: [a, b] },
			renderedProvinces: [a, b],
			preciseEdge: true,
		}),
		worldMap,
		canvasContext,
		0,
	);
	return calls;
}

describe("webview/worldmap/colors", function () {
	it("pads a colour number to a six-digit CSS hex", function () {
		assert.strictEqual(toColor(0), "#000000");
		assert.strictEqual(toColor(0xff), "#0000ff");
		assert.strictEqual(toColor(0xabcdef), "#abcdef");
	});

	it("or's coastal onto the land, lake and sea type colours", function () {
		const map = emptyMap();
		const renderContext = context();
		assert.strictEqual(
			getColorByColorSet(
				"provincetype",
				province({ type: "land", coastal: false }),
				map,
				renderContext,
			),
			0x007f00,
		);
		assert.strictEqual(
			getColorByColorSet(
				"provincetype",
				province({ type: "land", coastal: true }),
				map,
				renderContext,
			),
			0x7f7f00,
		);
		assert.strictEqual(
			getColorByColorSet(
				"provincetype",
				province({ type: "sea", coastal: false }),
				map,
				renderContext,
			),
			0x00007f,
		);
		assert.strictEqual(
			getColorByColorSet(
				"provincetype",
				province({ type: "lake", coastal: true }),
				map,
				renderContext,
			),
			0x7fffff,
		);
	});

	it("keeps a sea province on the water default under manpower", function () {
		const color = getColorByColorSet(
			"manpower",
			province({ type: "sea" }),
			emptyMap(),
			context(),
		);
		assert.strictEqual(color, 0x1010b0);
	});

	it("paints a warned land province red and a clean one green", function () {
		const warned = province({ id: 1, color: 0x111111 });
		const map = emptyMap({
			provinces: [undefined, warned],
			provincesCount: 2,
			warnings: [
				{
					text: "bad",
					source: [{ type: "province", id: 1, color: 0x111111 }],
				},
			],
		});
		assert.strictEqual(
			getColorByColorSet("warnings", warned, map, context()),
			landWarning,
		);
		assert.strictEqual(
			getColorByColorSet(
				"warnings",
				province({ id: 2, type: "land" }),
				map,
				context(),
			),
			landNoWarning,
		);
	});

	it("drops province warnings when the warnings view filters them out", function () {
		const warned = province({ id: 1, color: 0x111111 });
		const map = emptyMap({
			provinces: [undefined, warned],
			provincesCount: 2,
			warnings: [
				{
					text: "bad",
					source: [{ type: "province", id: 1, color: 0x111111 }],
				},
			],
		});
		const color = getColorByColorSet(
			"warnings",
			warned,
			map,
			context({
				topBar: {
					viewMode$: { value: "warnings" },
					warningFilter: { selectedValues$: { value: [] } },
				} as unknown as TopBar,
			}),
		);
		assert.strictEqual(color, landNoWarning);
	});

	it("picks white text on a dark fill and black text on a light one", function () {
		assert.strictEqual(getHighConstrastColor(0), 0xffffff);
		assert.strictEqual(getHighConstrastColor(0xffffff), 0);
	});
});

describe("webview/worldmap/renderContext", function () {
	it("follows the display list when adapt-zooming is off", function () {
		assert.strictEqual(
			isEdgeVisible(displayBar(["edge"]), { scale: 0.1 } as ViewPoint),
			true,
		);
		assert.strictEqual(
			isEdgeVisible(displayBar([]), { scale: 8 } as ViewPoint),
			false,
		);
		assert.strictEqual(
			isRiverVisible(displayBar(["river"]), { scale: 0.1 } as ViewPoint),
			true,
		);
	});

	it("hides province edges until the zoom reaches the view-mode floor", function () {
		const topBar = displayBar(["edge", "adaptzooming"], "province");
		assert.strictEqual(
			isEdgeVisible(topBar, { scale: 1.99 } as ViewPoint),
			false,
		);
		assert.strictEqual(isEdgeVisible(topBar, { scale: 2 } as ViewPoint), true);
	});

	it("hides province labels until the zoom reaches the view-mode floor", function () {
		const topBar = displayBar(["label", "adaptzooming"], "province");
		assert.strictEqual(
			isLabelVisible(topBar, { scale: 2.99 } as ViewPoint),
			false,
		);
		assert.strictEqual(isLabelVisible(topBar, { scale: 3 } as ViewPoint), true);
	});

	it("hides rivers under adapt-zooming when the scale is below 1", function () {
		const topBar = displayBar(["river", "adaptzooming"]);
		assert.strictEqual(
			isRiverVisible(topBar, { scale: 0.5 } as ViewPoint),
			false,
		);
		assert.strictEqual(isRiverVisible(topBar, { scale: 1 } as ViewPoint), true);
	});

	it("paints every wrap that is still in view", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: (_box: unknown, xOffset: number) => xOffset < 20,
		} as ViewPoint;
		renderAllOffsets(viewPoint, { x: 0, y: 0, w: 10, h: 10 }, 10, (xOffset) =>
			offsets.push(xOffset),
		);
		assert.deepStrictEqual(offsets, [0, 10]);
	});

	it("returns after the first wrap when the step is 0", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: () => true,
		} as unknown as ViewPoint;
		renderAllOffsets(viewPoint, { x: 0, y: 0, w: 10, h: 10 }, 0, (xOffset) =>
			offsets.push(xOffset),
		);
		assert.deepStrictEqual(offsets, [0]);
	});

	it("does not paint a wrap that is out of view", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: () => false,
		} as unknown as ViewPoint;
		renderAllOffsets(viewPoint, { x: 0, y: 0, w: 10, h: 10 }, 10, (xOffset) =>
			offsets.push(xOffset),
		);
		assert.deepStrictEqual(offsets, []);
	});
});

describe("webview/worldmap/stateLayer", function () {
	it("sizes a missing resource icon as a 24-pixel square plus the label", function () {
		assert.deepStrictEqual(
			getResourcesSize({ resources: { steel: 5 } } as unknown as State, 1, 30),
			{ width: 54, height: 24 },
		);
	});

	it("skips a resource whose count is zero", function () {
		assert.deepStrictEqual(
			getResourcesSize(
				{ resources: { steel: 0, oil: 2 } } as unknown as State,
				1,
				10,
			),
			{ width: 34, height: 24 },
		);
	});

	it("writes each province id in province view", function () {
		const p = province({ id: 1, centerOfMass: { x: 1, y: 1 } });
		const { canvasContext, calls } = recordingContext();
		renderMapLabels(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesByOffset: { 0: [p] },
			}),
			emptyMap({ provinces: [undefined, p], provincesCount: 2 }),
			canvasContext,
			0,
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillText" &&
					call.args[0] === "1" &&
					call.args[1] === 1 &&
					call.args[2] === 1,
			),
		);
	});

	it("writes a state id once for every province in that state", function () {
		const p1 = province({ id: 1 });
		const p2 = province({ id: 2 });
		const { canvasContext, calls } = recordingContext();
		renderMapLabels(
			context({
				viewPoint: identityViewPoint(),
				topBar: {
					viewMode$: { value: "state" },
					colorSet$: { value: "provinceid" },
					display: { selectedValues$: { value: [] } },
				} as unknown as TopBar,
				provinceToState: { 1: 1, 2: 1 },
				renderedProvincesByOffset: { 0: [p1, p2] },
			}),
			emptyMap({
				provinces: [undefined, p1, p2],
				provincesCount: 3,
				states: [
					undefined,
					{ id: 1, provinces: [1, 2], centerOfMass: { x: 5, y: 6 } },
				],
				statesCount: 2,
			}),
			canvasContext,
			0,
		);
		const labels = calls.filter(
			(call) => call.method === "fillText" && call.args[0] === "1",
		);
		assert.strictEqual(labels.length, 1);
		assert.deepStrictEqual(labels[0]?.args.slice(1), [5, 6]);
	});
});

describe("webview/worldmap/Renderer.renderMapImpl", function () {
	it("fills each in-view province with its colour", function () {
		const { canvasContext, calls } = recordingContext();
		const canvasPrototype = (window as any).HTMLCanvasElement.prototype;
		const originalGetContext = canvasPrototype.getContext;
		canvasPrototype.getContext = () => canvasContext;

		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;

		const land = province({
			id: 1,
			color: 0xff0000,
			coverZones: [{ x: 1, y: 2, w: 3, h: 4 }],
			boundingBox: { x: 1, y: 2, w: 3, h: 4 },
			edges: [],
		});
		const worldMap = emptyMap({
			provinces: [undefined, land],
			provincesCount: 2,
		});
		const topBar = {
			viewMode$: { value: "province" },
			colorSet$: { value: "provinceid" },
			warningFilter: { selectedValues$: { value: [] } },
			display: { selectedValues$: { value: [] } },
		} as unknown as TopBar;
		const viewPoint = {
			scale: 1,
			bboxInView: (_box: unknown, xOffset: number) => xOffset === 0,
			lineInView: () => false,
			convertX: (x: number) => x,
			convertY: (y: number) => y,
		} as unknown as ViewPoint;

		try {
			Renderer.renderMapImpl(canvas, topBar, viewPoint, worldMap, {
				preciseEdge: true,
				overwriteRenderPrecision: 1,
			});
		} finally {
			canvasPrototype.getContext = originalGetContext;
		}

		const provinceFill = calls.find(
			(call) =>
				call.method === "fillRect" &&
				call.fillStyle === "#ff0000" &&
				call.args[0] === 1 &&
				call.args[1] === 2 &&
				call.args[2] === 3 &&
				call.args[3] === 4,
		);
		assert.ok(provinceFill);
	});

	it("strokes edges when the display list includes edge", function () {
		const { a, b } = sharedEdge();
		const { canvasContext, calls } = recordingContext();
		const canvasPrototype = (window as any).HTMLCanvasElement.prototype;
		const originalGetContext = canvasPrototype.getContext;
		canvasPrototype.getContext = () => canvasContext;
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		try {
			Renderer.renderMapImpl(
				canvas,
				{
					viewMode$: { value: "province" },
					colorSet$: { value: "provinceid" },
					warningFilter: { selectedValues$: { value: [] } },
					display: { selectedValues$: { value: ["edge"] } },
				} as unknown as TopBar,
				identityViewPoint(),
				emptyMap({
					provinces: [undefined, a, b],
					provincesCount: 3,
				}),
				{ preciseEdge: true, overwriteRenderPrecision: 1 },
			);
		} finally {
			canvasPrototype.getContext = originalGetContext;
		}
		assert.ok(drewStroke(calls, "black", 2, 0, 2, 2));
	});
});

describe("webview/worldmap/provinceLayer edges", function () {
	it("draws a passable shared edge only from the lower neighbour", function () {
		const calls = paintEdges("province", {});
		assert.ok(drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("hides an intra-state edge in state view", function () {
		const calls = paintEdges("state", { 1: 1, 2: 1 }, { 1: 1, 2: 1 });
		assert.ok(!drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("draws an inter-state edge in state view", function () {
		const calls = paintEdges(
			"state",
			{ 1: 1, 2: 2 },
			{ 1: 1, 2: 2 },
			{},
			{
				states: [
					undefined,
					{ id: 1, provinces: [1], impassable: false },
					{ id: 2, provinces: [2], impassable: false },
				],
				statesCount: 3,
			},
		);
		assert.ok(drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("hides an intra-region edge in strategicregion view", function () {
		const calls = paintEdges("strategicregion", {}, { 1: 7, 2: 7 });
		assert.ok(!drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("draws an inter-region edge in strategicregion view", function () {
		const calls = paintEdges("strategicregion", {}, { 1: 7, 2: 8 });
		assert.ok(drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("hides an inter-state edge that shares a supply area", function () {
		const calls = paintEdges(
			"supplyarea",
			{ 1: 1, 2: 2 },
			{ 1: 7, 2: 8 },
			{ 1: 3, 2: 3 },
		);
		assert.ok(!drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("draws an inter-state edge whose supply areas differ", function () {
		const calls = paintEdges(
			"supplyarea",
			{ 1: 1, 2: 2 },
			{ 1: 7, 2: 8 },
			{ 1: 3, 2: 4 },
		);
		assert.ok(drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("still draws an impassable intra-state edge in red", function () {
		const calls = paintEdges(
			"state",
			{ 1: 1, 2: 1 },
			{ 1: 1, 2: 1 },
			{},
			{},
			"impassable",
		);
		assert.ok(drewStroke(calls, "red", 2, 0, 2, 2));
		assert.ok(!drewStroke(calls, "black", 2, 0, 2, 2));
	});

	it("skips interior points on a dense edge when preciseEdge is off", function () {
		const points = [];
		for (let y = 0; y <= 10; y++) {
			points.push({ x: 2, y });
		}
		const { a, b } = sharedEdge("", [points]);
		const { canvasContext, calls } = recordingContext();
		renderAllEdges(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesByOffset: { 0: [a, b] },
				renderedProvinces: [a, b],
				preciseEdge: false,
			}),
			emptyMap({ provinces: [undefined, a, b], provincesCount: 3 }),
			canvasContext,
			0,
		);
		assert.deepStrictEqual(
			calls
				.filter(
					(call) => call.method === "lineTo" && call.strokeStyle === "black",
				)
				.map((call) => call.args[1]),
			[0, 5, 10],
		);
	});

	it("keeps a sharp bend even when preciseEdge is off", function () {
		const { a, b } = sharedEdge("", [
			[
				{ x: 2, y: 0 },
				{ x: 2, y: 1 },
				{ x: 10, y: 5 },
				{ x: 2, y: 9 },
				{ x: 2, y: 10 },
			],
		]);
		const { canvasContext, calls } = recordingContext();
		renderAllEdges(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesByOffset: { 0: [a, b] },
				renderedProvinces: [a, b],
				preciseEdge: false,
			}),
			emptyMap({ provinces: [undefined, a, b], provincesCount: 3 }),
			canvasContext,
			0,
		);
		assert.ok(drewStroke(calls, "black", 2, 0, 10, 5));
		assert.ok(
			calls.some(
				(call) =>
					call.method === "lineTo" &&
					call.strokeStyle === "black" &&
					call.args[0] === 2 &&
					call.args[1] === 10,
			),
		);
	});

	it("paints an empty-path adjacency in red between start and stop", function () {
		const a = province({ id: 1, edges: [] });
		const b = province({
			id: 2,
			edges: [
				{
					to: 1,
					type: "",
					path: [],
					start: { x: 0, y: 1 },
					stop: { x: 4, y: 1 },
				} as any,
			],
		});
		const { canvasContext, calls } = recordingContext();
		renderAllEdges(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesByOffset: { 0: [a, b] },
				renderedProvinces: [a, b],
				preciseEdge: true,
			}),
			emptyMap({ provinces: [undefined, a, b], provincesCount: 3 }),
			canvasContext,
			0,
		);
		assert.ok(drewStroke(calls, "red", 0, 1, 4, 1));
	});
});

describe("webview/worldmap/overlayLayer", function () {
	it("draws a railway through rendered provinces at twice the level, capped at 10", function () {
		const a = province({ id: 1, centerOfMass: { x: 1, y: 1 } });
		const b = province({ id: 2, centerOfMass: { x: 5, y: 1 } });
		const { canvasContext, calls } = recordingContext();
		renderSupplyRelated(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesById: { 1: a, 2: b },
			}),
			emptyMap({
				provinces: [undefined, a, b],
				provincesCount: 3,
				railways: [{ provinces: [1, 2], level: 8 }],
				railwaysCount: 1,
			}),
			canvasContext,
			0,
		);
		assert.ok(
			calls.some((call) => call.method === "stroke" && call.lineWidth === 10),
		);
		assert.ok(drewStroke(calls, "rgb(200, 0, 0)", 1, 1, 5, 1));
	});

	it("skips a railway whose provinces are all off-screen", function () {
		const a = province({ id: 1, centerOfMass: { x: 1, y: 1 } });
		const { canvasContext, calls } = recordingContext();
		renderSupplyRelated(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesById: {},
			}),
			emptyMap({
				provinces: [undefined, a],
				provincesCount: 2,
				railways: [{ provinces: [1], level: 2 }],
				railwaysCount: 1,
			}),
			canvasContext,
			0,
		);
		assert.ok(!calls.some((call) => call.method === "moveTo"));
	});

	it("paints a supply node as a square on a rendered province", function () {
		const a = province({ id: 1, centerOfMass: { x: 4, y: 6 } });
		const { canvasContext, calls } = recordingContext();
		renderSupplyRelated(
			context({
				viewPoint: identityViewPoint(),
				renderedProvincesById: { 1: a },
			}),
			emptyMap({
				provinces: [undefined, a],
				provincesCount: 2,
				supplyNodes: [{ province: 1, level: 1 }],
				supplyNodesCount: 1,
			}),
			canvasContext,
			0,
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === "rgb(200, 0, 0)" &&
					call.args[0] === -1 &&
					call.args[1] === 1 &&
					call.args[2] === 10 &&
					call.args[3] === 10,
			),
		);
	});

	it("paints a river pixel in the palette colour", function () {
		const { canvasContext, calls } = recordingContext();
		renderRivers(
			context({ viewPoint: identityViewPoint() }),
			emptyMap({
				rivers: [
					{
						boundingBox: { x: 3, y: 4, w: 2, h: 1 },
						colors: { "0": 0 },
					},
				],
			}),
			canvasContext,
			0,
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === "rgb(0, 255, 0)" &&
					call.args[0] === 3 &&
					call.args[1] === 4 &&
					call.args[2] === 1 &&
					call.args[3] === 1,
			),
		);
	});

	it("paints a warned deep river pixel in the water warning colour", function () {
		const { canvasContext, calls } = recordingContext();
		renderRivers(
			context({
				viewPoint: identityViewPoint(),
				topBar: {
					colorSet$: { value: "warnings" },
					warningFilter: { selectedValues$: { value: ["river"] } },
				} as unknown as TopBar,
			}),
			emptyMap({
				rivers: [
					{
						boundingBox: { x: 0, y: 0, w: 1, h: 1 },
						colors: { "0": 3 },
					},
				],
				warnings: [
					{
						text: "river",
						source: [{ type: "river", index: 0, name: "r" }],
					},
				],
			}),
			canvasContext,
			0,
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === toColor(waterWarning),
			),
		);
	});

	it("fills the selected province in green and the hovered one in white", function () {
		const selected = province({
			id: 1,
			coverZones: [{ x: 0, y: 0, w: 2, h: 2 }],
		});
		const hovered = province({
			id: 2,
			coverZones: [{ x: 4, y: 0, w: 2, h: 2 }],
			boundingBox: { x: 4, y: 0, w: 2, h: 2 },
			edges: [],
		});
		const { canvasContext, calls } = recordingContext();
		renderHoverSelectionByViewMode({
			backCanvasContext: canvasContext,
			viewPoint: identityViewPoint(),
			topBar: {
				viewMode$: { value: "province" },
				selectedProvinceId$: { value: 1 },
				hoverProvinceId$: { value: 2 },
				display: { selectedValues$: { value: ["mousehighlight"] } },
			} as unknown as TopBar,
			worldMap: emptyMap({
				width: 8,
				provinces: [undefined, selected, hovered],
				provincesCount: 3,
			}),
			cursorX: 10,
			cursorY: 10,
			canvasWidth: 400,
			canvasHeight: 400,
		});
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === "rgba(128, 255, 128, 0.7)",
			),
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === "rgba(255, 255, 255, 0.7)",
			),
		);
	});

	it("does not hover-highlight when mousehighlight is off", function () {
		const hovered = province({
			id: 2,
			coverZones: [{ x: 3, y: 0, w: 2, h: 2 }],
		});
		const { canvasContext, calls } = recordingContext();
		renderHoverSelectionByViewMode({
			backCanvasContext: canvasContext,
			viewPoint: identityViewPoint(),
			topBar: {
				viewMode$: { value: "province" },
				selectedProvinceId$: { value: undefined },
				hoverProvinceId$: { value: 2 },
				display: { selectedValues$: { value: [] } },
			} as unknown as TopBar,
			worldMap: emptyMap({
				width: 8,
				provinces: [undefined, undefined, hovered],
				provincesCount: 3,
			}),
			cursorX: 10,
			cursorY: 10,
			canvasWidth: 400,
			canvasHeight: 400,
		});
		assert.ok(!calls.some((call) => call.method === "fillRect"));
	});

	it("writes the hovered province id on the tooltip", function () {
		const hovered = province({ id: 2, type: "land", terrain: "plains" });
		const { canvasContext, calls } = recordingContext();
		renderHoverSelectionByViewMode({
			backCanvasContext: canvasContext,
			viewPoint: identityViewPoint(),
			topBar: {
				viewMode$: { value: "province" },
				selectedProvinceId$: { value: undefined },
				hoverProvinceId$: { value: 2 },
				display: { selectedValues$: { value: ["tooltip"] } },
			} as unknown as TopBar,
			worldMap: emptyMap({
				width: 8,
				height: 8,
				provinces: [undefined, undefined, hovered],
				provincesCount: 3,
				continents: ["", "Europe"],
			}),
			cursorX: 10,
			cursorY: 10,
			canvasWidth: 400,
			canvasHeight: 400,
		});
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillText" &&
					String(call.args[0]).includes("Province=2"),
			),
		);
	});

	it("fills every province in the selected state", function () {
		const p1 = province({
			id: 1,
			coverZones: [{ x: 0, y: 0, w: 2, h: 2 }],
		});
		const p2 = province({
			id: 2,
			coverZones: [{ x: 4, y: 0, w: 2, h: 2 }],
			boundingBox: { x: 4, y: 0, w: 2, h: 2 },
		});
		const { canvasContext, calls } = recordingContext();
		renderHoverSelectionByViewMode({
			backCanvasContext: canvasContext,
			viewPoint: identityViewPoint(),
			topBar: {
				viewMode$: { value: "state" },
				hoverStateId$: { value: undefined },
				selectedStateId$: { value: 1 },
				display: { selectedValues$: { value: [] } },
			} as unknown as TopBar,
			worldMap: emptyMap({
				width: 8,
				provinces: [undefined, p1, p2],
				provincesCount: 3,
				states: [undefined, { id: 1, provinces: [1, 2] }],
				statesCount: 2,
			}),
			cursorX: 10,
			cursorY: 10,
			canvasWidth: 400,
			canvasHeight: 400,
		});
		const green = calls.filter(
			(call) =>
				call.method === "fillRect" &&
				call.fillStyle === "rgba(128, 255, 128, 0.7)",
		);
		assert.strictEqual(green.length, 2);
	});

	it("fills adjacent provinces at a lower alpha when hovering", function () {
		const neighbour = province({
			id: 1,
			coverZones: [{ x: 0, y: 0, w: 2, h: 2 }],
		});
		const hovered = province({
			id: 2,
			coverZones: [{ x: 4, y: 0, w: 2, h: 2 }],
			boundingBox: { x: 4, y: 0, w: 2, h: 2 },
			edges: [{ to: 1, type: "", path: [] } as any],
		});
		const { canvasContext, calls } = recordingContext();
		renderHoverSelectionByViewMode({
			backCanvasContext: canvasContext,
			viewPoint: identityViewPoint(),
			topBar: {
				viewMode$: { value: "province" },
				selectedProvinceId$: { value: undefined },
				hoverProvinceId$: { value: 2 },
				display: { selectedValues$: { value: ["mousehighlight"] } },
			} as unknown as TopBar,
			worldMap: emptyMap({
				width: 8,
				provinces: [undefined, neighbour, hovered],
				provincesCount: 3,
			}),
			cursorX: 10,
			cursorY: 10,
			canvasWidth: 400,
			canvasHeight: 400,
		});
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillRect" &&
					call.fillStyle === "rgba(255, 255, 255, 0.3)",
			),
		);
	});

	it("paints loading text below the top bar", function () {
		const { canvasContext, calls } = recordingContext();
		renderLoadingText(canvasContext, "Loading");
		assert.ok(
			calls.some(
				(call) => call.method === "fillRect" && call.args[1] === topBarHeight,
			),
		);
		assert.ok(
			calls.some(
				(call) =>
					call.method === "fillText" &&
					call.args[0] === "Loading" &&
					call.args[1] === 10 &&
					call.args[2] === 10 + topBarHeight,
			),
		);
	});
});

describe("webview/worldmap/colors extra sets", function () {
	it("uses the owner country colour", function () {
		const p = province({ id: 1 });
		assert.strictEqual(
			getColorByColorSet(
				"country",
				p,
				emptyMap({
					states: [undefined, { id: 1, owner: "GER", provinces: [1] }],
					statesCount: 2,
					countries: [{ tag: "GER", color: 0x112233 }],
				}),
				context({ provinceToState: { 1: 1 } }),
			),
			0x112233,
		);
	});

	it("falls back when the owner country is missing", function () {
		assert.strictEqual(
			getColorByColorSet(
				"country",
				province({ id: 1, type: "land" }),
				emptyMap({
					states: [undefined, { id: 1, owner: "ZZZ", provinces: [1] }],
					statesCount: 2,
					countries: [],
				}),
				context({ provinceToState: { 1: 1 } }),
			),
			0,
		);
	});

	it("uses the named terrain colour", function () {
		assert.strictEqual(
			getColorByColorSet(
				"terrain",
				province({ terrain: "plains" }),
				emptyMap({
					terrains: [
						{ name: "plains", color: 0x445566, isNaval: false, file: "" },
					],
				}),
				context(),
			),
			0x445566,
		);
	});

	it("uses naval terrain for a sea province", function () {
		assert.strictEqual(
			getColorByColorSet(
				"terrain",
				province({ id: 1, type: "sea", terrain: "plains" }),
				emptyMap({
					terrains: [
						{ name: "plains", color: 0x445566, isNaval: false, file: "" },
						{ name: "ocean", color: 0x0000aa, isNaval: true, file: "" },
					],
					strategicRegions: [
						undefined,
						{ id: 1, provinces: [1], navalTerrain: "ocean" },
					],
					strategicRegionsCount: 2,
				}),
				context({ provinceToStrategicRegion: { 1: 1 } }),
			),
			0x0000aa,
		);
	});

	it("uses the land default for continent 0", function () {
		assert.strictEqual(
			getColorByColorSet(
				"continent",
				province({ type: "land", continent: 0 }),
				emptyMap(),
				context(),
			),
			0,
		);
	});

	it("maps max manpower to red and zero manpower to green", function () {
		const hot = province({ id: 1, type: "land" });
		const cold = province({ id: 2, type: "land" });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1], manpower: 32 },
				{ id: 2, provinces: [2], manpower: 0 },
			],
			statesCount: 3,
		});
		const renderContext = context({ provinceToState: { 1: 1, 2: 2 } });
		assert.strictEqual(
			getColorByColorSet("manpower", hot, map, renderContext),
			0xff0000,
		);
		assert.strictEqual(
			getColorByColorSet("manpower", cold, map, renderContext),
			0x00ff00,
		);
	});

	it("maps mid manpower through the yellow GYR stop", function () {
		const mid = province({ id: 2, type: "land" });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1], manpower: 32 },
				{ id: 2, provinces: [2], manpower: 1 },
			],
			statesCount: 3,
		});
		assert.strictEqual(
			getColorByColorSet(
				"manpower",
				mid,
				map,
				context({ provinceToState: { 1: 1, 2: 2 } }),
			),
			0xffff00,
		);
	});

	it("treats negative manpower as zero on the GYR scale", function () {
		const negative = province({ id: 2, type: "land" });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1], manpower: 32 },
				{ id: 2, provinces: [2], manpower: -5 },
			],
			statesCount: 3,
		});
		assert.strictEqual(
			getColorByColorSet(
				"manpower",
				negative,
				map,
				context({ provinceToState: { 1: 1, 2: 2 } }),
			),
			0x00ff00,
		);
	});

	it("maps the highest victory point to white and a missing one to near-black", function () {
		const scored = province({ id: 1 });
		const blank = province({ id: 2 });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1, 2], victoryPoints: { 1: 100 } },
			],
			statesCount: 2,
		});
		const renderContext = context({ provinceToState: { 1: 1, 2: 1 } });
		assert.strictEqual(
			getColorByColorSet("victorypoint", scored, map, renderContext),
			0xffffff,
		);
		assert.strictEqual(
			getColorByColorSet("victorypoint", blank, map, renderContext),
			0x080808,
		);
	});

	it("maps max resources to red and none to green", function () {
		const rich = province({ id: 1, type: "land" });
		const poor = province({ id: 2, type: "land" });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1], resources: { steel: 32 } },
				{ id: 2, provinces: [2], resources: {} },
			],
			statesCount: 3,
		});
		const renderContext = context({ provinceToState: { 1: 1, 2: 2 } });
		assert.strictEqual(
			getColorByColorSet("resources", rich, map, renderContext),
			0xff0000,
		);
		assert.strictEqual(
			getColorByColorSet("resources", poor, map, renderContext),
			0x00ff00,
		);
	});

	it("keeps a sea province on the water default under resources", function () {
		assert.strictEqual(
			getColorByColorSet(
				"resources",
				province({ type: "sea" }),
				emptyMap({
					states: [undefined, { id: 1, provinces: [1], resources: { steel: 8 } }],
					statesCount: 2,
				}),
				context({ provinceToState: { 1: 1 } }),
			),
			0x1010b0,
		);
	});

	it("maps supply value linearly onto the GYR scale", function () {
		const full = province({ id: 1, type: "land" });
		const half = province({ id: 2, type: "land" });
		const empty = province({ id: 3, type: "land" });
		const map = emptyMap({
			states: [
				undefined,
				{ id: 1, provinces: [1] },
				{ id: 2, provinces: [2] },
				{ id: 3, provinces: [3] },
			],
			statesCount: 4,
			supplyAreas: [
				undefined,
				{ id: 1, states: [1], value: 10 },
				{ id: 2, states: [2], value: 5 },
				{ id: 3, states: [3], value: 0 },
			],
			supplyAreasCount: 4,
		});
		const renderContext = context({
			provinceToState: { 1: 1, 2: 2, 3: 3 },
			stateToSupplyArea: { 1: 1, 2: 2, 3: 3 },
		});
		assert.strictEqual(
			getColorByColorSet("supplyvalue", full, map, renderContext),
			0xff0000,
		);
		assert.strictEqual(
			getColorByColorSet("supplyvalue", half, map, renderContext),
			0xffff00,
		);
		assert.strictEqual(
			getColorByColorSet("supplyvalue", empty, map, renderContext),
			0x00ff00,
		);
	});

	it("keeps a sea province on the water default under supply value", function () {
		assert.strictEqual(
			getColorByColorSet(
				"supplyvalue",
				province({ type: "sea" }),
				emptyMap({
					supplyAreas: [undefined, { id: 1, states: [1], value: 10 }],
					supplyAreasCount: 2,
				}),
				context(),
			),
			0x1010b0,
		);
	});
});
