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
} from "../../../webviewsrc/worldmap/colors";
import {
	isEdgeVisible,
	isLabelVisible,
	isRiverVisible,
	renderAllOffsets,
	RenderContext,
} from "../../../webviewsrc/worldmap/renderContext";
import { getResourcesSize } from "../../../webviewsrc/worldmap/stateLayer";
import { Renderer } from "../../../webviewsrc/worldmap/renderer";
import { TopBar } from "../../../webviewsrc/worldmap/topbar";
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
	const calls: { method: string; fillStyle: string; args: unknown[] }[] = [];
	const canvasContext: any = {
		fillStyle: "",
		strokeStyle: "",
		font: "",
		textAlign: "",
		textBaseline: "",
		lineWidth: 0,
		fillRect(...args: unknown[]) {
			calls.push({
				method: "fillRect",
				fillStyle: canvasContext.fillStyle,
				args,
			});
		},
		beginPath() {
			calls.push({
				method: "beginPath",
				fillStyle: canvasContext.fillStyle,
				args: [],
			});
		},
		moveTo() {},
		lineTo() {},
		stroke() {},
		fillText() {},
		strokeRect() {},
		measureText() {
			return { width: 0 };
		},
		drawImage() {},
	};
	return { canvasContext, calls };
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
		assert.strictEqual(isEdgeVisible(topBar, { scale: 1.99 } as ViewPoint), false);
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
		assert.strictEqual(isRiverVisible(topBar, { scale: 0.5 } as ViewPoint), false);
		assert.strictEqual(isRiverVisible(topBar, { scale: 1 } as ViewPoint), true);
	});

	it("paints every wrap that is still in view", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: (_box: unknown, xOffset: number) => xOffset < 20,
		} as ViewPoint;
		renderAllOffsets(
			viewPoint,
			{ x: 0, y: 0, w: 10, h: 10 },
			10,
			(xOffset) => offsets.push(xOffset),
		);
		assert.deepStrictEqual(offsets, [0, 10]);
	});

	it("returns after the first wrap when the step is 0", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: () => true,
		} as unknown as ViewPoint;
		renderAllOffsets(
			viewPoint,
			{ x: 0, y: 0, w: 10, h: 10 },
			0,
			(xOffset) => offsets.push(xOffset),
		);
		assert.deepStrictEqual(offsets, [0]);
	});

	it("does not paint a wrap that is out of view", function () {
		const offsets: number[] = [];
		const viewPoint = {
			bboxInView: () => false,
		} as unknown as ViewPoint;
		renderAllOffsets(
			viewPoint,
			{ x: 0, y: 0, w: 10, h: 10 },
			10,
			(xOffset) => offsets.push(xOffset),
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
});
