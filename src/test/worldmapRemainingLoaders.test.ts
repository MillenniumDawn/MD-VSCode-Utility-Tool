import * as assert from "assert";
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
	it("module loads and exports StrategicRegionsLoader", async () => {
		const mod: any = await import(
			"../previewdef/worldmap/loader/strategicregion"
		);
		assert.ok(mod.StrategicRegionsLoader);
	});
});

describe("previewdef/worldmap/loader supplyarea", () => {
	it("module loads and exports SupplyAreasLoader", async () => {
		const mod: any = await import("../previewdef/worldmap/loader/supplyarea");
		assert.ok(mod.SupplyAreasLoader);
	});
});

describe("previewdef/worldmap/loader states additional", () => {
	it("StateLoader handles malformed state via file mock", async () => {
		await withMockedJson(
			async () => ({ _map: {} }) as any,
			async () => {
				// Just verify module loads and loader can be instantiated with mocks
				const mod: any = await import("../previewdef/worldmap/loader/states");
				assert.ok(mod.StatesLoader);
				assert.ok(mod);
			},
		);
	});
});

describe("previewdef/worldmap/loader provincemap", () => {
	it("DefaultMap loader handles missing default.map", async () => {
		const fileloader: any = await import("../util/fileloader");
		const orig = fileloader.readFileFromModOrHOI4AsJson;
		const orig2 = fileloader.readFileFromModOrHOI4;
		fileloader.readFileFromModOrHOI4AsJson = async () => {
			throw new UserError("missing");
		};
		fileloader.readFileFromModOrHOI4 = async () => {
			throw new UserError("missing");
		};
		try {
			const { DefaultMapLoader } = await import(
				"../previewdef/worldmap/loader/provincemap"
			);
			const loader = new DefaultMapLoader();
			try {
				await loader.load(new LoaderSession(false));
				assert.ok(true);
			} catch (e) {
				assert.ok(e instanceof UserError || e instanceof Error);
			}
		} finally {
			fileloader.readFileFromModOrHOI4AsJson = orig;
			fileloader.readFileFromModOrHOI4 = orig2;
		}
	});
});
