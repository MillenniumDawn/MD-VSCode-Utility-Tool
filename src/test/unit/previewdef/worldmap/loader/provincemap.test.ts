import * as assert from "assert";
import {
	Province,
	ProvinceDefinition,
	ProvinceEdgeAdjacency,
	ProvinceGraph,
	ProvinceMap,
	WorldMapWarning,
} from "../../../../../previewdef/worldmap/definitions";
import { DefaultMapLoader } from "../../../../../previewdef/worldmap/loader/provincemap";
import { LoaderSession } from "../../../../../util/loader/loader";
import { handOver } from "../../../host";

const defaultMapText = [
	'definitions = "provinces.txt"',
	'provinces = "provinces.bmp"',
	'adjacencies = "adjacencies.txt"',
	'continent = "continent.txt"',
	'rivers = "rivers.txt"',
	"",
].join("\n");

function fakeUri(path: string) {
	return {
		scheme: "file",
		path,
		fsPath: path,
		fragment: "",
		toString: () => `file://${path}`,
	};
}

// Only map/default.map exists for the loader under test; every other file it could reach
// for comes from the injected sub-loaders below.
function handOverDefaultMapHost(): void {
	handOver({
		FileType: { File: 1, Directory: 2 },
		Uri: {
			joinPath: (base: { path: string }, ...segments: string[]) =>
				fakeUri(`${base.path}/${segments.join("/")}`),
			parse: (value: string) => fakeUri(value.replace(/^file:\/\//, "")),
		},
		workspace: {
			workspaceFolders: [{ uri: fakeUri("/mod") }],
			textDocuments: [],
			fs: {
				stat: async (uri: { path: string }) =>
					uri.path.endsWith("map/default.map")
						? { type: 1, ctime: 0, mtime: 1, size: defaultMapText.length }
						: Promise.reject(
								Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
							),
				readFile: async (uri: { path: string }) => {
					if (!uri.path.endsWith("map/default.map")) {
						throw new Error("ENOENT");
					}
					return Buffer.from(defaultMapText);
				},
			},
		},
	});
}

function fakeFileLoader(file: string, result: unknown) {
	return {
		file,
		load: async () => ({ result, warnings: [], dependencies: [file] }),
	};
}

function graphFor(color: number): ProvinceGraph {
	return {
		color,
		coverZones: [{ x: 0, y: 0, w: 1, h: 1 }],
		edges: [],
		boundingBox: { x: 0, y: 0, w: 1, h: 1 },
		mass: 1,
		centerOfMass: { x: 0, y: 0 },
	};
}

function row(from: number, to: number, through = -1): ProvinceEdgeAdjacency {
	return {
		from,
		to,
		through,
		type: "",
		row: [
			String(from),
			String(to),
			"",
			String(through),
			"-1",
			"-1",
			"-1",
			"-1",
			"",
		],
	};
}

async function loadMap(
	definitionIds: number[],
	adjacencyRows: ProvinceEdgeAdjacency[],
): Promise<{ result: ProvinceMap; warnings: WorldMapWarning[] }> {
	return await loadMapWith(
		definitionIds.map((id) => ({ id, color: id + 1 })),
		definitionIds.map((id) => id + 1),
		[],
		adjacencyRows,
	);
}

// bmpColors lists every color in the provinces bitmap so a color without a definition row stays
// reachable, and boundaries are [fromColor, toColor] pairs of bitmap neighbours.
async function loadMapWith(
	definitions: { id: number; color: number }[],
	bmpColors: number[],
	boundaries: [number, number][],
	adjacencyRows: ProvinceEdgeAdjacency[],
): Promise<{ result: ProvinceMap; warnings: WorldMapWarning[] }> {
	handOverDefaultMapHost();

	const provinceDefinitions: ProvinceDefinition[] = definitions.map(
		({ id, color }) => ({
			id,
			color,
			type: "sea",
			coastal: false,
			terrain: "",
			continent: 0,
		}),
	);
	const graphs: ProvinceGraph[] = bmpColors.map((color) => ({
		...graphFor(color),
		edges: boundaries
			.filter(([fromColor]) => fromColor === color)
			.map(([, toColor]) => ({
				toColor,
				path: [
					[
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
				],
			})),
	}));
	const provinceBmp = {
		width: 2,
		height: 2,
		colorByPosition: new Uint32Array(4),
		provinces: graphs,
		colorToProvince: Object.fromEntries(graphs.map((g) => [g.color, g])),
	};

	const loader = new DefaultMapLoader();
	const instance = loader as any;
	instance.definitionsLoader = fakeFileLoader(
		"map/provinces.txt",
		provinceDefinitions,
	);
	instance.provinceBmpLoader = fakeFileLoader("map/provinces.bmp", provinceBmp);
	instance.adjacenciesLoader = fakeFileLoader(
		"map/adjacencies.txt",
		adjacencyRows,
	);
	instance.continentsLoader = fakeFileLoader("map/continent.txt", [""]);
	instance.riverLoader = fakeFileLoader("map/rivers.txt", {
		width: 2,
		height: 2,
		rivers: [],
	});
	instance.terrainDefinitionLoader = {
		load: async () => ({
			result: [
				{ name: "", color: 0, isNaval: false, file: "common/terrain/00_test.txt" },
			],
			warnings: [],
			dependencies: ["common/terrain/*"],
		}),
	};

	return await loader.load(new LoaderSession(true));
}

function edgeTo(
	province: Province | null | undefined,
	to: number,
): Province["edges"][number] | undefined {
	return province?.edges.find((e) => e.to === to);
}

function adjacencyWarnings(warnings: WorldMapWarning[]): string[] {
	return warnings.map((w) => w.text).filter((t) => t.startsWith("Adjacency"));
}

describe("previewdef/worldmap/loader provincemap adjacency endpoints", () => {
	it("attaches adjacency rows to provinces whose ids count from zero in file order", async () => {
		const { result, warnings } = await loadMap([0, 1, 2], [row(0, 2)]);

		assert.ok(edgeTo(result.provinces[0], 2));
		assert.ok(edgeTo(result.provinces[2], 0));
		assert.strictEqual(edgeTo(result.provinces[0], 2)?.through, undefined);
		assert.strictEqual(edgeTo(result.provinces[2], 0)?.through, undefined);
		assert.deepStrictEqual(adjacencyWarnings(warnings), []);
	});

	it("resolves endpoints by id when the definition ids skip a number", async () => {
		const { result, warnings } = await loadMap([0, 1, 2, 4, 5], [row(4, 5)]);

		assert.ok(edgeTo(result.provinces[4], 5), "province 4 edges to 5");
		assert.ok(edgeTo(result.provinces[5], 4), "province 5 edges to 4");
		assert.deepStrictEqual(adjacencyWarnings(warnings), []);
	});

	it("resolves endpoints by id when the definitions are not in id order", async () => {
		const { result, warnings } = await loadMap([2, 1, 0], [row(0, 2)]);

		assert.ok(edgeTo(result.provinces[0], 2), "province 0 edges to 2");
		assert.ok(edgeTo(result.provinces[2], 0), "province 2 edges to 0");
		assert.deepStrictEqual(adjacencyWarnings(warnings), []);
	});

	it("resolves the through province by id when the definition ids skip a number", async () => {
		const { result, warnings } = await loadMap([0, 1, 4], [row(0, 1, 4)]);

		assert.strictEqual(edgeTo(result.provinces[0], 1)?.through, 4);
		assert.strictEqual(edgeTo(result.provinces[1], 0)?.through, 4);
		assert.deepStrictEqual(adjacencyWarnings(warnings), []);
	});

	it("resolves a zero through ID and warns when it does not exist", async () => {
		const valid = await loadMap([2, 0, 1], [row(1, 2, 0)]);
		assert.strictEqual(edgeTo(valid.result.provinces[1], 2)?.through, 0);
		assert.deepStrictEqual(adjacencyWarnings(valid.warnings), []);

		const missing = await loadMap([1, 2], [row(1, 2, 0)]);
		assert.strictEqual(edgeTo(missing.result.provinces[1], 2), undefined);
		assert.deepStrictEqual(adjacencyWarnings(missing.warnings), [
			"Adjacency not through an existing province: 0",
		]);
	});

	it("keeps the warnings for endpoints and through provinces that do not exist", async () => {
		const { result, warnings } = await loadMap([0, 1, 2], [row(7, 1), row(0, 2, 99)]);

		assert.deepStrictEqual(adjacencyWarnings(warnings), [
			"Adjacency not from or to an existing province: 7, 1",
			"Adjacency not through an existing province: 99",
		]);
		// A row rejected for a missing through province attaches nothing in either direction.
		assert.strictEqual(edgeTo(result.provinces[0], 2), undefined);
		assert.strictEqual(edgeTo(result.provinces[2], 0), undefined);
		assert.deepStrictEqual(result.provinces[1]?.edges, []);
	});

	it("retains a definition row with a malformed id on a bad slot and counts it", async () => {
		const { result, warnings } = await loadMap([1, NaN, -5, 2] as number[], []);

		const retained = warnings.filter((warning) =>
			warning.text.includes("has an invalid id"),
		);
		assert.deepStrictEqual(
			retained.map((warning) => warning.text),
			[
				"Province NaN has an invalid id. Set id to -1.",
				"Province -5 has an invalid id. Set id to -2.",
			],
		);
		assert.deepStrictEqual(retained[0]?.source, [
			{ type: "province", id: -1, color: NaN },
		]);
		assert.deepStrictEqual(retained[0]?.relatedFiles, [
			"map/provinces.txt",
		]);

		assert.strictEqual(result.badProvincesCount, 2);
		assert.strictEqual(result.provinces[-1]?.id, -1);
		assert.strictEqual(result.provinces[-2]?.id, -2);
		assert.strictEqual(result.provinces[1]?.id, 1);
		assert.strictEqual(result.provinces[2]?.id, 2);
	});

	it("counts a nan and a boundary-equal province id through the whole loader", async () => {
		const { result, warnings } = await loadMap([NaN, -2] as number[], []);

		assert.deepStrictEqual(
			warnings
				.filter((warning) => warning.text.includes("has an invalid id"))
				.map((warning) => warning.text),
			[
				"Province NaN has an invalid id. Set id to -1.",
				"Province -2 has an invalid id. Set id to -2.",
			],
		);
		assert.strictEqual(result.badProvincesCount, 2);
		assert.strictEqual(result.provinces[-1]?.id, -1);
		assert.strictEqual(result.provinces[-2]?.id, -2);
	});
});

describe("previewdef/worldmap/loader provincemap bitmap boundary targets", () => {
	it("points a bitmap boundary at the bad slot a duplicate id displaces its first row to", async () => {
		const { result, warnings } = await loadMapWith(
			[
				{ id: 1, color: 11 },
				{ id: 2, color: 22 },
				{ id: 2, color: 33 },
			],
			[11, 22, 33],
			[
				[22, 33],
				[33, 22],
			],
			[],
		);

		assert.deepStrictEqual(result.provinces[2]?.edges.map((e) => e.to), [-1]);
		assert.deepStrictEqual(result.provinces[-1]?.edges.map((e) => e.to), [2]);
		assert.strictEqual(result.badProvincesCount, 1);
		assert.deepStrictEqual(warnings.map((w) => w.text), [
			"There're more than one rows for province id 2. Set id to -1.",
		]);
	});

	it("points a bitmap boundary at the bad slot a malformed id is reassigned to", async () => {
		const { result, warnings } = await loadMapWith(
			[
				{ id: 1, color: 11 },
				{ id: NaN, color: 22 },
			],
			[11, 22],
			[
				[11, 22],
				[22, 11],
			],
			[],
		);

		assert.deepStrictEqual(result.provinces[1]?.edges.map((e) => e.to), [-1]);
		assert.deepStrictEqual(result.provinces[-1]?.edges.map((e) => e.to), [1]);
		assert.strictEqual(result.badProvincesCount, 1);
		assert.deepStrictEqual(warnings.map((w) => w.text), [
			"Province NaN has an invalid id. Set id to -1.",
		]);
	});

	it("keeps an explicit adjacency on its own ids when the bitmap neighbour is reassigned", async () => {
		const { result, warnings } = await loadMapWith(
			[
				{ id: 1, color: 11 },
				{ id: 2, color: 22 },
				{ id: 2, color: 33 },
			],
			[11, 22, 33],
			[
				[22, 33],
				[33, 22],
			],
			[row(2, 1)],
		);

		assert.deepStrictEqual(result.provinces[2]?.edges.map((e) => e.to), [
			-1, 1,
		]);
		assert.deepStrictEqual(result.provinces[-1]?.edges.map((e) => e.to), [2]);
		assert.deepStrictEqual(result.provinces[1]?.edges.map((e) => e.to), [2]);
		assert.deepStrictEqual(adjacencyWarnings(warnings), []);
		assert.strictEqual(result.badProvincesCount, 1);
	});

	it("keeps adjacency rows, warnings and counts on ids nothing reassigns", async () => {
		const { result, warnings } = await loadMapWith(
			[
				{ id: 1, color: 11 },
				{ id: 2, color: 22 },
				{ id: 3, color: 33 },
			],
			[11, 22, 33],
			[
				[11, 22],
				[22, 11],
			],
			[row(1, 2, 3), row(7, 1)],
		);

		const merged = edgeTo(result.provinces[1], 2);
		assert.strictEqual(merged?.through, 3);
		assert.deepStrictEqual(merged?.path, [
			[
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
		]);
		assert.deepStrictEqual(result.provinces[1]?.edges.map((e) => e.to), [2]);
		assert.deepStrictEqual(result.provinces[2]?.edges.map((e) => e.to), [1]);
		assert.strictEqual(edgeTo(result.provinces[2], 1)?.through, 3);
		assert.deepStrictEqual(adjacencyWarnings(warnings), [
			"Adjacency not from or to an existing province: 7, 1",
		]);
		assert.strictEqual(result.badProvincesCount, 0);
	});

	it("keeps bitmap boundaries onto synthetic provinces and the bad counts", async () => {
		const { result, warnings } = await loadMapWith(
			[
				{ id: 1, color: 11 },
				{ id: NaN, color: 22 },
			],
			[11, 22, 44],
			[
				[11, 22],
				[11, 44],
				[22, 11],
				[44, 11],
			],
			[],
		);

		assert.deepStrictEqual(result.provinces[1]?.edges.map((e) => e.to), [
			-2, -1,
		]);
		assert.deepStrictEqual(result.provinces[-1]?.edges.map((e) => e.to), [1]);
		assert.deepStrictEqual(result.provinces[-2]?.edges.map((e) => e.to), [1]);
		assert.strictEqual(result.badProvincesCount, 2);
		assert.deepStrictEqual(warnings.map((w) => w.text), [
			"Province with color (0, 0, 44) in provinces bmp (0, 0) doesn't exist in definitions.",
			"Province NaN has an invalid id. Set id to -2.",
		]);
	});
});
