import * as assert from "assert";
import * as vscode from "vscode";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { convertFocusFileNodeToJson } from "../previewdef/focustree/schema";
import {
	auditFocusTrees,
	auditReportFileName,
	collectFocusWarnings,
	copyTreeWarnings,
	FileWarnings,
	formatFocusWarningReport,
	ParsedFocusFile,
} from "../previewdef/focustree/warningreport";
import { refreshFeatureFlags } from "../util/featureflags";
import { clearDlcZipCache } from "../util/fileloader";
import { clearParentModCache } from "../util/parentmods";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

function parsed(path: string, content: string): ParsedFocusFile {
	return { path, file: convertFocusFileNodeToJson(parseHoi4File(content), {}) };
}

// Two focuses on one spot: the layout check reports it, whichever tree the focuses end up in.
const sharedFile = parsed(
	"common/national_focus/shared.txt",
	`shared_focus = { id = SH_root x = 0 y = 0 }
shared_focus = { id = SH_child x = 0 y = 0 }`,
);

function countryFile(tag: string): ParsedFocusFile {
	return parsed(
		`common/national_focus/${tag}.txt`,
		`focus_tree = {
    id = ${tag}_tree
    shared_focus = SH_root
    shared_focus = SH_child
    focus = { id = ${tag}_start x = 10 y = 0 }
}`,
	);
}

function withConditionsInFocus<T>(run: () => T): T {
	stubVscode({ configuration: { useConditionInFocus: true } });
	refreshFeatureFlags();
	try {
		return run();
	} finally {
		restoreVscodeStubs();
		refreshFeatureFlags();
	}
}

