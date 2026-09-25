import * as assert from "assert";
import * as vscode from "vscode";
import type {
	Province,
	River,
	State,
	WorldMapWarning,
	Zone,
} from "../previewdef/worldmap/definitions";
import { mergeRegionWithWarnings } from "../previewdef/worldmap/loader/common";
import {
	fillRegions,
	RegionKind,
	sortRegionItems,
} from "../previewdef/worldmap/loader/regionloader";
import {
	calculateStateBoundingBox,
	sortStates,
	StateNoBoundingBox,
	validateProvinceInState,
	validateStateReferences,
} from "../previewdef/worldmap/loader/states";
import {
	findRiverPointsList,
	loadRivers,
	validateRivers,
} from "../previewdef/worldmap/loader/river";
import { parseBmp } from "../util/image/bmp/bmpparser";
import { UserError } from "../util/common";

const zone = (x: number, y: number, w = 1, h = 1): Zone => ({ x, y, w, h });

function province(
	id: number,
	boundingBox: Zone,
	type = "land",
): Province {
	return {
		id,
		color: id,
		type,
		coastal: false,
		terrain: "plains",
		continent: 1,
		boundingBox,
		centerOfMass: { x: boundingBox.x, y: boundingBox.y },
		mass: boundingBox.w * boundingBox.h,
		coverZones: [boundingBox],
		edges: [],
	};
}

function stateNoBox(
	id: number,
	provinces: number[],
	extra: Partial<StateNoBoundingBox> = {},
): StateNoBoundingBox {
	return {
		id,
		name: `s${id}`,
		manpower: 0,
		category: "city",
		owner: undefined,
		provinces,
		cores: [],
		impassable: false,
		impassableIgnoredLinks: [],
		victoryPoints: {},
		resources: {},
		file: `history/states/${id}.txt`,
		token: null,
		...extra,
	};
}

function state(
	id: number,
	provinces: number[],
	extra: Partial<State> = {},
): State {
	return {
		...stateNoBox(id, provinces),
		boundingBox: zone(0, 0),
		centerOfMass: { x: 0, y: 0 },
		mass: 1,
		...extra,
	};
}

const texts = (warnings: WorldMapWarning[]) => warnings.map((w) => w.text);

describe("previewdef/worldmap/loader states calculateStateBoundingBox", () => {
	const width = 100;
	const height = 100;
	const provinces: (Province | undefined)[] = [];
	provinces[1] = province(1, zone(10, 20, 3, 2));
	provinces[2] = province(2, zone(13, 20));
	provinces[3] = province(3, zone(0, 5));
	provinces[4] = province(4, zone(99, 5));
	provinces[5] = province(5, zone(0, 40, 60, 1));

	const rows: {
		name: string;
		provinces: number[];
		boundingBox: Zone;
		warnings: string[];
	}[] = [
		{
			name: "one province",
			provinces: [1],
			boundingBox: zone(10, 20, 3, 2),
			warnings: [],
		},
		{
			name: "two adjacent provinces",
			provinces: [1, 2],
			boundingBox: zone(10, 20, 4, 2),
			warnings: [],
		},
		{
			name: "provinces either side of the map wrap seam",
			provinces: [3, 4],
			boundingBox: zone(99, 5, 2, 1),
			warnings: [],
		},
		{
			name: "one unknown province next to a known one",
			provinces: [1, 7],
			boundingBox: zone(10, 20, 3, 2),
			warnings: ["Province 7 used in state 3 doesn't exist."],
		},
		{
			name: "only unknown provinces",
			provinces: [7, 8],
			boundingBox: zone(0, 0, 0, 0),
			warnings: [
				"Province 7 used in state 3 doesn't exist.",
				"Province 8 used in state 3 doesn't exist.",
				"State 3 doesn't have valid provinces.",
			],
		},
		{
			name: "no provinces at all",
			provinces: [],
			boundingBox: zone(0, 0, 0, 0),
			warnings: [],
		},
		{
			name: "a box wider than half the map",
			provinces: [5],
			boundingBox: zone(0, 40, 60, 1),
			warnings: ["State 3 is too large: 60x1."],
		},
	];

	for (const row of rows) {
		it(row.name, () => {
			const warnings: WorldMapWarning[] = [];
			const result = calculateStateBoundingBox(
				stateNoBox(3, row.provinces),
				provinces,
				width,
				height,
				warnings,
			);
			assert.deepStrictEqual(result.boundingBox, row.boundingBox);
			assert.deepStrictEqual(texts(warnings), row.warnings);
			for (const warning of warnings) {
				assert.deepStrictEqual(warning.source, [{ type: "state", id: 3 }]);
				assert.deepStrictEqual(warning.relatedFiles, [
					"history/states/3.txt",
				]);
			}
		});
	}

	it("puts the centre of mass across the wrap seam back on the map", () => {
		const result = calculateStateBoundingBox(
			stateNoBox(3, [3, 4]),
			provinces,
			width,
			height,
			[],
		);
		assert.deepStrictEqual(result.centerOfMass, { x: 99.5, y: 5 });
		assert.strictEqual(result.mass, 2);
	});
});

