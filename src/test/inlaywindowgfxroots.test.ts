import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { listInlayWindowGfxFiles } from "../previewdef/focustree/inlay";
import { clearDlcZipCache } from "../util/fileloader";
import { _clearGuiWindowIndexForTest } from "../util/guiwindowindex";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Focus inlay window sprites are looked up in the folders the inlayWindowGfxRoots setting or an
// inlay_window_gfx_roots list in the .mod file names, then in the whole interface/ folder. The
// setting used to default to interface/scripted_gui, which only Millennium Dawn has, so every base-game
// focus tree with an inlay logged a path warning for it. Issue #451.
describe("previewdef/focustree/inlay inlay window gfx roots", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;
	let errors: string[];
	let warnings: string[];
	let originalError: (message: string) => void;
	let originalWarn: (message: string) => void;
	let files: Map<string, string>;
	let directories: Record<string, [string, vscode.FileType][]>;
	let modFileCounter = 0;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/\\/g, "/")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\/?/, "");
	}

	function configure(inlayWindowGfxRoots: string[], descriptor?: string): void {
		// A fresh .mod per test: the descriptor cache is keyed by its path.
		const modFile = `/ws/inlaytest${modFileCounter++}.mod`;
		files.set(modFile.replace(/^\/ws\//, ""), descriptor ?? 'name="test"\n');
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], inlayWindowGfxRoots },
			workspaceFolders: [
				{ uri: { fsPath: "/ws", path: "/ws", scheme: "file", toString: () => "file:///ws" } },
			],
			stat: async (uri: any) => {
				const key = rel(uri);
				if (files.has(key)) {
					return { type: File, mtime: 1, ctime: 0, size: 0 };
				}
				if (key in directories) {
					return { type: Directory, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + key);
			},
			readFile: async (uri: any) => {
				const content = files.get(rel(uri));
				if (content !== undefined) {
					return Buffer.from(content);
				}
				throw new Error("not found: " + rel(uri));
			},
			readDirectory: async (uri: any) => {
				const entries = directories[rel(uri)];
				if (entries === undefined) {
					throw new Error("not found: " + rel(uri));
				}
				return entries;
			},
		});
	}

	beforeEach(function () {
		errors = [];
		warnings = [];
		originalError = Logger.error;
		originalWarn = Logger.warn;
		Logger.error = (message: string) => {
			errors.push(message);
		};
		Logger.warn = (message: string) => {
			warnings.push(message);
		};
		files = new Map<string, string>();
		directories = {
			"interface": [["goals.gfx", File]],
		};
	});

	afterEach(async function () {
		Logger.error = originalError;
		Logger.warn = originalWarn;
		restoreVscodeStubs();
		_clearGuiWindowIndexForTest();
		await clearDlcZipCache();
	});

	it("configures no root by default", function () {
		const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf-8"));
		const properties = Object.assign({}, ...[packageJson.contributes.configuration].flat().map((c: any) => c.properties));
		assert.deepStrictEqual(properties["mdHoi4Utilities.inlayWindowGfxRoots"].default, []);
	});

	it("scans only the interface folder when nothing is configured, without a warning", async function () {
		configure([]);
		assert.deepStrictEqual(await listInlayWindowGfxFiles(), ["interface/goals.gfx"]);
		assert.deepStrictEqual(warnings, []);
		assert.deepStrictEqual(errors, []);
	});

	it("scans a folder the .mod file names before the interface folder", async function () {
		directories["interface"].push(["scripted_gui", Directory]);
		directories["interface/scripted_gui"] = [["inner_circle.gfx", File]];
		configure([], 'name="test"\ninlay_window_gfx_roots = { "interface/scripted_gui" }\n');
		const gfxFiles = await listInlayWindowGfxFiles();
		assert.deepStrictEqual(gfxFiles[0], "interface/scripted_gui/inner_circle.gfx");
		assert.ok(gfxFiles.includes("interface/goals.gfx"), gfxFiles.join(", "));
		assert.deepStrictEqual(warnings, []);
		assert.deepStrictEqual(errors, []);
	});

	it("names the .mod file in the warning for a folder it lists that does not exist", async function () {
		configure([], 'name="test"\ninlay_window_gfx_roots = { "interface/scripted_gui" }\n');
		assert.deepStrictEqual(await listInlayWindowGfxFiles(), ["interface/goals.gfx"]);
		assert.strictEqual(warnings.length, 1, warnings.join("; "));
		assert.ok(warnings[0].includes("inlay_window_gfx_roots in the .mod file"), warnings[0]);
		assert.deepStrictEqual(errors, []);
	});
});
