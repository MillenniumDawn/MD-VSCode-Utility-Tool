import * as assert from "assert";
import {
	buildTechnologyTagMap,
	technologyTagsByFolder,
} from "../previewdef/technology/countryicons";
import { TechnologyTree } from "../previewdef/technology/schema";

// The country dropdown is built by reading the whole sprite namespace and asking which names are a
// country's version of a technology icon. Everything that can go wrong there is a misreading of a
// name, so these drive the two pure halves directly: the classification, and the per-folder lists it
// feeds.

const tags = new Set(["USA", "GER", "SOV"]);

function tree(folder: string, technologies: [string, string[]][]): TechnologyTree {
	return {
		startTechnology: technologies[0]?.[0] ?? "start",
		folder,
		technologies: technologies.map(([id, folders]) => ({
			id,
			folders: Object.fromEntries(
				folders.map((f) => [f, { name: f, x: 0, y: 0 }]),
			),
			leadsToTechs: [],
			xor: [],
			startYear: 0,
			enableEquipments: false,
			enableEquipmentNames: [],
			categories: [],
			isSpecialProject: false,
			subTechnologies: [],
			token: undefined,
		})),
	};
}

describe("previewdef/technology buildTechnologyTagMap", () => {
	it("reads both icon forms a country can define", () => {
		const map = buildTechnologyTagMap(tags, [
			"GFX_USA_APC_1_medium",
			"GFX_GER_APC_1",
		]);

		assert.deepStrictEqual(map["APC_1"], ["GER", "USA"]);
	});

	it("ignores a prefix that is not a declared country tag", () => {
		// GFX_APC_1_medium is the generic icon for the technology APC_1, not country APC's icon for
		// technology 1. Only the declared tags can tell those apart, and reading it the wrong way
		// would invent a country in the dropdown.
		const map = buildTechnologyTagMap(tags, [
			"GFX_APC_1_medium",
			"GFX_MBT_tech_medium",
			"GFX_IFV_1",
		]);

		assert.deepStrictEqual(map, {});
	});

	it("keeps a technology whose own id ends in _medium reachable under both readings", () => {
		const map = buildTechnologyTagMap(tags, ["GFX_USA_scout_medium"]);

		assert.deepStrictEqual(map["scout"], ["USA"]);
		assert.deepStrictEqual(map["scout_medium"], ["USA"]);
	});

	it("ignores names that are not a tag applied to something", () => {
		const map = buildTechnologyTagMap(tags, [
			"USA_no_gfx_prefix_medium",
			"GFX_USA_",
			"GFX_USA",
			"GFX_technology_medium",
		]);

		assert.deepStrictEqual(map, {});
	});

	it("is empty when there are no tags to split on", () => {
		assert.deepStrictEqual(
			buildTechnologyTagMap(new Set(), ["GFX_USA_APC_1_medium"]),
			{},
		);
	});
});

describe("previewdef/technology technologyTagsByFolder", () => {
	const tagMap = {
		APC_1: ["GER", "USA"],
		Anti_tank_3: ["SOV"],
		plain_tech: [],
	};

	it("offers a folder only the tags with art for a technology drawn in it", () => {
		const trees = [
			tree("armor", [
				["APC_1", ["armor"]],
				["plain_tech", ["armor"]],
			]),
			tree("land_doctrine", [["Anti_tank_3", ["land_doctrine"]]]),
		];

		assert.deepStrictEqual(
			technologyTagsByFolder(trees, ["armor", "land_doctrine"], tagMap),
			{ armor: ["GER", "USA"], land_doctrine: ["SOV"] },
		);
	});

	it("counts a technology placed in two folders in both of them", () => {
		const trees = [tree("armor", [["APC_1", ["armor", "support"]]])];

		assert.deepStrictEqual(
			technologyTagsByFolder(trees, ["armor", "support"], tagMap),
			{ armor: ["GER", "USA"], support: ["GER", "USA"] },
		);
	});

	it("keeps a folder whose technologies have no country art, with an empty list", () => {
		const trees = [tree("armor", [["plain_tech", ["armor"]]])];

		assert.deepStrictEqual(technologyTagsByFolder(trees, ["armor"], tagMap), {
			armor: [],
		});
	});

	it("leaves out a technology that is not drawn in the folder", () => {
		// A tree is rendered per folder, and a technology only appears in the folders it lists; a tag
		// offered because of a technology the reader cannot see would change nothing on screen.
		const trees = [tree("armor", [["APC_1", ["support"]]])];

		assert.deepStrictEqual(technologyTagsByFolder(trees, ["armor"], tagMap), {
			armor: [],
		});
	});
});