describe("previewdef/worldmap/loader/common mergeRegionWithWarnings", () => {
	it("tags warnings with the region's own source type and file", () => {
		const warnings: WorldMapWarning[] = [];
		const states = [undefined, state(1, [1], { boundingBox: zone(4, 4) })];
		const result = mergeRegionWithWarnings(
			{ id: 9, file: "map/supplyareas/9.txt", states: [1, 2] },
			"states",
			states,
			100,
			"supplyarea",
			warnings,
			(stateId) => `missing ${stateId}`,
			() => "none valid",
		);
		assert.deepStrictEqual(result.boundingBox, zone(4, 4));
		assert.deepStrictEqual(warnings, [
			{
				source: [{ type: "supplyarea", id: 9 }],
				relatedFiles: ["map/supplyareas/9.txt"],
				text: "missing 2",
			},
		]);
	});

	it("reports no valid sub-regions once, after every missing one", () => {
		const warnings: WorldMapWarning[] = [];
		mergeRegionWithWarnings(
			{ id: 4, file: "map/strategicregions/4.txt", provinces: [5, 6] },
			"provinces",
			[],
			100,
			"strategicregion",
			warnings,
			(provinceId) => `missing ${provinceId}`,
			() => "none valid",
		);
		assert.deepStrictEqual(texts(warnings), [
			"missing 5",
			"missing 6",
			"none valid",
		]);
		assert.ok(
			warnings.every(
				(w) => w.source[0]?.type === "strategicregion" && w.source[0].id === 4,
			),
		);
	});
});

describe("previewdef/worldmap/loader/regionloader", () => {
	const kind: RegionKind = {
		sourceType: "supplyarea",
		idTooLarge: [
			"worldmap.warnings.supplyareaidtoolarge",
			"Max supply area ID is too large: {0}.",
		],
		idConflict: [
			"worldmap.warnings.supplyareaidconflict",
			"There're more than one supply areas using ID {0}.",
		],
		notExist: [
			"worldmap.warnings.supplyareanotexist",
			"Supply area with id {0} doesn't exist.",
		],
		subRegionNotExist: [
			"worldmap.warnings.stateinsupplyareanotexist",
			"State {0} used in supply area {1} doesn't exist.",
		],
		noValidSubRegions: [
			"worldmap.warnings.supplyareanovalidstates",
			"Supply area {0} doesn't have valid states.",
		],
	};
	const area = (
		id: number,
		states: number[],
		file = `map/supplyareas/${id}.txt`,
	) => ({
		id,
		states,
		file,
	});

	it("sortRegionItems tags gap and conflict warnings with the kind's source type", () => {
		const warnings: WorldMapWarning[] = [];
		const { badId } = sortRegionItems(
			[area(1, [1]), area(3, [1]), area(1, [1], "dup.txt")],
			kind,
			warnings,
		);
		assert.strictEqual(badId, -2);
		assert.deepStrictEqual(warnings, [
			{
				source: [{ type: "supplyarea", id: -1 }],
				relatedFiles: ["dup.txt", "map/supplyareas/1.txt"],
				text: "There're more than one supply areas using ID 1.",
			},
			{
				source: [{ type: "supplyarea", id: 2 }],
				relatedFiles: [],
				text: "Supply area with id 2 doesn't exist.",
			},
		]);
	});

	it("fillRegions fills bad ids too, in order, and calls afterFill once per region", () => {
		const warnings: WorldMapWarning[] = [];
		const states = [undefined, state(1, [1], { boundingBox: zone(4, 4) })];
		const sorted: ReturnType<typeof area>[] = [];
		sorted[-1] = area(-1, [2]);
		sorted[1] = area(1, [1]);
		const filledIds: number[] = [];

		const { filled, badCount } = fillRegions(
			sorted,
			-2,
			"states",
			states,
			100,
			kind,
			warnings,
			(region) => filledIds.push(region.id),
		);

		assert.strictEqual(badCount, 1);
		assert.deepStrictEqual(filledIds, [-1, 1]);
		assert.deepStrictEqual(filled[1]?.boundingBox, zone(4, 4));
		assert.deepStrictEqual(texts(warnings), [
			"State 2 used in supply area -1 doesn't exist.",
			"Supply area -1 doesn't have valid states.",
		]);
	});
});

