import * as assert from "assert";
import * as vscode from "vscode";
import { listModifierDefinitionFiles, loadModifierDefinitions } from "../util/modifiers";
import { clearDlcZipCache } from "../util/fileloader";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// The built-in formats cover the base game; a mod names files that set its own in the
// modifierFormatFiles setting or a modifier_format_files list in its .mod file. Issue #453.
describe("util/modifiers format files from the setting and the .mod file", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;
	let files: Map<string, string>;
	let directories: Record<string, [string, vscode.FileType][]>;
	let warnings: string[];
	let originalWarn: typeof Logger.warn;
	let counter = 0;

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/\\/g, "/")
			.replace(/^file:\/\//, "")
			.replace(/^\/ws\/?/, "");
	}

	function configure(modifierFormatFiles: string[], descriptor?: string): void {
		// A fresh .mod per test: the descriptor cache is keyed by path.
		const modFile = `/ws/formats${counter++}.mod`;
		files.set(modFile.replace(/^\/ws\//, ""), descriptor ?? 'name="test"\n');
		stubVscode({
			configuration: { modFile, installPath: "", loadDlcContents: false, parentModPaths: [], modifierFormatFiles },
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
		files = new Map<string, string>();
		directories = {};
		warnings = [];
		originalWarn = Logger.warn;
		Logger.warn = (message: string) => {
			warnings.push(message);
		};
	});

	afterEach(async function () {
		Logger.warn = originalWarn;
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("uses the built-in format when nothing is named", async function () {
		configure([]);
		const definitions = await loadModifierDefinitions();
		assert.strictEqual(definitions["political_power_gain"], undefined);
		assert.deepStrictEqual(await listModifierDefinitionFiles(), []);
	});

	it("changes only the fields a file from the setting writes", async function () {
		files.set("common/formats_a.txt", "political_power_gain = { value_type = percentage }\n");
		configure(["common/formats_a.txt"]);
		assert.deepStrictEqual((await loadModifierDefinitions())["political_power_gain"], {
			valueType: "percentage",
			precision: 2,
			colorType: "neutral",
			postfix: "none",
		});
		assert.deepStrictEqual(await listModifierDefinitionFiles(), ["common/formats_a.txt"]);
	});

	it("reads a file the .mod file names, over a built-in override", async function () {
		files.set("common/formats_b.txt", "conscription = { value_type = number precision = 1 color_type = bad }\n");
		configure([], 'name="test"\nmodifier_format_files = { "common/formats_b.txt" }\n');
		assert.deepStrictEqual((await loadModifierDefinitions())["conscription"], {
			valueType: "number",
			precision: 1,
			colorType: "bad",
			postfix: "none",
		});
	});

	it("scans a folder for .txt files", async function () {
		files.set("common/md_formats/one.txt", "stability_weekly = { precision = 1 }\n");
		files.set("common/md_formats/notes.md", "");
		directories["common/md_formats"] = [["one.txt", File], ["notes.md", File]];
		configure(["common/md_formats"]);
		assert.deepStrictEqual(await listModifierDefinitionFiles(), ["common/md_formats/one.txt"]);
		assert.strictEqual((await loadModifierDefinitions())["stability_weekly"]?.precision, 1);
	});

	it("reports a path that names nothing, with where it was configured", async function () {
		configure(["common/missing.txt"]);
		assert.deepStrictEqual(await listModifierDefinitionFiles(), []);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].includes("mdHoi4Utilities.modifierFormatFiles"), warnings[0]);
		assert.ok(warnings[0].includes("common/missing.txt"), warnings[0]);
	});
});
