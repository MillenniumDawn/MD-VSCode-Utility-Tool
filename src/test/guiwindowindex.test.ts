import * as assert from "assert";
import * as vscode from "vscode";
import { _clearGuiWindowIndexForTest, findContainerWindows, listGfxFilesFromConfiguredRoots } from "../util/guiwindowindex";
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
		_clearGuiWindowIndexForTest();
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

// The interface tree is several hundred .gui files, far more than the shared parse cache holds.
// These pin the scan's contract over a list that size (150 files, past both the 64-entry parse
// cache and the 100-entry content cache, so a scan that went through either would show up as
// re-reads): what a scan already read is not read again on the next scan, the scan stops once it
// has what it was asked for, the first file to define a name wins regardless of batching, and an
// edited file is the only one re-read.
describe("util/guiwindowindex findContainerWindows", function () {
	const fileCount = 150;
	let readsByFile: Map<string, number>;
	let contentByFile: Map<string, string>;
	let mtimeByFile: Map<string, number>;

	function guiFile(index: number): string {
		return `interface/scan_${index}.gui`;
	}

	function fileFor(uri: { path?: string; fsPath?: string }): string {
		const p = String(uri.path ?? uri.fsPath ?? "").replace(/\\/g, "/");
		return p.substring(p.indexOf("interface/"));
	}

	function windowDefinition(names: string[]): string {
		return `guiTypes = {\n${names
			.map((name) => `\tcontainerWindowType = { name = "${name}" }\n`)
			.join("")}}`;
	}

	function totalReads(): number {
		let total = 0;
		for (const count of readsByFile.values()) {
			total += count;
		}
		return total;
	}

	beforeEach(function () {
		readsByFile = new Map();
		contentByFile = new Map();
		mtimeByFile = new Map();
		for (let i = 0; i < fileCount; i++) {
			contentByFile.set(guiFile(i), windowDefinition([`window_${i}`]));
		}
		stubVscode({
			now: () => 4000,
			stat: async (uri: any) => ({
				type: vscode.FileType.File,
				mtime: mtimeByFile.get(fileFor(uri)) ?? 1,
				ctime: 0,
				size: 0,
			}),
			readFile: async (uri: any) => {
				const file = fileFor(uri);
				readsByFile.set(file, (readsByFile.get(file) ?? 0) + 1);
				const content = contentByFile.get(file);
				if (content === undefined) {
					throw new Error(`unexpected read of ${file}`);
				}
				return Buffer.from(content);
			},
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
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		_clearGuiWindowIndexForTest();
		await fileloader.clearDlcZipCache();
	});

	const allFiles = () => Array.from({ length: fileCount }, (_, i) => guiFile(i));

	it("resolves a window past the old cache limits and re-reads nothing on the next scan", async function () {
		const first = await findContainerWindows(["window_140"], allFiles());
		assert.strictEqual(first["window_140"]?.file, guiFile(140));
		assert.strictEqual(first["window_140"]?.window.name, "window_140");
		const coldReads = totalReads();
		assert.ok(coldReads >= 141, `cold scan must reach file 140, read ${coldReads}`);

		const second = await findContainerWindows(["window_140"], allFiles());
		assert.strictEqual(second["window_140"]?.file, guiFile(140));
		assert.strictEqual(totalReads(), coldReads, "warm scan read a file again");
	});

	it("stops after the batch that resolved the last name", async function () {
		const found = await findContainerWindows(["window_3"], allFiles());
		assert.strictEqual(found["window_3"]?.file, guiFile(3));
		assert.ok(totalReads() <= 16, `read ${totalReads()} files for a window in file 3`);
	});

	it("lets the first file in the list define a name, whatever batch it lands in", async function () {
		contentByFile.set(guiFile(2), windowDefinition(["shared", "window_2"]));
		contentByFile.set(guiFile(9), windowDefinition(["shared", "window_9"]));
		contentByFile.set(guiFile(40), windowDefinition(["shared", "window_40"]));

		const found = await findContainerWindows(["shared", "window_40"], allFiles());
		assert.strictEqual(found["shared"]?.file, guiFile(2));
		assert.strictEqual(found["window_40"]?.file, guiFile(40));
	});

	it("skips a file that fails to parse and goes on with the rest", async function () {
		contentByFile.set(guiFile(1), "guiTypes = { containerWindowType = { name = ");

		const found = await findContainerWindows(["window_5"], allFiles());
		assert.strictEqual(found["window_5"]?.file, guiFile(5));
	});

	it("re-reads only the file that changed", async function () {
		await findContainerWindows(["window_20"], allFiles());
		const coldReads = totalReads();

		contentByFile.set(guiFile(4), windowDefinition(["window_4", "added_later"]));
		mtimeByFile.set(guiFile(4), 2);
		stubVscode({ now: () => 4000 + 1000 });

		const found = await findContainerWindows(["added_later"], allFiles());
		assert.strictEqual(found["added_later"]?.file, guiFile(4));
		assert.strictEqual(readsByFile.get(guiFile(4)), 2);
		assert.strictEqual(totalReads(), coldReads + 1, "an unchanged file was read again");
	});

	it("leaves a name no file defines out of the result", async function () {
		const found = await findContainerWindows(["nowhere", "window_7"], allFiles());
		assert.strictEqual(found["window_7"]?.file, guiFile(7));
		assert.ok(!("nowhere" in found));
	});
});