describe("previewdef/worldmap/loader states sortStates", () => {
	it("warns about gaps and duplicate ids and moves the loser to a bad id", () => {
		const first = stateNoBox(1, [1]);
		const fourth = stateNoBox(4, [4]);
		const duplicate = stateNoBox(1, [2], { file: "history/states/dup.txt" });
		const warnings: WorldMapWarning[] = [];

		const { sortedStates, badStateId } = sortStates(
			[first, fourth, duplicate],
			warnings,
		);

		assert.deepStrictEqual(texts(warnings), [
			"There're more than one states using state id 1.",
			"State with id 2-3 doesn't exist.",
		]);
		assert.deepStrictEqual(warnings[0]?.source, [{ type: "state", id: -1 }]);
		assert.deepStrictEqual(warnings[0]?.relatedFiles, [
			"history/states/dup.txt",
			"history/states/1.txt",
		]);
		assert.deepStrictEqual(warnings[1]?.source, [{ type: "state", id: 2 }]);
		assert.strictEqual(sortedStates[1], duplicate);
		assert.strictEqual(sortedStates[4], fourth);
		assert.strictEqual(sortedStates[-1], first);
		assert.strictEqual(first.id, -1);
		assert.strictEqual(badStateId, -2);
	});

	it("names a single missing id without a range", () => {
		const warnings: WorldMapWarning[] = [];
		sortStates([stateNoBox(1, [1]), stateNoBox(3, [3])], warnings);
		assert.deepStrictEqual(texts(warnings), ["State with id 2 doesn't exist."]);
	});

	it("throws when the largest id is over the limit", () => {
		assert.throws(
			() => sortStates([stateNoBox(10001, [1])], []),
			(e: unknown) =>
				e instanceof UserError &&
				e.message === "Max state id is too large: 10001",
		);
	});
});

describe("previewdef/worldmap/loader states validateStateReferences", () => {
	const categories = {
		city: { name: "city", color: 0, file: "common/state_category/city.txt" },
	};
	const resources = {
		aluminium: {
			name: "aluminium",
			iconFrame: 1,
			imageUri: "",
			file: "common/resources/00_resources.txt",
		},
	} as any;

	const rows: {
		name: string;
		category: string;
		resources: Record<string, number | undefined>;
		warnings: string[];
	}[] = [
		{
			name: "a known category and resource",
			category: "city",
			resources: { aluminium: 2 },
			warnings: [],
		},
		{
			name: "an unknown category",
			category: "rural",
			resources: {},
			warnings: ["State category of state 4 is not defined: rural."],
		},
		{
			name: "an unknown resource with a value",
			category: "city",
			resources: { oil: 3, aluminium: 2 },
			warnings: ["Resource oil used in state 4 is not defined."],
		},
		{
			name: "an unknown resource without a value",
			category: "city",
			resources: { steel: undefined },
			warnings: [],
		},
		{
			name: "both unknown, category first",
			category: "rural",
			resources: { oil: 3, rubber: 1 },
			warnings: [
				"State category of state 4 is not defined: rural.",
				"Resource oil used in state 4 is not defined.",
				"Resource rubber used in state 4 is not defined.",
			],
		},
	];

	for (const row of rows) {
		it(row.name, () => {
			const warnings: WorldMapWarning[] = [];
			validateStateReferences(
				state(4, [1], { category: row.category, resources: row.resources }),
				categories,
				resources,
				warnings,
			);
			assert.deepStrictEqual(texts(warnings), row.warnings);
			for (const warning of warnings) {
				assert.deepStrictEqual(warning.source, [{ type: "state", id: 4 }]);
				assert.deepStrictEqual(warning.relatedFiles, [
					"history/states/4.txt",
				]);
			}
		});
	}
});