describe("previewdef/focustree warning report", () => {
	describe("collectFocusWarnings", () => {
		it("lists a warning under the file its focus is in", () => {
			const result = collectFocusWarnings([
				parsed(
					"common/national_focus/overlap.txt",
					`focus_tree = {
    id = overlap_tree
    focus = { id = a x = 0 y = 0 }
    focus = { id = b x = 1 y = 0 }
}`,
				),
			]);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].file, "common/national_focus/overlap.txt");
			assert.ok(result[0].warnings.length > 0);
			assert.ok(result[0].warnings.every((w) => w.treeId === "overlap_tree"));
		});

		it("leaves out a file without warnings", () => {
			const result = collectFocusWarnings([
				parsed(
					"common/national_focus/clean.txt",
					"focus_tree = { id = clean focus = { id = a x = 0 y = 0 } }",
				),
			]);
			assert.deepStrictEqual(result, []);
		});

		// Each country tree merges the shared focuses and validates them again, so without keying on
		// the defining file the one problem would be listed three times.
		it("lists a shared focus's warning once, under the shared file", () => {
			const result = withConditionsInFocus(() =>
				collectFocusWarnings([countryFile("AAA"), sharedFile, countryFile("BBB")]),
			);
			assert.deepStrictEqual(
				result.map((f) => f.file),
				["common/national_focus/shared.txt"],
			);
			const shared = result[0];
			const keys = shared.warnings.map((w) => `${w.source}|${w.text}`);
			assert.strictEqual(new Set(keys).size, keys.length, "a warning is listed twice");
			assert.ok(shared.warnings.some((w) => w.source.startsWith("SH_")));
		});
	});

	describe("formatFocusWarningReport", () => {
		const files: FileWarnings[] = [
			{
				file: "common/national_focus/b.txt",
				warnings: [{ treeId: "b_tree", source: "b_focus", text: "Line one.\nLine two." }],
			},
			{ file: "common/national_focus/a.txt", warnings: [], parseError: "In file a.txt:\nunexpected }" },
			{ file: "common/national_focus/c.txt", warnings: [] },
		];

		it("writes one section per file with problems, sorted by path", () => {
			const report = formatFocusWarningReport(files, 3);
			assert.strictEqual(
				report,
				[
					"# Focus tree warnings",
					"",
					"Checked 3 focus tree files: 2 warnings in 2 files.",
					"",
					"## common/national_focus/a.txt",
					"",
					"- Could not parse this file: In file a.txt: unexpected }",
					"",
					"## common/national_focus/b.txt",
					"",
					"- `b_focus` (`b_tree`): Line one. Line two.",
					"",
				].join("\n"),
			);
		});

		it("says so when nothing was found", () => {
			assert.strictEqual(
				formatFocusWarningReport([], 4),
				"# Focus tree warnings\n\nChecked 4 focus tree files: 0 warnings in 0 files.\n\nNo warnings.\n",
			);
		});
	});

	describe("copyTreeWarnings", () => {
		afterEach(() => restoreVscodeStubs());

		function capture(): { copied: string[]; messages: string[] } {
			const copied: string[] = [];
			const messages: string[] = [];
			stubVscode({
				clipboardWriteText: async (text: string) => {
					copied.push(text);
				},
				showInformationMessage: async (message: string) => {
					messages.push(message);
				},
			});
			return { copied, messages };
		}

		it("copies the tree's warnings as the report section for the file", async () => {
			const { copied, messages } = capture();
			await copyTreeWarnings(
				{
					command: "copyWarnings",
					treeId: "<Shared focuses>",
					warnings: [{ source: "a", text: "Something is wrong." }],
				},
				"common/national_focus/x.txt",
			);
			assert.deepStrictEqual(copied, [
				"## common/national_focus/x.txt\n\n- `a` (`<Shared focuses>`): Something is wrong.\n",
			]);
			assert.deepStrictEqual(messages, ["Copied 1 warnings."]);
		});

		it("copies nothing for a tree without warnings", async () => {
			const { copied, messages } = capture();
			await copyTreeWarnings({ command: "copyWarnings", treeId: "t", warnings: [] }, "x.txt");
			assert.deepStrictEqual(copied, []);
			assert.deepStrictEqual(messages, ["This focus tree has no warnings."]);
		});

		it("ignores a message of the wrong shape", async () => {
			const { copied, messages } = capture();
			await copyTreeWarnings({ command: "copyWarnings", treeId: 1, warnings: "x" }, "x.txt");
			await copyTreeWarnings({ command: "copyWarnings", treeId: "t", warnings: [{ source: 1 }] }, "x.txt");
			assert.deepStrictEqual(copied, []);
			assert.deepStrictEqual(messages, []);
		});
	});

	// The command as the settings link runs it: real folders for the mod and the game, the report
	// opened in an editor or written to the configured folder.
	describe("auditFocusTrees", function () {
		const nodeFs = require("fs/promises") as typeof import("fs/promises");
		const nodePath = require("path") as typeof import("path");
		const nodeOs = require("os") as typeof import("os");

		let root: string;
		let workspaceDir: string;
		let gameDir: string;
		let opened: { language?: string; content?: string }[];
		let shown: unknown[];
		let errors: string[];

		function realPathOf(uri: unknown): string {
			const raw = String((uri as { fsPath?: string; path?: string }).fsPath ?? (uri as { path?: string }).path ?? "");
			if (raw.startsWith("hoi4installpath:")) {
				return nodePath.join(gameDir, raw.slice("hoi4installpath:".length).replace(/^\/+/, ""));
			}
			return raw.startsWith("file://") ? raw.slice("file://".length) : raw;
		}

		async function write(fullPath: string, content: string): Promise<void> {
			await nodeFs.mkdir(nodePath.dirname(fullPath), { recursive: true });
			await nodeFs.writeFile(fullPath, content);
		}

		function configure(settings: Record<string, unknown>): void {
			stubVscode({
				configuration: {
					modFile: nodePath.join(root, "mod.mod"),
					installPath: gameDir,
					loadDlcContents: false,
					parentModPaths: [],
					get: (key: string) => settings[key],
				},
			});
			clearParentModCache();
		}

		beforeEach(async function () {
			root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "hoi4audit-"));
			workspaceDir = nodePath.join(root, "ws");
			gameDir = nodePath.join(root, "game");
			await write(nodePath.join(root, "mod.mod"), 'name="mod"\n');
			await write(
				nodePath.join(workspaceDir, "common", "national_focus", "mod_tree.txt"),
				"focus_tree = { id = mod_tree focus = { id = m1 x = 0 y = 0 } focus = { id = m2 x = 0 y = 0 } }",
			);
			await write(nodePath.join(workspaceDir, "common", "national_focus", "broken.txt"), "focus_tree = { id = broken");
			await write(nodePath.join(workspaceDir, "common", "national_focus", "notes.md"), "not a focus file");
			await write(
				nodePath.join(gameDir, "common", "national_focus", "vanilla.txt"),
				"focus_tree = { id = vanilla_tree focus = { id = v1 x = 0 y = 0 } focus = { id = v2 x = 0 y = 0 } }",
			);

			opened = [];
			shown = [];
			errors = [];
			stubVscode({
				workspaceFolders: [{ uri: vscode.Uri.file(workspaceDir) }],
				stat: async (uri: unknown) => {
					const stat = await nodeFs.stat(realPathOf(uri));
					return {
						type: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
						mtime: stat.mtime.getTime(),
						ctime: stat.birthtime.getTime(),
						size: stat.size,
					};
				},
				readDirectory: async (uri: unknown) => {
					const dirents = await nodeFs.readdir(realPathOf(uri), { withFileTypes: true });
					return dirents.map(
						(d) => [d.name, d.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File] as [string, number],
					);
				},
				readFile: async (uri: unknown) => nodeFs.readFile(realPathOf(uri)),
				writeFile: async (uri: unknown, content: Uint8Array) => write(realPathOf(uri), Buffer.from(content).toString()),
				createDirectory: async (uri: unknown) => {
					await nodeFs.mkdir(realPathOf(uri), { recursive: true });
				},
				openTextDocument: async (options: any) => {
					opened.push(options);
					return options;
				},
				showTextDocument: async (document: unknown) => {
					shown.push(document);
				},
				showErrorMessage: async (message: string) => {
					errors.push(message);
				},
			});
		});

		afterEach(async function () {
			restoreVscodeStubs();
			clearParentModCache();
			await clearDlcZipCache();
			await nodeFs.rm(root, { recursive: true, force: true });
		});

		it("opens the report for the mod's focus files in an unsaved Markdown tab", async function () {
			configure({});
			await auditFocusTrees();

			assert.deepStrictEqual(errors, []);
			assert.strictEqual(opened.length, 1);
			assert.strictEqual(opened[0].language, "markdown");
			const report = opened[0].content!;
			assert.ok(report.includes("Checked 2 focus tree files"), report);
			assert.ok(report.includes("## common/national_focus/mod_tree.txt"), report);
			assert.ok(report.includes("## common/national_focus/broken.txt\n\n- Could not parse this file:"), report);
			assert.ok(!report.includes("vanilla.txt"), report);
			assert.deepStrictEqual(shown, [opened[0]]);
		});

		it("reports an unreadable focus file without losing the others", async function () {
			configure({});
			stubVscode({
				readFile: async (uri: unknown) => {
					const file = realPathOf(uri);
					if (file.endsWith("mod_tree.txt")) {
						throw new Error("permission denied");
					}
					return nodeFs.readFile(file);
				},
			});
			await auditFocusTrees();

			assert.deepStrictEqual(errors, []);
			const report = opened[0].content!;
			assert.ok(report.includes("## common/national_focus/mod_tree.txt\n\n- Could not parse this file: permission denied"), report);
			assert.ok(report.includes("## common/national_focus/broken.txt"), report);
		});

		it("checks the game's focus files too when asked to", async function () {
			configure({ "auditor.includeVanilla": true });
			await auditFocusTrees();

			const report = opened[0].content!;
			assert.ok(report.includes("Checked 3 focus tree files"), report);
			assert.ok(report.includes("## common/national_focus/vanilla.txt"), report);
		});

		it("writes the report into the configured folder and opens that file", async function () {
			configure({ "auditor.reportFolder": "audit" });
			await auditFocusTrees();

			assert.deepStrictEqual(errors, []);
			assert.deepStrictEqual(opened, []);
			const written = await nodeFs.readFile(nodePath.join(workspaceDir, "audit", auditReportFileName), "utf8");
			assert.ok(written.startsWith("# Focus tree warnings"), written);
			assert.ok(written.includes("## common/national_focus/mod_tree.txt"), written);
			assert.strictEqual(shown.length, 1);
		});
	});
});
