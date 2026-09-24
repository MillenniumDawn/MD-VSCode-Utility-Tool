import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { LoaderSession } from "../util/loader/loader";
import { UserError } from "../util/common";

async function withMockedJson(
	jsonFn: (path: string) => any,
	fn: () => Promise<void>,
): Promise<void> {
	const fileloader: any = await import("../util/fileloader");
	const orig = fileloader.readFileFromModOrHOI4AsJson;
	fileloader.readFileFromModOrHOI4AsJson = jsonFn;
	try {
		await fn();
	} finally {
		fileloader.readFileFromModOrHOI4AsJson = orig;
	}
}

describe("previewdef/worldmap/loader continents", () => {
	it("returns the empty continent at index zero", async () => {
		await withMockedJson(
			async () => ({ continents: { _values: [] } }) as any,
			async () => {
				const { ContinentsLoader } = await import(
					"../previewdef/worldmap/loader/continents"
				);
				const loader = new ContinentsLoader("map/continent.txt");
				const result = await loader.load(new LoaderSession(true));
				assert.deepStrictEqual(result.result, [""]);
				assert.deepStrictEqual(result.dependencies, ["map/continent.txt"]);
			},
		);
	});

	it("preserves continent order after the empty index", async () => {
		await withMockedJson(
			async () => ({ continents: { _values: ["europe", "asia"] } }) as any,
			async () => {
				const { ContinentsLoader } = await import(
					"../previewdef/worldmap/loader/continents"
				);
				const loader = new ContinentsLoader("map/continent.txt");
				const result = await loader.load(new LoaderSession(true));
				assert.deepStrictEqual(result.result, ["", "europe", "asia"]);
			},
		);
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

async function withMockedRiverBuffer(
	buffer: Buffer,
	fn: () => Promise<void>,
): Promise<void> {
	const fileloader: any = await import("../util/fileloader");
	const original = fileloader.readFileFromModOrHOI4;
	fileloader.readFileFromModOrHOI4 = async () => [
		buffer,
		vscode.Uri.file("/tmp/map/rivers.bmp"),
	];
	try {
		await fn();
	} finally {
		fileloader.readFileFromModOrHOI4 = original;
	}
}

describe("previewdef/worldmap/loader river", () => {
	it("rejects an unreadable river image", async () => {
		const fileloader: any = await import("../util/fileloader");
		const original = fileloader.readFileFromModOrHOI4;
		fileloader.readFileFromModOrHOI4 = async () => [
			Buffer.alloc(0),
			vscode.Uri.file("/tmp/map/rivers.bmp"),
		];
		try {
			const { RiverLoader } = await import(
				"../previewdef/worldmap/loader/river"
			);
			const loader = new RiverLoader("map/rivers.bmp");
			await assert.rejects(loader.load(new LoaderSession(true)), Error);
		} finally {
			fileloader.readFileFromModOrHOI4 = original;
		}
	});

	it("warns and returns no rivers when the image isn't 8 bits per pixel", async () => {
		await withMockedRiverBuffer(buildBmp(1, 1, 4), async () => {
			const { RiverLoader } = await import(
				"../previewdef/worldmap/loader/river"
			);
			const loader = new RiverLoader("map/rivers.bmp");
			const result = await loader.load(new LoaderSession(true));
			assert.deepStrictEqual(result.result.rivers, []);
			assert.strictEqual(result.warnings.length, 1);
			assert.ok(result.warnings[0]?.text.includes("8 bits per pixel"));
		});
	});

	it("finds every disjoint river and validates sources, joins and loops", async () => {
		const pixels: Record<string, number> = {
			// River A: clean line with one source and one mark endpoint.
			"0,0": 0,
			"1,0": 5,
			"2,0": 5,
			"3,0": 1,
			// River B: no source at all.
			"0,2": 5,
			"1,2": 5,
			"2,2": 5,
			// River C: two sources.
			"0,4": 0,
			"1,4": 5,
			"2,4": 0,
			// River D: T-shaped branch, one source and two dead-end branches (loops).
			"8,1": 0,
			"9,1": 5,
			"10,1": 7,
			"9,0": 8,
			// River E: 4-way star, one source and three ambiguous branches.
			"4,3": 5,
			"5,3": 9,
			"6,3": 8,
			"5,2": 7,
			"5,4": 0,
		};
		await withMockedRiverBuffer(buildBmp(12, 8, 8, pixels), async () => {
			const { RiverLoader } = await import(
				"../previewdef/worldmap/loader/river"
			);
			const loader = new RiverLoader("map/rivers.bmp");
			const result = await loader.load(new LoaderSession(true));

			assert.strictEqual(result.result.rivers.length, 5);
			assert.strictEqual(result.result.width, 12);
			assert.strictEqual(result.result.height, 8);

			const texts = result.warnings.map((w) => w.text);
			const has = (s: string) => texts.some((t) => t.includes(s));
			assert.ok(has("has no source"), texts.join("\n"));
			assert.ok(has("multiple sources"), texts.join("\n"));
			assert.ok(
				has("flow-in or flow-out mark") || has("may contain a loop"),
				texts.join("\n"),
			);
		});
	});
});

describe("previewdef/worldmap/loader railway", () => {
	it("parses railway lines and warns about unknown provinces", async () => {
		const fileloader: any = await import("../util/fileloader");
		const original = fileloader.readFileFromModOrHOI4;
		fileloader.readFileFromModOrHOI4 = async () => [
			Buffer.from("3 2 1 99\n"),
			vscode.Uri.file("/tmp/map/railways.txt"),
		];
		try {
			const { RailwayLoader } = await import(
				"../previewdef/worldmap/loader/railway"
			);
			const defaultMapLoader = {
				load: async () => ({
					result: { provinces: [undefined, { id: 1, edges: [] }] },
					warnings: [],
					dependencies: [],
				}),
			};
			const loader = new RailwayLoader(defaultMapLoader as any);
			const result = await loader.load(new LoaderSession(true));
			assert.deepStrictEqual(result.result.railways, [
				{ level: 3, provinces: [1, 99] },
			]);
			assert.strictEqual(result.warnings.length, 1);
			assert.strictEqual(result.warnings[0]?.source[1]?.type, "province");
		} finally {
			fileloader.readFileFromModOrHOI4 = original;
		}
	});
});

describe("previewdef/worldmap/loader resource", () => {
	it("handles empty resource file", async () => {
		await withMockedJson(
			async () => ({ _map: {} }) as any,
			async () => {
				const { ResourceDefinitionLoader } = await import(
					"../previewdef/worldmap/loader/resource"
				);
				const loader = new ResourceDefinitionLoader();
				const result = await loader.load(new LoaderSession(false));
				assert.ok(result);
			},
		);
	});
});

describe("previewdef/worldmap/loader strategicregion", () => {
	const zone = (x: number, y: number) => ({ x, y, w: 1, h: 1 });
	const provinces = [
		undefined,
		{ color: 0x1, boundingBox: zone(0, 0), centerOfMass: { x: 0, y: 0 }, mass: 1 },
		{ color: 0x2, boundingBox: zone(1, 0), centerOfMass: { x: 1, y: 0 }, mass: 1 },
		{ color: 0x3, boundingBox: zone(0, 1), centerOfMass: { x: 0, y: 1 }, mass: 1 },
		{ color: 0x4, boundingBox: zone(1, 1), centerOfMass: { x: 1, y: 1 }, mass: 1 },
		{ color: 0x5, boundingBox: zone(2, 2), centerOfMass: { x: 2, y: 2 }, mass: 1 },
	];
	const terrains = [
		{ name: "ocean", color: 0, isNaval: true, file: "f" },
		{ name: "land_terrain", color: 0, isNaval: false, file: "f" },
	];
	const states = [
		undefined,
		{
			id: 1,
			provinces: [1, 3],
			file: "history/states/1.txt",
			name: "s1",
			manpower: 0,
			category: "",
			owner: undefined,
			cores: [],
			impassable: false,
			impassableIgnoredLinks: [],
			victoryPoints: {},
			resources: {},
			boundingBox: zone(0, 0),
			centerOfMass: { x: 0, y: 0 },
			mass: 1,
			token: null,
		},
	];

	async function withStrategicRegionsLoader(
		filesByName: Record<string, unknown>,
		fn: (loader: any) => Promise<void>,
	): Promise<void> {
		const fileloader: any = await import("../util/fileloader");
		const origList = fileloader.listFilesFromModOrHOI4;
		const origJson = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.listFilesFromModOrHOI4 = async () => Object.keys(filesByName);
		fileloader.readFileFromModOrHOI4AsJson = async (file: string) => {
			for (const name of Object.keys(filesByName)) {
				if (file.endsWith(name)) {
					const value = filesByName[name];
					if (value instanceof Error) {
						throw value;
					}
					return value;
				}
			}
			throw new Error(`unexpected file: ${file}`);
		};
		try {
			const { StrategicRegionsLoader } = await import(
				"../previewdef/worldmap/loader/strategicregion"
			);
			const defaultMapLoader = {
				load: async () => ({
					result: { width: 100, provinces, terrains },
					warnings: [],
					dependencies: ["map/default.map"],
				}),
			};
			const statesLoader = {
				load: async () => ({
					result: { states, badStatesCount: 0 },
					warnings: [],
					dependencies: [],
				}),
			};
			const loader = new StrategicRegionsLoader(
				defaultMapLoader as any,
				statesLoader as any,
			);
			await fn(loader);
		} finally {
			fileloader.listFilesFromModOrHOI4 = origList;
			fileloader.readFileFromModOrHOI4AsJson = origJson;
		}
	}

	it("lists a file it could not load as a warning and merges the rest", async () => {
		const fileloader: any = await import("../util/fileloader");
		const origToken = fileloader.hoiFileExpiryToken;
		const originalConsoleError = console.error;
		console.error = () => undefined;
		// The expiry stat runs before the file is read, so a file that vanished between the
		// folder listing and its load rejects there, outside the read's own catch.
		fileloader.hoiFileExpiryToken = async (file: string) => {
			if (file.endsWith("gone.txt")) {
				throw new Error("Can't find file " + file);
			}
			return "v1";
		};
		try {
			await withStrategicRegionsLoader(
				{
					"a.txt": {
						strategic_region: [
							{
								id: 1,
								name: "Region1",
								provinces: { _values: ["1", "2", "3", "4", "5"] },
								naval_terrain: "ocean",
							},
						],
					},
					"gone.txt": { strategic_region: [] },
				},
				async (loader) => {
					const result = await loader.load(new LoaderSession(true));

					assert.strictEqual(result.result.strategicRegions.length, 2);
					assert.strictEqual(result.result.strategicRegions[1].name, "Region1");
					const failure = result.warnings.find((w: any) =>
						w.text.includes("Failed to load"),
					);
					assert.ok(failure, result.warnings.map((w: any) => w.text).join("\n"));
					assert.deepStrictEqual(failure.source, []);
					assert.ok(failure.relatedFiles[0].endsWith("gone.txt"));
					assert.ok(failure.text.includes("Can't find file"));
				},
			);
		} finally {
			fileloader.hoiFileExpiryToken = origToken;
			console.error = originalConsoleError;
		}
	});

	it("merges files, sorts by id and cross-validates provinces and states", async () => {
		await withStrategicRegionsLoader(
			{
				"a.txt": {
					strategic_region: [
						{
							id: 1,
							name: "Region1",
							provinces: { _values: ["1", "2"] },
							naval_terrain: "ocean",
						},
						{
							id: 2,
							name: "Region2",
							provinces: { _values: ["2", "3"] },
							naval_terrain: "land_terrain",
						},
					],
				},
				"b.txt": {
					strategic_region: [
						{
							id: 2,
							name: "DupRegion2",
							provinces: { _values: ["4"] },
							naval_terrain: undefined,
						},
						{
							id: 0,
							name: "NoIdRegion",
							provinces: { _values: [] },
							naval_terrain: "unknownterr",
						},
						{
							id: 5,
							name: "",
							provinces: { _values: ["99"] },
							naval_terrain: null,
						},
					],
				},
			},
			async (loader) => {
				const result = await loader.load(new LoaderSession(true));
				const regions = result.result.strategicRegions;
				const b = path.join("map/strategicregions", "b.txt");

				// A duplicate id keeps the later definition; the earlier one and the region
				// without an id move to negative slots.
				assert.strictEqual(result.result.badStrategicRegionsCount, 2);
				assert.strictEqual(regions.length, 6);
				assert.deepStrictEqual(
					[-2, -1, 0, 1, 2, 3, 4, 5].map((i) => regions[i]?.name),
					["NoIdRegion", "Region2", undefined, "Region1", "DupRegion2", undefined, undefined, ""],
				);
				assert.deepStrictEqual(
					[-2, -1, 1, 2, 5].map((i) => regions[i].id),
					[-2, -1, 1, 2, 5],
				);
				assert.deepStrictEqual(regions[1].provinces, [1, 2]);
				assert.strictEqual(regions[1].navalTerrain, "ocean");
				assert.deepStrictEqual(regions[1].boundingBox, { x: 0, y: 0, w: 2, h: 1 });
				assert.deepStrictEqual(regions[-1].provinces, [2, 3]);
				assert.deepStrictEqual(regions[2].provinces, [4]);
				assert.strictEqual(regions[2].navalTerrain, null);
				assert.deepStrictEqual(result.dependencies, ["map/strategicregions/*"]);

				assert.deepStrictEqual(
					result.warnings.map((w: any) => w.text),
					[
						`A strategic region in "${b}" doesn't have id field.`,
						`Strategic region -1 in "${b}" doesn't have provinces.`,
						"Strategic region 5 doesn't have name field.",
						'Naval terrain "land_terrain" is not defined.',
						'Naval terrain "unknownterr" is not defined.',
						"There're more than one strategic regions using ID 2.",
						"Strategic region with id 3-4 doesn't exist.",
						"Province 99 used in strategic region 5 doesn't exist.",
						"Strategic region 5 doesn't have valid provinces.",
						"Province 2 exists in multiple strategic regions: -1, 1.",
						"Province 5 is not in any strategic region.",
						"In state 1, province 3 are not belong to same strategic region as other provinces.",
					],
				);
			},
		);
	});

	it("throws when the max strategic region id is exceeded", async () => {
		await withStrategicRegionsLoader(
			{
				"a.txt": {
					strategic_region: [
						{
							id: 99999,
							name: "TooBig",
							provinces: { _values: ["1"] },
							naval_terrain: null,
						},
					],
				},
			},
			async (loader) => {
				await assert.rejects(
					loader.load(new LoaderSession(true)),
					/Max strategic region ID is too large: 99999\./,
				);
			},
		);
	});
});

describe("previewdef/worldmap/loader supplyarea", () => {
	const zone = (x: number, y: number) => ({ x, y, w: 1, h: 1 });
	// Province 1 <-> 2 are passably connected; 2 <-> 3 only through an impassable edge; 4 is isolated.
	const provinces = [
		undefined,
		{ color: 0x1, edges: [{ to: 2, type: "" }] },
		{ color: 0x2, edges: [{ to: 1, type: "" }, { to: 3, type: "impassable" }] },
		{ color: 0x3, edges: [{ to: 2, type: "impassable" }] },
		{ color: 0x4, edges: [] },
	];
	function state(id: number, provinceIds: number[]) {
		return {
			id,
			provinces: provinceIds,
			file: `history/states/${id}.txt`,
			name: `s${id}`,
			manpower: 0,
			category: "",
			owner: undefined,
			cores: [],
			impassable: false,
			impassableIgnoredLinks: [],
			victoryPoints: {},
			resources: {},
			boundingBox: zone(id, 0),
			centerOfMass: { x: id, y: 0 },
			mass: 1,
			token: null,
		};
	}
	const states = [
		undefined,
		state(1, [1]),
		state(2, [2]),
		state(3, [3]),
		state(4, [4]),
		state(5, [5]),
	];

	async function withSupplyAreasLoader(
		filesByName: Record<string, unknown>,
		fn: (loader: any) => Promise<void>,
	): Promise<void> {
		const fileloader: any = await import("../util/fileloader");
		const origList = fileloader.listFilesFromModOrHOI4;
		const origJson = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.listFilesFromModOrHOI4 = async () => Object.keys(filesByName);
		fileloader.readFileFromModOrHOI4AsJson = async (file: string) => {
			for (const name of Object.keys(filesByName)) {
				if (file.endsWith(name)) {
					const value = filesByName[name];
					if (value instanceof Error) {
						throw value;
					}
					return value;
				}
			}
			throw new Error(`unexpected file: ${file}`);
		};
		try {
			const { SupplyAreasLoader } = await import(
				"../previewdef/worldmap/loader/supplyarea"
			);
			const defaultMapLoader = {
				load: async () => ({
					result: { width: 100, provinces },
					warnings: [],
					dependencies: ["map/default.map"],
				}),
			};
			const statesLoader = {
				load: async () => ({
					result: { states, badStatesCount: 0 },
					warnings: [],
					dependencies: [],
				}),
			};
			const loader = new SupplyAreasLoader(
				defaultMapLoader as any,
				statesLoader as any,
			);
			await fn(loader);
		} finally {
			fileloader.listFilesFromModOrHOI4 = origList;
			fileloader.readFileFromModOrHOI4AsJson = origJson;
		}
	}

	it("merges files, sorts by id and flags gaps, duplicates and non-contiguous states", async () => {
		await withSupplyAreasLoader(
			{
				"a.txt": {
					supply_area: [
						{ id: 1, name: "SA1", value: 5, states: { _values: ["1", "2"] } },
						{ id: 1, name: "SA1dup", value: 0, states: { _values: [] } },
					],
				},
				"b.txt": {
					supply_area: [
						{ id: 2, name: "SA2", value: 3, states: { _values: ["3", "1"] } },
						{ id: 3, name: "SA3", value: 1, states: { _values: ["1", "4"] } },
						{
							id: 0,
							name: "",
							value: 0,
							states: { _values: [] },
						},
					],
				},
				"c.txt": {
					supply_area: [
						{ id: 7, name: "SA5", value: 0, states: { _values: ["999"] } },
					],
				},
			},
			async (loader) => {
				const result = await loader.load(new LoaderSession(true));
				const areas = result.result.supplyAreas;
				const a = path.join("map/supplyareas", "a.txt");
				const b = path.join("map/supplyareas", "b.txt");

				assert.strictEqual(result.result.badSupplyAreasCount, 2);
				assert.strictEqual(areas.length, 8);
				assert.deepStrictEqual(
					[-2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((i) => areas[i]?.name),
					["", "SA1", undefined, "SA1dup", "SA2", "SA3", undefined, undefined, undefined, "SA5"],
				);
				assert.deepStrictEqual(
					[-2, -1, 1, 2, 3, 7].map((i) => areas[i].id),
					[-2, -1, 1, 2, 3, 7],
				);
				assert.deepStrictEqual(
					[-1, 2, 3].map((i) => [areas[i].value, areas[i].states]),
					[
						[5, [1, 2]],
						[3, [3, 1]],
						[1, [1, 4]],
					],
				);
				assert.deepStrictEqual(areas[-1].boundingBox, { x: 1, y: 0, w: 2, h: 1 });
				assert.deepStrictEqual(result.dependencies, ["map/supplyareas/*"]);

				assert.deepStrictEqual(
					result.warnings.map((w: any) => w.text),
					[
						`Supply area 1 in "${a}" doesn't have states.`,
						`A supply area in "${b}" doesn't have id field.`,
						"Supply area -1 doesn't have name field.",
						`Supply area -1 in "${b}" doesn't have states.`,
						"There're more than one supply areas using ID 1.",
						"Supply area with id 4-6 doesn't exist.",
						"State 999 used in supply area 7 doesn't exist.",
						"Supply area 7 doesn't have valid states.",
						"State 1 exists in multiple supply areas: -1, 2.",
						"States in supply area 2 are not contiguous: 1, 3.",
						"State 1 exists in multiple supply areas: -1, 3.",
						"States in supply area 3 are not contiguous: 4, 1.",
						"State 5 is not in any supply area.",
					],
				);
			},
		);
	});

	it("throws when the max supply area id is exceeded", async () => {
		await withSupplyAreasLoader(
			{
				"a.txt": {
					supply_area: [
						{ id: 99999, name: "TooBig", value: 0, states: { _values: ["1"] } },
					],
				},
			},
			async (loader) => {
				await assert.rejects(
					loader.load(new LoaderSession(true)),
					/Max supply area ID is too large: 99999\./,
				);
			},
		);
	});
});

describe("previewdef/worldmap/loader states", () => {
	const zone = (x: number, y: number) => ({ x, y, w: 1, h: 1 });
	const province = (id: number, type: string) => ({
		id,
		color: id,
		type,
		boundingBox: zone(id, 0),
		centerOfMass: { x: id, y: 0 },
		mass: 1,
	});
	const provinces = [
		undefined,
		province(1, "land"),
		province(2, "land"),
		province(3, "sea"),
		province(4, "land"),
	];
	const enumOf = (...values: string[]) => ({ _values: values });
	const resourcesOf = (resources: Record<string, number>) => ({
		_map: Object.fromEntries(
			Object.entries(resources).map(([k, v]) => [k, { _key: k, _value: v }]),
		),
	});
	const s1 = path.join("history/states", "s1.txt");
	const s2 = path.join("history/states", "s2.txt");
	const files: Record<string, unknown> = {
		[path.join("common/state_category", "categories.txt")]: {
			state_categories: {
				_map: {
					city: {
						_key: "city",
						_value: { color: { _value: enumOf("255", "0", "0") } },
					},
				},
			},
		},
		[s1]: {
			state: [
				{
					id: 1,
					name: "STATE_1",
					manpower: 1000,
					state_category: "city",
					history: {
						owner: "GER",
						victory_points: [enumOf("1", "10"), enumOf("4", "5")],
						add_core_of: ["GER", "GER", "POL"],
					},
					provinces: enumOf("1", "2"),
					resources: resourcesOf({ oil: 3, steel: 2 }),
				},
			],
		},
		[s2]: {
			state: [
				{
					id: 3,
					name: "",
					state_category: "farm",
					provinces: enumOf("2", "3"),
					resources: resourcesOf({ uranium: 1 }),
				},
				{
					id: 3,
					name: "DUP",
					state_category: "city",
					provinces: enumOf("4", "99"),
					resources: resourcesOf({}),
				},
				{
					name: "Orphan",
					provinces: enumOf(),
					resources: resourcesOf({}),
				},
			],
		},
	};

	async function loadStates() {
		const fileloader: any = await import("../util/fileloader");
		const origList = fileloader.listFilesFromModOrHOI4;
		const origJson = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.listFilesFromModOrHOI4 = async (folder: string) =>
			Object.keys(files)
				.filter((file) => path.dirname(file) === path.normalize(folder))
				.map((file) => path.basename(file));
		fileloader.readFileFromModOrHOI4AsJson = async (file: string) => {
			if (!(file in files)) {
				throw new Error(`unexpected file: ${file}`);
			}
			return files[file];
		};
		try {
			const { StatesLoader } = await import(
				"../previewdef/worldmap/loader/states"
			);
			const defaultMapLoader = {
				load: async () => ({
					result: { width: 100, height: 100, provinces },
					warnings: [],
					dependencies: [],
				}),
			};
			const resourcesLoader = {
				load: async () => ({
					result: [{ name: "oil" }, { name: "steel" }],
					warnings: [],
					dependencies: [],
				}),
			};
			const loader = new StatesLoader(
				defaultMapLoader as any,
				resourcesLoader as any,
			);
			return await loader.load(new LoaderSession(true));
		} finally {
			fileloader.listFilesFromModOrHOI4 = origList;
			fileloader.readFileFromModOrHOI4AsJson = origJson;
		}
	}

	it("parses every field of a state", async () => {
		const result = await loadStates();
		const state = result.result.states[1] as any;

		assert.strictEqual(state.id, 1);
		assert.strictEqual(state.name, "STATE_1");
		assert.strictEqual(state.manpower, 1000);
		assert.strictEqual(state.category, "city");
		assert.strictEqual(state.owner, "GER");
		assert.deepStrictEqual(state.cores, ["GER", "POL"]);
		assert.deepStrictEqual(state.provinces, [1, 2]);
		assert.deepStrictEqual(state.victoryPoints, { 1: 10, 4: 5 });
		assert.deepStrictEqual(state.resources, { oil: 3, steel: 2 });
		assert.strictEqual(state.impassable, false);
		assert.deepStrictEqual(state.impassableIgnoredLinks, []);
		assert.strictEqual(state.file, s1);
		assert.deepStrictEqual(state.boundingBox, { x: 1, y: 0, w: 2, h: 1 });
		assert.deepStrictEqual(result.dependencies, [
			"history/states/*",
			"common/state_category/*",
		]);
	});

	it("moves duplicate and missing ids to bad slots and warns on every mismatch", async () => {
		const result = await loadStates();
		const states = result.result.states as any[];

		assert.strictEqual(result.result.badStatesCount, 2);
		assert.strictEqual(states.length, 4);
		assert.deepStrictEqual(
			[-2, -1, 0, 1, 2, 3].map((i) => states[i]?.name),
			["Orphan", "", undefined, "STATE_1", undefined, "DUP"],
		);
		assert.deepStrictEqual(
			[-2, -1, 1, 3].map((i) => states[i].id),
			[-2, -1, 1, 3],
		);
		assert.deepStrictEqual(states[3].provinces, [4, 99]);

		assert.deepStrictEqual(
			result.warnings.map((w: any) => w.text),
			[
				"Province 4 not included in this state. But victory points defined here.",
				"The state doesn't have name field.",
				`State -1 in "${s2}" doesn't have provinces.`,
				`A state in ${s2} doesn't have id field.`,
				"The state doesn't have category field.",
				"There're more than one states using state id 3.",
				"State with id 2 doesn't exist.",
				"State category of state -2 is not defined: .",
				"State category of state -1 is not defined: farm.",
				"Resource uranium used in state -1 is not defined.",
				"Province 99 used in state 3 doesn't exist.",
				"Sea province 3 shouldn't belong to a state.",
				"Province 2 exists in multiple states: -1, 1.",
			],
		);
	});
});

describe("previewdef/worldmap/loader provincemap", () => {
	it("DefaultMap loader rejects when default.map can't be read", async () => {
		const fileloader: any = await import("../util/fileloader");
		const orig = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.readFileFromModOrHOI4AsJson = async () => {
			throw new UserError("missing");
		};
		try {
			const { DefaultMapLoader } = await import(
				"../previewdef/worldmap/loader/provincemap"
			);
			const loader = new DefaultMapLoader();
			await assert.rejects(
				loader.load(new LoaderSession(false)),
				(e: unknown) => e instanceof UserError && e.message === "missing",
			);
		} finally {
			fileloader.readFileFromModOrHOI4AsJson = orig;
		}
	});

	it("DefaultMap loader rejects a default.map without a continent field", async () => {
		const fileloader: any = await import("../util/fileloader");
		const orig = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.readFileFromModOrHOI4AsJson = async () => ({
			definitions: "definition.csv",
			provinces: "provinces.bmp",
			adjacencies: "adjacencies.csv",
		});
		try {
			const { DefaultMapLoader } = await import(
				"../previewdef/worldmap/loader/provincemap"
			);
			const loader = new DefaultMapLoader();
			await assert.rejects(
				loader.load(new LoaderSession(false)),
				(e: unknown) =>
					e instanceof UserError &&
					e.message === 'Field "continent" is not found in default.map.',
			);
		} finally {
			fileloader.readFileFromModOrHOI4AsJson = orig;
		}
	});

	it("merges definitions, bmp, adjacencies, continents and terrains, warning on every mismatch", async () => {
		const fileloader: any = await import("../util/fileloader");
		const origJson = fileloader.readFileFromModOrHOI4AsJson;
		fileloader.readFileFromModOrHOI4AsJson = async (file: string) => {
			if (file === "map/default.map") {
				return {
					definitions: "definition.csv",
					provinces: "provinces.bmp",
					adjacencies: "adjacencies.csv",
					continent: "continent.txt",
					rivers: "rivers.bmp",
				};
			}
			throw new Error(`unexpected file: ${file}`);
		};

		try {
			const { DefaultMapLoader } = await import(
				"../previewdef/worldmap/loader/provincemap"
			);
			const loader: any = new DefaultMapLoader();

			const provinceDefinitions = [
				{ id: 0, color: 0x000000, type: "sea", coastal: false, terrain: "ocean", continent: 0 },
				{ id: 1, color: 0x0000ff, type: "land", coastal: true, terrain: "plains", continent: 1 },
				{ id: 2, color: 0x00ff00, type: "land", coastal: false, terrain: "hills", continent: 0 },
				{ id: 3, color: 0xff0000, type: "sea", coastal: false, terrain: "ocean2", continent: 5 },
				{ id: 6, color: 0x0000ff, type: "land", coastal: false, terrain: "plains", continent: 1 },
				{ id: 8, color: 0xabcdef, type: "land", coastal: false, terrain: "plains", continent: 1 },
				{ id: 2, color: 0x00ffff, type: "land", coastal: false, terrain: "plains", continent: 1 },
			];

			const zone = (x: number, y: number) => ({ x, y, w: 1, h: 1 });
			const colorToProvince: Record<number, any> = {
				0x000000: { color: 0x000000, boundingBox: zone(0, 0), centerOfMass: { x: 0, y: 0 }, mass: 1, coverZones: [zone(0, 0)], edges: [] },
				0x0000ff: {
					color: 0x0000ff,
					boundingBox: zone(1, 0),
					centerOfMass: { x: 1, y: 0 },
					mass: 1,
					coverZones: [zone(1, 0)],
					edges: [
						{ toColor: 0x00ff00, path: [[{ x: 1, y: 0 }, { x: 2, y: 0 }]] },
						{ toColor: 0x999999, path: [[{ x: 1, y: 1 }, { x: 2, y: 1 }]] },
					],
				},
				0x00ff00: { color: 0x00ff00, boundingBox: zone(2, 0), centerOfMass: { x: 2, y: 0 }, mass: 1, coverZones: [zone(2, 0)], edges: [] },
				0xff0000: { color: 0xff0000, boundingBox: zone(0, 1), centerOfMass: { x: 0, y: 1 }, mass: 1, coverZones: [zone(0, 1)], edges: [] },
				0x123456: { color: 0x123456, boundingBox: zone(5, 5), centerOfMass: { x: 5, y: 5 }, mass: 1, coverZones: [zone(5, 5)], edges: [] },
				0x654321: { color: 0x654321, boundingBox: zone(6, 6), centerOfMass: { x: 6, y: 6 }, mass: 1, coverZones: [], edges: [] },
			};

			loader.definitionsLoader = {
				file: "map/definition.csv",
				load: async () => ({ result: provinceDefinitions, warnings: [], dependencies: ["map/definition.csv"] }),
			};
			loader.provinceBmpLoader = {
				file: "map/provinces.bmp",
				load: async () => ({
					result: {
						width: 10,
						height: 10,
						colorByPosition: new Uint32Array(100),
						colorToProvince,
						provinces: Object.values(colorToProvince),
					},
					warnings: [],
					dependencies: ["map/provinces.bmp"],
				}),
			};
			loader.adjacenciesLoader = {
				file: "map/adjacencies.csv",
				// `from`/`to` index into the pre-sort province array by position, not by the province's
				// `id` field: position 1 is the blue province, position 2 is green, position 3 is red.
				load: async () => ({
					result: [
						{ from: 1, to: 2, through: undefined, start: { x: 1, y: 1 }, stop: { x: 2, y: 2 }, rule: "rule1", type: "", row: ["1", "2"] },
						{ from: 3, to: 1, through: -1, start: undefined, stop: undefined, rule: undefined, type: "impassable", row: ["3", "1"] },
						{ from: 99, to: 1, through: undefined, start: undefined, stop: undefined, rule: undefined, type: "", row: ["99", "1"] },
						{ from: 1, to: 3, through: 50, start: undefined, stop: undefined, rule: undefined, type: "", row: ["1", "3", "", "50"] },
					],
					warnings: [],
					dependencies: ["map/adjacencies.csv"],
				}),
			};
			loader.continentsLoader = {
				file: "map/continent.txt",
				load: async () => ({ result: ["", "europe"], warnings: [], dependencies: ["map/continent.txt"] }),
			};
			loader.terrainDefinitionLoader = {
				load: async () => ({
					result: [
						{ name: "plains", color: 0, isNaval: false, file: "x" },
						{ name: "ocean", color: 0, isNaval: true, file: "x" },
					],
					warnings: [],
					dependencies: ["common/terrain/*"],
				}),
			};
			loader.riverLoader = {
				file: "map/rivers.bmp",
				load: async () => ({
					result: { width: 999, height: 999, rivers: [] },
					warnings: [],
					dependencies: ["map/rivers.bmp"],
				}),
			};

			const result = await loader.load(new LoaderSession(true));

			assert.strictEqual(result.result.width, 10);
			assert.strictEqual(result.result.height, 10);
			assert.strictEqual(result.result.continents.length, 2);
			assert.ok(result.result.badProvincesCount >= 1);
			assert.strictEqual(
				result.result.provinces.filter((province: any) => province?.color === 0).length,
				1,
			);

			const texts = result.warnings.map((w: any) => w.text);
			const has = (s: string) => texts.some((t: string) => t.includes(s));
			assert.ok(has("has conflict color"), texts.join("\n"));
			assert.ok(has("doesn't exist on map"), texts.join("\n"));
			assert.ok(has("doesn't exist in definitions"), texts.join("\n"));
			assert.ok(
				!texts.some((text: string) => text.includes("Province with color (0, 0, 0)")),
				texts.join("\n"),
			);
			assert.ok(has("must belong to a continent"), texts.join("\n"));
			assert.ok(has("is not defined"), texts.join("\n"));
			assert.ok(has("more than one rows for province id"), texts.join("\n"));
			assert.ok(has("doesn't exist."), texts.join("\n"));
			assert.ok(has("not from or to an existing province"), texts.join("\n"));
			assert.ok(has("not through an existing province"), texts.join("\n"));
			assert.ok(has("doesn't match size of province map image"), texts.join("\n"));

			const province1 = result.result.provinces[1] as any;
			assert.ok(province1.edges.some((e: any) => e.to === 2));
			assert.ok(province1.edges.some((e: any) => e.to === -1));
			assert.ok(province1.edges.some((e: any) => e.to === 3 && e.through === undefined));
		} finally {
			fileloader.readFileFromModOrHOI4AsJson = origJson;
		}
	});

	it("shouldReloadImpl short-circuits true when the file itself changed", async () => {
		const { DefaultMapLoader } = await import(
			"../previewdef/worldmap/loader/provincemap"
		);
		const loader = new DefaultMapLoader();
		const shouldReload = await loader.shouldReloadImpl(new LoaderSession(true));
		assert.strictEqual(shouldReload, true);
	});
});
