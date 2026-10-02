import * as assert from "assert";
import * as vscode from "vscode";
import { LanguageAwareContentLoader } from "../previewdef/languageloader";
import { LoaderSession } from "../util/loader/loader";
import { TerrainDefinitionLoader } from "../previewdef/worldmap/loader/terrain";
import { ResourceDefinitionLoader } from "../previewdef/worldmap/loader/resource";
import { StatesLoader } from "../previewdef/worldmap/loader/states";
import { RailwayLoader, SupplyNodeLoader } from "../previewdef/worldmap/loader/railway";
import { spriteIconStyle } from "../previewdef/iconstyle";
import { StyleTable } from "../util/styletable";
import { localiseLabel, localiseOptionalText } from "../previewdef/localise";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
import { stubLocalisation, restoreLocalisation } from "./_localisation_stub";
import { refreshFeatureFlags } from "../util/featureflags";

describe("shared preview helpers", () => {
	describe("language-aware loaders", () => {
		afterEach(restoreVscodeStubs);
		it("reuses unchanged text, reloads on language/content changes, and retries failures", async () => {
			let language = "English";
			let content = "one";
			let fail = false;
			stubVscode({ getConfiguration: () => ({ previewLocalisation: language }) });
			class Probe extends LanguageAwareContentLoader<string> {
				loads = 0;
				protected async loadContent(text: string) {
					this.loads++;
					if (fail) { throw new Error("broken"); }
					return { result: `${this.languageKey}:${text}` };
				}
			}
			const loader = new Probe("test.txt", async () => content);
			const first = await loader.load(new LoaderSession(false));
			assert.strictEqual(await loader.load(new LoaderSession(false)), first);
			assert.strictEqual(loader.loads, 1);
			language = "French";
			assert.strictEqual((await loader.load(new LoaderSession(false))).result, "l_french:one");
			content = "two";
			assert.strictEqual((await loader.load(new LoaderSession(false))).result, "l_french:two");
			fail = true;
			await assert.rejects(loader.load(new LoaderSession(true)), /broken/);
			fail = false;
			assert.strictEqual((await loader.load(new LoaderSession(true))).result, "l_french:two");
		});
	});

	it("captures the language after the content is read", async () => {
		let language = "English";
		stubVscode({ getConfiguration: () => ({ previewLocalisation: language }) });
		class Probe extends LanguageAwareContentLoader<string> {
			protected async loadContent(text: string) {
				return { result: `${this.languageKey}:${text}` };
			}
		}
		try {
			const loader = new Probe("test.txt", async () => {
				language = "French";
				return "one";
			});
			assert.strictEqual((await loader.load(new LoaderSession(false))).result, "l_french:one");
		} finally {
			restoreVscodeStubs();
		}
	});

	describe("named world-map definitions", () => {
		for (const [loader, keep, text, source] of [
			[new TerrainDefinitionLoader(), "first", "Terrain plain is defined in two files: b, a.", []],
			[new ResourceDefinitionLoader(), "first", "Resource plain is defined in two files: b, a.", []],
			[(new StatesLoader({} as any, new ResourceDefinitionLoader()) as any).categoriesLoader, "last", 'There\'re multiple state categories have name "plain".', [{ type: "statecategory", name: "plain" }]],
		] as const) {
			it(`${loader} preserves ${keep}-wins, warning order and dependencies`, async () => {
				const a = { name: "plain", file: "a" };
				const b = { name: "plain", file: "b" };
				const existingWarning = { source: [], relatedFiles: ["a"], text: "existing" };
				const loaded = await (loader as any).mergeLoadedFiles([
					{ result: [a], warnings: [existingWarning], dependencies: ["a"] },
					{ result: [b], warnings: [], dependencies: ["b"] },
				], new LoaderSession(false));
				assert.deepStrictEqual(Object.values(loaded.result), [keep === "first" ? a : b]);
				assert.deepStrictEqual(loaded.warnings, [existingWarning, { source: [...source], relatedFiles: ["b", "a"], text }]);
				assert.deepStrictEqual(loaded.dependencies, [loader.folder + "/*"]);
			});
		}
	});

	describe("railway and supply-node loaders", () => {
		it("shares whitespace parsing, progress and default-map invalidation", async () => {
			const fileloader = require("../util/fileloader") as typeof import("../util/fileloader");
			const original = fileloader.readFileFromModOrHOI4;
			const expiry = fileloader.hoiFileExpiryToken;
			let mapChanged = false;
			let mapLoads = 0;
			const map = {
				shouldReload: async () => mapChanged,
				load: async () => {
					mapLoads++;
					return { result: { provinces: [undefined, { id: 1, edges: [] }] } };
				},
			};
			fileloader.hoiFileExpiryToken = async () => "stable";
			fileloader.readFileFromModOrHOI4 = async (file) => [
				Buffer.from(file.includes("railways") ? " \t3 1 1\r\n\n\t2 1 1\r" : " \t3 1\r\n\n\t2 1\r"), vscode.Uri.file(file),
			];
			try {
				const railway = new RailwayLoader(map as any);
				const supply = new SupplyNodeLoader(map as any);
				const progress: string[] = [];
				railway.onProgress(p => progress.push(p));
				supply.onProgress(p => progress.push(p));
				const r = await railway.load(new LoaderSession(false));
				const s = await supply.load(new LoaderSession(false));
				assert.deepStrictEqual(r.result.railways, [{ level: 3, provinces: [1] }, { level: 2, provinces: [1] }]);
				assert.deepStrictEqual(s.result.supplyNodes, [{ level: 3, province: 1 }, { level: 2, province: 1 }]);
				assert.deepStrictEqual([r.warnings, s.warnings], [[], []]);
				assert.deepStrictEqual([r.dependencies, s.dependencies], [["map/railways.txt"], ["map/supply_nodes.txt"]]);
				assert.deepStrictEqual(progress, ["Loading railways...", "Loading supply nodes..."]);
				assert.strictEqual(await railway.load(new LoaderSession(false)), r);
				assert.strictEqual(await supply.load(new LoaderSession(false)), s);
				assert.strictEqual(mapLoads, 2);
				mapChanged = true;
				await railway.load(new LoaderSession(false));
				await supply.load(new LoaderSession(false));
				assert.strictEqual(mapLoads, 4);
			} finally {
				fileloader.readFileFromModOrHOI4 = original;
				fileloader.hoiFileExpiryToken = expiry;
			}
		});
	});

	it("reuses sprite rules, normalizes names and keeps frames and sizes distinct", () => {
		const styles = new StyleTable();
		const image = { uri: "data:image/png;base64,AAAA", width: 250, height: 100 };
		const first = spriteIconStyle(styles, "portrait-", "GFX.a/0", image);
		assert.deepStrictEqual(first, { styleKey: "st-portrait-GFX_46a_470", width: 250, height: 100 });
		assert.deepStrictEqual(spriteIconStyle(styles, "portrait-", "GFX.a/0", image), first);
		spriteIconStyle(styles, "portrait-", "GFX.a/1", image);
		spriteIconStyle(styles, "inlay-", "GFX.a/0", image, { width: 144, height: 100 });
		assert.strictEqual(Object.keys(styles.styleRecords).length, 3);
		assert.ok(styles.toRawCss().includes("width: 144px;\nheight: 100px;"));
		assert.ok(styles.toRawCss().includes("background-size: contain;"));
	});

	describe("localized labels", () => {
		afterEach(restoreLocalisation);
		it("keeps both label orders and optional tooltip text", async () => {
			stubLocalisation({ test: "A name" });
			assert.strictEqual(await localiseLabel("test", "key-first"), "(test) A name");
			assert.strictEqual(await localiseLabel("test", "text-first"), "A name (test)");
			assert.strictEqual(await localiseOptionalText("test", "\n"), "\nA name");
		});
		it("leaves the id alone and optional text empty when localization is off", async () => {
			stubVscode({ getConfiguration: () => ({ localisationIndex: false }) });
			refreshFeatureFlags();
			assert.strictEqual(await localiseLabel("test", "key-first"), "test");
			assert.strictEqual(await localiseLabel("test", "text-first"), "test");
			assert.strictEqual(await localiseOptionalText("test", "\n"), "");
		});
	});
});