describe("previewdef/worldmap/loader states validateProvinceInState", () => {
	const provinces: (Province | undefined)[] = [];
	provinces[5] = province(5, zone(5, 0));
	provinces[6] = province(6, zone(6, 0), "sea");
	provinces[7] = province(7, zone(7, 0));

	function statesFixture(): (State | undefined)[] {
		const states: (State | undefined)[] = [];
		states[-1] = state(-1, [7, 9], { file: "history/states/bad.txt" });
		states[1] = state(1, [5, 9]);
		states[2] = state(2, [5, 6]);
		states[3] = state(3, [7]);
		return states;
	}

	it("flags shared and sea provinces, counting the bad-id states", () => {
		const warnings: WorldMapWarning[] = [];
		validateProvinceInState(provinces, statesFixture(), 1, warnings);

		assert.deepStrictEqual(texts(warnings), [
			"Province 5 exists in multiple states: 1, 2.",
			"Sea province 6 shouldn't belong to a state.",
			"Province 7 exists in multiple states: -1, 3.",
		]);
		assert.deepStrictEqual(warnings[0]?.source, [
			{ type: "state", id: 2 },
			{ type: "state", id: 1 },
			{ type: "province", id: 5, color: 5 },
		]);
		assert.deepStrictEqual(warnings[0]?.relatedFiles, [
			"history/states/2.txt",
			"history/states/1.txt",
		]);
		assert.deepStrictEqual(warnings[1]?.source, [
			{ type: "state", id: 2 },
			{ type: "province", id: 6, color: 6 },
		]);
		assert.deepStrictEqual(warnings[2]?.relatedFiles, [
			"history/states/3.txt",
			"history/states/bad.txt",
		]);
	});

	it("skips the bad-id states when none are counted", () => {
		const warnings: WorldMapWarning[] = [];
		validateProvinceInState(provinces, statesFixture(), 0, warnings);
		assert.deepStrictEqual(texts(warnings), [
			"Province 5 exists in multiple states: 1, 2.",
			"Sea province 6 shouldn't belong to a state.",
		]);
	});
});

function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: number,
	pixels: Record<string, number> = {},
): Buffer {
	const bytesPerRow = ((((width * bitsPerPixel + 7) >> 3) + 3) & 0xfffffffc) >>> 0;
	const dataOffset = 54;
	const buf = Buffer.alloc(dataOffset + bytesPerRow * height, 200);
	buf.write("BM", 0, "ascii");
	buf.writeUInt32LE(dataOffset, 10);
	buf.writeUInt32LE(40, 14);
	buf.writeUInt32LE(width, 18);
	buf.writeUInt32LE(height, 22);
	buf.writeUInt16LE(bitsPerPixel, 28);
	buf.writeUInt32LE(0, 30);
	for (const key of Object.keys(pixels)) {
		const [x, y] = key.split(",").map(Number);
		buf[dataOffset + (height - 1 - y) * bytesPerRow + x] = pixels[key];
	}
	return buf;
}

// A source at (2, 1) flowing into a joining end at (4, 1).
const lineRiverPixels = { "2,1": 0, "3,1": 5, "4,1": 3 };

describe("previewdef/worldmap/loader river findRiverPointsList", () => {
	it("returns the river's box with colours and ends relative to it", () => {
		const buffer = buildBmp(6, 3, 8, lineRiverPixels);
		const rivers = findRiverPointsList(parseBmp(buffer.buffer as ArrayBuffer, buffer.byteOffset));
		assert.deepStrictEqual(rivers, [
			{
				colors: { 0: 0, 1: 5, 2: 3 },
				ends: [0, 2],
				boundingBox: zone(2, 1, 3, 1),
			},
		]);
	});
});

