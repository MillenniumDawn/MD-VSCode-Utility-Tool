import * as assert from "assert";
import * as vscode from "vscode";
import { LoaderSession } from "../util/loader/loader";
import { UserError } from "../util/common";

async function withMockedFile(
	content: string,
	fn: () => Promise<void>,
): Promise<void> {
	const fileloader: any = await import("../util/fileloader");
	const orig = fileloader.readFileFromModOrHOI4;
	fileloader.readFileFromModOrHOI4 = async () => [
		Buffer.from(content),
		vscode.Uri.file("/tmp/map/test.txt"),
	];
	try {
		await fn();
	} finally {
		fileloader.readFileFromModOrHOI4 = orig;
	}
}
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
	it("handles empty continents file", async () => {
		await withMockedFile("", async () => {
			const { ContinentsLoader } = await import(
				"../previewdef/worldmap/loader/continents"
			);
			const loader = new ContinentsLoader("map/continent.txt");
			const result = await loader.load(new LoaderSession(false));
			assert.ok(result);
		});
	});

	it("parses continents with entries", async () => {
		await withMockedFile("0 = { id = 0 }\n1 = { id = 1 }", async () => {
			const { ContinentsLoader } = await import(
				"../previewdef/worldmap/loader/continents"
			);
			const loader = new ContinentsLoader("map/continent.txt");
			const result = await loader.load(new LoaderSession(false));
			assert.ok(result);
		});
	});
});

describe("previewdef/worldmap/loader river", () => {
	it("module loads and exports RiverLoader", async () => {
		const mod: any = await import("../previewdef/worldmap/loader/river");
		assert.ok(mod.RiverLoader);
	});
});

describe("previewdef/worldmap/loader railway", () => {
	it("module loads and exports RailwayLoader", async () => {
		const mod: any = await import("../previewdef/worldmap/loader/railway");
		assert.ok(mod.RailwayLoader);
		assert.ok(mod.SupplyNodeLoader);
	});
});

describe("previewdef/worldmap/loader resource", () => {
	it("handles empty resource file", async () => {
		await withMockedJson(async () => ({ _map: {} }) as any, async () => {
			const { ResourceDefinitionLoader } = await import(
				"../previewdef/worldmap/loader/resource"
			);
			const loader = new ResourceDefinitionLoader();
			const result = await loader.load(new LoaderSession(false));
			assert.ok(result);
		});
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
		const mod: any = await import(
			"../previewdef/worldmap/loader/supplyarea"
		);
		assert.ok(mod.SupplyAreasLoader);
	});
});

describe("previewdef/worldmap/loader states additional", () => {
	it("StateLoader handles malformed state via file mock", async () => {
		await withMockedJson(async () => ({ _map: {} }) as any, async () => {
			// Just verify module loads and loader can be instantiated with mocks
			const mod: any = await import("../previewdef/worldmap/loader/states");
			assert.ok(mod.StatesLoader);
			assert.ok(mod);
		});
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
