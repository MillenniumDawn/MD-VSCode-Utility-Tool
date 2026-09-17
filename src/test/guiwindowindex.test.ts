import * as assert from "assert";
import * as vscode from "vscode";
import { findContainerWindows, listGfxFilesFromConfiguredRoots } from "../util/guiwindowindex";
import * as fileloader from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// The interface-tree lookups used to swallow every failure: a misspelled gfx root in a user setting
// listed nothing and said nothing, an unparseable .gui made its windows vanish with no trace. Each
// case now leaves a line in the HOI4 Modding channel naming the path (issue #182).
describe("util/guiwindowindex", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;

	let warnings: string[];
	let errors: string[];
	let originalWarn: (message: string) => void;
	let originalError: (message: string) => void;
	// relative path -> content, served by the stubbed workspace fs. A path that names a directory
	// listed in `directories` stats as a folder.
	let files: Record<string, string>;
	let directories: Record<string, [string, number][]>;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\//, "")
			.replace(/^\/ws$/, "");
	}

	beforeEach(function () {
		warnings = [];
		errors = [];
		originalWarn = Logger.warn;
		originalError = Logger.error;
		Logger.warn = (message: string) => {
			warnings.push(message);
		};
		Logger.error = (message: string) => {
			errors.push(message);
		};
		files = {};
		directories = {};
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
				const p = rel(uri);
				if (p in directories) {
					return { type: Directory, mtime: 1, ctime: 0, size: 0 };
				}
				if (p in files) {
					return { type: File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + p);
			},
			readDirectory: async (uri: any) => directories[rel(uri)] ?? [],
			readFile: async (uri: any) => {
				const p = rel(uri);
				if (p in files) {
					return Buffer.from(files[p]);
				}
				throw new Error("not found: " + p);
			},
		});
	});

	afterEach(async function () {
		Logger.warn = originalWarn;
		Logger.error = originalError;
		restoreVscodeStubs();
		await fileloader.clearDlcZipCache();
	});

	describe("listGfxFilesFromConfiguredRoots", function () {
		it("lists the .gfx files under a configured root, with backslashes normalised", async function () {
			directories["gfx/custom"] = [["icons.gfx", File], ["notes.txt", File]];
			const result = await listGfxFilesFromConfiguredRoots(["gfx\\custom"], "mdHoi4Utilities.technologyGfxRoots");
			assert.deepStrictEqual(result, ["gfx/custom/icons.gfx"]);
			assert.deepStrictEqual(warnings, []);
			assert.deepStrictEqual(errors, []);
		});

		it("skips blank entries without a word", async function () {
			const result = await listGfxFilesFromConfiguredRoots(["", "   ", undefined, null], "mdHoi4Utilities.technologyGfxRoots");
			assert.deepStrictEqual(result, []);
			assert.deepStrictEqual(warnings, []);
			assert.deepStrictEqual(errors, []);
		});

		it("warns, naming the setting and the root, when a root lists no .gfx files", async function () {
			// A folder that exists nowhere is not an error to the file listing -- it lists nothing --
			// so this is the only trace a typo in the setting leaves.
			const result = await listGfxFilesFromConfiguredRoots(["gfx/custmo"], "mdHoi4Utilities.inlayWindowGfxRoots");
			assert.deepStrictEqual(result, []);
			assert.strictEqual(warnings.length, 1);
			assert.ok(warnings[0].includes("mdHoi4Utilities.inlayWindowGfxRoots"), warnings[0]);
			assert.ok(warnings[0].includes('"gfx/custmo"'), warnings[0]);
			assert.deepStrictEqual(errors, []);
		});

		it("logs an error naming the root when listing it throws, and carries on with the next root", async function () {
			directories["gfx/good"] = [["a.gfx", File]];
			const origList = fileloader.listFilesFromModOrHOI4;
			(fileloader as any).listFilesFromModOrHOI4 = async (relativePath: string, options?: any) => {
				if (relativePath === "gfx/broken") {
					throw new Error("EACCES: permission denied");
				}
				return origList(relativePath, options);
			};
			try {
				const result = await listGfxFilesFromConfiguredRoots(["gfx/broken", "gfx/good"], "mdHoi4Utilities.technologyGfxRoots");
				assert.deepStrictEqual(result, ["gfx/good/a.gfx"]);
			} finally {
				(fileloader as any).listFilesFromModOrHOI4 = origList;
			}
			assert.strictEqual(errors.length, 1);
			assert.ok(errors[0].includes("mdHoi4Utilities.technologyGfxRoots"), errors[0]);
			assert.ok(errors[0].includes('"gfx/broken"'), errors[0]);
			assert.ok(errors[0].includes("EACCES"), errors[0]);
			assert.deepStrictEqual(warnings, []);
		});
	});

	describe("findContainerWindows", function () {
		it("logs an error naming the file and the window it was after when a .gui does not parse", async function () {
			files["interface/broken.gui"] = "guiTypes = { containerWindowType = { name = my_window } } }";
			files["interface/ok.gui"] = "guiTypes = { containerWindowType = { name = other_window } }";

			const result = await findContainerWindows(["my_window", "other_window"], ["interface/broken.gui", "interface/ok.gui"]);

			assert.deepStrictEqual(Object.keys(result), ["other_window"]);
			assert.strictEqual(errors.length, 1);
			assert.ok(errors[0].includes("interface/broken.gui"), errors[0]);
			assert.ok(errors[0].includes("my_window"), errors[0]);
		});

		it("is silent when every file parses", async function () {
			files["interface/ok.gui"] = "guiTypes = { containerWindowType = { name = my_window } }";
			const result = await findContainerWindows(["my_window"], ["interface/ok.gui"]);
			assert.deepStrictEqual(Object.keys(result), ["my_window"]);
			assert.deepStrictEqual(errors, []);
		});
	});
});
