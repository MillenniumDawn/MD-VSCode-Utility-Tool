import * as assert from "assert";
import * as vscode from "vscode";
import { PNG } from "pngjs";
import { loadFocusTitlebarStyles, focusTitlebarStylesFile, getFocusOverlayGfxFiles, getFocusOverlayImage, vanillaFocusOverlayGfxFile } from "../previewdef/focustree/titlebar";
import { _clearImageCachesForTest } from "../util/image/imagecache";
import { clearDlcZipCache } from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// A titlebar styles file that fails to read used to disable every focus text icon with no trace.
// The failure now names the file in the HOI4 Modding channel (issue #182).
describe("previewdef/focustree/titlebar loadFocusTitlebarStyles", function () {
	let errors: string[];
	let originalError: (message: string) => void;
	let content: string | undefined;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "");
	}

	beforeEach(function () {
		errors = [];
		originalError = Logger.error;
		Logger.error = (message: string) => {
			errors.push(message);
		};
		content = undefined;
		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: false },
			workspaceFolders: [
				{
					uri: {
						fsPath: "/ws",
						path: "/ws",
						scheme: "file",
						toString: () => "file:///ws",
					},
				},
			],
			stat: async (uri: any) => {
				if (content !== undefined && rel(uri) === focusTitlebarStylesFile) {
					return { type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + rel(uri));
			},
			readFile: async (uri: any) => {
				if (content !== undefined && rel(uri) === focusTitlebarStylesFile) {
					return Buffer.from(content);
				}
				throw new Error("not found: " + rel(uri));
			},
		});
	});

	afterEach(async function () {
		Logger.error = originalError;
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("maps each style name to its sprite", async function () {
		content = 'style = { name = "gold" available = "GFX_focus_titlebar_gold" }';
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), { gold: "GFX_focus_titlebar_gold" });
		assert.deepStrictEqual(errors, []);
	});

	it("logs an error naming the file when it does not parse, and disables the icons", async function () {
		content = 'style = { name = "gold" available = "GFX_focus_titlebar_gold" } }';
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), {});
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].includes(focusTitlebarStylesFile), errors[0]);
	});

	it("logs an error naming the file when it cannot be read", async function () {
		assert.deepStrictEqual(await loadFocusTitlebarStyles(), {});
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0].includes(focusTitlebarStylesFile), errors[0]);
	});
});

// The game defines its focus overlays in interface/goals.gfx; a mod names its own overlay files in
// the focusOverlayGfxFiles setting or a focus_overlay_gfx list in its .mod file. Only the game's
// file used to be missing from the search, and a mod without the one hardcoded file logged an
// error for every render. Issue #448.
describe("previewdef/focustree/titlebar focus overlays", function () {
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

	function overlayGfx(name: string): string {
		return `spriteTypes = {\n\tspriteType = { name = "${name}" texturefile = "gfx/overlay.png" }\n}`;
	}

	function configure(focusOverlayGfxFiles: string[], descriptor?: string): void {
		// A fresh .mod per test: the descriptor cache is keyed by its path.
		const modFile = `/ws/test${modFileCounter++}.mod`;
		files.set(modFile.replace(/^\/ws\//, ""), descriptor ?? 'name="test"\n');
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], focusOverlayGfxFiles },
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
		files = new Map<string, Buffer | string>([["gfx/overlay.png", PNG.sync.write(png)]]);
	});

	afterEach(async function () {
		Logger.error = originalError;
		Logger.warn = originalWarn;
		restoreVscodeStubs();
		_clearImageCachesForTest();
		await clearDlcZipCache();
	});

	it("finds the game's overlays in interface/goals.gfx without logging an error", async function () {
		files.set(vanillaFocusOverlayGfxFile, overlayGfx("GFX_focus_overlay_vanilla"));
		configure([]);
		const overlayFiles = await getFocusOverlayGfxFiles();
		assert.deepStrictEqual(overlayFiles, [vanillaFocusOverlayGfxFile]);
		const image = await getFocusOverlayImage("GFX_focus_overlay_vanilla", overlayFiles);
		assert.strictEqual(image?.width, 4);
		assert.deepStrictEqual(errors, []);
		assert.ok(!reads.includes("interface/goals_overlays.gfx"), reads.join(", "));
	});

	it("finds a mod's overlays in a file the setting names", async function () {
		files.set(vanillaFocusOverlayGfxFile, overlayGfx("GFX_focus_overlay_vanilla"));
		files.set("interface/goals_overlays.gfx", overlayGfx("GFX_focus_overlay_mod"));
		configure(["interface\\goals_overlays.gfx"]);
		const overlayFiles = await getFocusOverlayGfxFiles();
		assert.deepStrictEqual(overlayFiles, [vanillaFocusOverlayGfxFile, "interface/goals_overlays.gfx"]);
		assert.strictEqual((await getFocusOverlayImage("GFX_focus_overlay_mod", overlayFiles))?.width, 4);
		assert.deepStrictEqual(errors, []);
	});

	it("finds a mod's overlays in a file its .mod file names", async function () {
		files.set("interface/goals_overlays.gfx", overlayGfx("GFX_focus_overlay_mod"));
		configure([], 'name="test"\nfocus_overlay_gfx = { "interface/goals_overlays.gfx" }\n');
		const overlayFiles = await getFocusOverlayGfxFiles();
		assert.deepStrictEqual(overlayFiles, ["interface/goals_overlays.gfx"]);
		assert.strictEqual((await getFocusOverlayImage("GFX_focus_overlay_mod", overlayFiles))?.width, 4);
		assert.deepStrictEqual(errors, []);
	});

	it("warns once about a configured file that does not exist, and logs no error", async function () {
		configure(["interface/goals_overlays.gfx"]);
		const overlayFiles = await getFocusOverlayGfxFiles();
		assert.deepStrictEqual(overlayFiles, []);
		assert.strictEqual(await getFocusOverlayImage("GFX_focus_overlay_mod", overlayFiles), undefined);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].includes("mdHoi4Utilities.focusOverlayGfxFiles"), warnings[0]);
		assert.deepStrictEqual(errors, []);
		assert.ok(!reads.some(r => r.endsWith(".gfx")), reads.join(", "));
	});
});
