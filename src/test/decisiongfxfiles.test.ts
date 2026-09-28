import * as assert from "assert";
import * as vscode from "vscode";
import { PNG } from "pngjs";
import { getDecisionGfxFiles, vanillaDecisionsGfxFile } from "../previewdef/decision/loader";
import { _clearImageCachesForTest, getSpriteByGfxName } from "../util/image/imagecache";
import { clearDlcZipCache } from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// The game defines its decision sprites in interface/decisions.gfx; a mod names its own decision
// sprite files in the decisionGfxFiles setting or a decision_gfx list in its .mod file. The preview
// used to pin interface/MD_decisions.gfx, which only Millennium Dawn has, so every other mod logged
// an error for it. Issue #449.
describe("previewdef/decision/loader decision gfx files", function () {
	let errors: string[];
	let warnings: string[];
	let originalError: (message: string) => void;
	let originalWarn: (message: string) => void;
	let files: Map<string, Buffer | string>;
	let reads: string[];
	let modFileCounter = 0;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/\\/g, "/")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	function decisionGfx(name: string): string {
		return `spriteTypes = {\n\tspriteType = { name = "${name}" texturefile = "gfx/decision.png" }\n}`;
	}

	function configure(decisionGfxFiles: string[], descriptor?: string): void {
		// A fresh .mod per test: the descriptor cache is keyed by its path.
		const modFile = `/ws/decisiontest${modFileCounter++}.mod`;
		files.set(modFile.replace(/^\/ws\//, ""), descriptor ?? 'name="test"\n');
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], decisionGfxFiles },
			workspaceFolders: [
				{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } },
			],
			stat: async (uri: any) => {
				if (files.has(rel(uri))) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + rel(uri));
			},
			readFile: async (uri: any) => {
				reads.push(rel(uri));
				const content = files.get(rel(uri));
				if (content !== undefined) {
					return Buffer.from(content);
				}
				throw new Error("not found: " + rel(uri));
			},
		});
	}

	async function spriteWidth(name: string, gfxFiles: string[]): Promise<number | undefined> {
		return (await getSpriteByGfxName(name, gfxFiles))?.image.width;
	}

	beforeEach(function () {
		errors = [];
		warnings = [];
		reads = [];
		originalError = Logger.error;
		originalWarn = Logger.warn;
		Logger.error = (message: string) => {
			errors.push(message);
		};
		Logger.warn = (message: string) => {
			warnings.push(message);
		};
		const png = new PNG({ width: 4, height: 2 });
		png.data.fill(0);
		files = new Map<string, Buffer | string>([["gfx/decision.png", PNG.sync.write(png)]]);
	});

	afterEach(async function () {
		Logger.error = originalError;
		Logger.warn = originalWarn;
		restoreVscodeStubs();
		_clearImageCachesForTest();
		await clearDlcZipCache();
	});

	it("looks only in the game's interface/decisions.gfx by default, without logging an error", async function () {
		files.set(vanillaDecisionsGfxFile, decisionGfx("GFX_decision_vanilla"));
		configure([]);
		const gfxFiles = await getDecisionGfxFiles();
		assert.deepStrictEqual(gfxFiles, [vanillaDecisionsGfxFile]);
		assert.strictEqual(await spriteWidth("GFX_decision_vanilla", gfxFiles), 4);
		assert.deepStrictEqual(errors, []);
		assert.ok(!reads.includes("interface/MD_decisions.gfx"), reads.join(", "));
	});

	it("finds a mod's decision sprites in a file the setting names", async function () {
		files.set(vanillaDecisionsGfxFile, decisionGfx("GFX_decision_vanilla"));
		files.set("interface/MD_decisions.gfx", decisionGfx("GFX_decision_mod"));
		configure(["interface\\MD_decisions.gfx"]);
		const gfxFiles = await getDecisionGfxFiles();
		assert.deepStrictEqual(gfxFiles, [vanillaDecisionsGfxFile, "interface/MD_decisions.gfx"]);
		assert.strictEqual(await spriteWidth("GFX_decision_mod", gfxFiles), 4);
		assert.deepStrictEqual(errors, []);
	});

	it("finds a mod's decision sprites in a file its .mod file names", async function () {
		files.set("interface/MD_decisions.gfx", decisionGfx("GFX_decision_mod"));
		configure([], 'name="test"\ndecision_gfx = { "interface/MD_decisions.gfx" }\n');
		const gfxFiles = await getDecisionGfxFiles();
		assert.deepStrictEqual(gfxFiles, ["interface/MD_decisions.gfx"]);
		assert.strictEqual(await spriteWidth("GFX_decision_mod", gfxFiles), 4);
		assert.deepStrictEqual(errors, []);
	});

	it("warns once about a configured file that does not exist, and logs no error", async function () {
		configure(["interface/MD_decisions.gfx"]);
		const gfxFiles = await getDecisionGfxFiles();
		assert.deepStrictEqual(gfxFiles, []);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].includes("mdHoi4Utilities.decisionGfxFiles"), warnings[0]);
		assert.deepStrictEqual(errors, []);
		assert.ok(!reads.some(r => r.endsWith(".gfx")), reads.join(", "));
	});
});