describe("previewdef/worldmap/loader river validateRivers", () => {
	const at = (colors: Record<number, number>, ends: number[], w = 3, h = 1): River => ({
		colors,
		ends,
		boundingBox: zone(10, 20, w, h),
	});

	const rows: {
		name: string;
		river: River;
		warnings: { text: string; name: string }[];
	}[] = [
		{
			name: "a clean river",
			river: at({ 0: 0, 1: 5, 2: 1 }, [0, 2]),
			warnings: [],
		},
		{
			name: "no end points",
			river: at({ 0: 5, 1: 5, 2: 5 }, []),
			warnings: [
				{ text: "River has no end points.", name: "(10, 20)" },
				{ text: "River has no source. Its end points are: .", name: "(10, 20)" },
			],
		},
		{
			name: "no source",
			river: at({ 0: 5, 1: 5, 2: 3 }, [0, 2]),
			warnings: [
				{
					text: "River has no source. Its end points are: (10, 20), (12, 20).",
					name: "(10, 20)",
				},
			],
		},
		{
			name: "two sources",
			river: at({ 0: 0, 1: 5, 2: 0 }, [0, 2]),
			warnings: [
				{
					text: "River has multiple sources: (10, 20), (12, 20).",
					name: "(10, 20)",
				},
			],
		},
		{
			name: "a joining end that forks before any mark",
			river: at({ 1: 7, 3: 5, 4: 5, 5: 5, 8: 0 }, [1, 8], 3, 3),
			warnings: [
				{
					text: "River doesn't have flow-in or flow-out mark at (11, 21).",
					name: "(11, 20)",
				},
			],
		},
		{
			name: "a joining end that runs out without a mark",
			river: at({ 0: 7, 1: 5, 2: 5, 7: 0 }, [0, 7], 4, 2),
			warnings: [
				{
					text: "River may contain a loop at (10, 20) ~ (12, 20).",
					name: "(10, 20)",
				},
			],
		},
	];

	for (const row of rows) {
		it(row.name, () => {
			const warnings: WorldMapWarning[] = [];
			validateRivers("map/rivers.bmp", [row.river], warnings);
			assert.deepStrictEqual(
				warnings.map((w) => ({ text: w.text, name: (w.source[0] as any).name })),
				row.warnings,
			);
			for (const warning of warnings) {
				assert.deepStrictEqual(warning.relatedFiles, ["map/rivers.bmp"]);
				assert.strictEqual((warning.source[0] as any).index, 0);
			}
		});
	}

	it("indexes each river by its position in the list", () => {
		const warnings: WorldMapWarning[] = [];
		validateRivers(
			"map/rivers.bmp",
			[at({ 0: 0, 1: 5, 2: 1 }, [0, 2]), at({ 0: 0, 1: 5, 2: 0 }, [0, 2])],
			warnings,
		);
		assert.deepStrictEqual(
			warnings.map((w) => (w.source[0] as any).index),
			[1],
		);
	});
});

describe("previewdef/worldmap/loader river loadRivers", () => {
	async function withRiverBuffer<T>(buffer: Buffer, fn: () => Promise<T>): Promise<T> {
		const fileloader: any = await import("../util/fileloader");
		const original = fileloader.readFileFromModOrHOI4;
		fileloader.readFileFromModOrHOI4 = async () => [
			buffer,
			vscode.Uri.file("/tmp/map/rivers.bmp"),
		];
		try {
			return await fn();
		} finally {
			fileloader.readFileFromModOrHOI4 = original;
		}
	}

	it("refuses an image that isn't 8 bits per pixel", async () => {
		const progress: string[] = [];
		const warnings: WorldMapWarning[] = [];
		const result = await withRiverBuffer(buildBmp(3, 2, 4), () =>
			loadRivers(
				"map/rivers.bmp",
				async (p) => {
					progress.push(p);
				},
				warnings,
			),
		);
		assert.deepStrictEqual(result, { width: 3, height: 2, rivers: [] });
		assert.deepStrictEqual(progress, ["Loading rivers..."]);
		assert.deepStrictEqual(warnings, [
			{
				relatedFiles: ["map/rivers.bmp"],
				text: "The rivers image should be 8 bits per pixel, but it is 4.",
				source: [{ type: "river", name: "", index: -1 }],
			},
		]);
	});

	it("finds and validates the rivers in an 8-bit image", async () => {
		const warnings: WorldMapWarning[] = [];
		const result = await withRiverBuffer(buildBmp(6, 3, 8, lineRiverPixels), () =>
			loadRivers("map/rivers.bmp", async () => undefined, warnings),
		);
		assert.strictEqual(result.width, 6);
		assert.strictEqual(result.height, 3);
		assert.deepStrictEqual(
			result.rivers.map((r) => r.boundingBox),
			[zone(2, 1, 3, 1)],
		);
		assert.deepStrictEqual(warnings, []);
	});
});
