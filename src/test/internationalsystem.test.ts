import * as assert from "assert";
import {
	addInternationalSystem,
	createdFiles,
	listTabs,
	registerAddInternationalSystemCommand,
	scaffolderArgs,
	scaffolderPath,
	validateKey,
} from "../util/internationalsystem";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

// The module object itself, which the command reads execFile from at call time; an `import *`
// namespace only has getters.
const childProcess = require("child_process") as typeof import("child_process");

const strip = `
			buttonType = {
				name = "space_gui_ledger_button"
			}
			iconType = {
				name ="icon_ledger_btn_1"
			}
			buttonType = {
				name = "un_gui_ledger_button"
			}
`;

describe("util/internationalsystem", () => {
	it("lists the tabs in strip order", () => {
		assert.deepStrictEqual(listTabs(strip), ["space", "un"]);
	});

	it("rejects keys that are not lower_snake_case or already a tab", () => {
		assert.strictEqual(validateKey("forums", ["space", "un"]), undefined);
		assert.notStrictEqual(validateKey("Forums", ["space"]), undefined);
		assert.notStrictEqual(validateKey("1forums", ["space"]), undefined);
		assert.notStrictEqual(validateKey("un", ["space", "un"]), undefined);
	});

	it("passes every answer to the scaffolder as its own argument", () => {
		assert.deepStrictEqual(scaffolderArgs("forums", "Economic Forums", "Track the forums.", "un"), [
			scaffolderPath,
			"forums",
			"Economic Forums",
			"--description",
			"Track the forums.",
			"--after",
			"un",
		]);
	});

	it("opens only the files the scaffolder created for the new tab", () => {
		const output = [
			"Tabs: space, un, forums",
			"  wrote common/scripted_guis/00_missiles_scripted_guis.txt",
			"  wrote common/scripted_guis/01_international_forums_gui.txt",
			"  wrote interface/MD_countrymissilesview.gui",
			"  wrote interface/MD_international_forums.gui",
			"  wrote localisation/english/MD_international_forums_l_english.yml",
			"",
		].join("\r\n");
		assert.deepStrictEqual(createdFiles(output, "forums"), [
			"common/scripted_guis/01_international_forums_gui.txt",
			"interface/MD_international_forums.gui",
			"localisation/english/MD_international_forums_l_english.yml",
		]);
	});
});

describe("Add International Systems Tab command", () => {
	type Run = { file: string; args: readonly string[]; cwd: string | undefined };
	const originalExecFile = childProcess.execFile;
	let runs: Run[];
	let errors: string[];
	let infos: string[];
	let opened: string[];
	let inputOptions: any[];

	const folder = { uri: { fsPath: "mod", path: "/mod", toString: () => "file://mod" }, name: "mod", index: 0 };

	function fakeExecFile(results: Array<{ code?: string; stderr?: string; stdout?: string }>): void {
		(childProcess as any).execFile = (file: string, args: readonly string[], options: any, callback: any) => {
			runs.push({ file, args, cwd: options?.cwd });
			const result = results.shift() ?? {};
			const failure = result.code ? Object.assign(new Error(result.code), { code: result.code }) : null;
			callback(failure, result.stdout ?? "", result.stderr ?? "");
		};
	}

	function stubPrompts(answers: Array<string | undefined>, after: string | null = "un"): void {
		stubVscode({
			workspaceFolders: [folder],
			stat: async () => ({ type: 1 }),
			readFile: async () => Buffer.from(strip, "utf8"),
			showInputBox: async (options: any) => {
				inputOptions.push(options);
				return answers.shift();
			},
			showQuickPick: async (items: string[]) => {
				assert.deepStrictEqual(items, ["un", "space"]);
				return after ?? undefined;
			},
			showTextDocument: async (uri: any) => {
				opened.push(uri.fsPath.replace(/\\/g, "/"));
			},
			showErrorMessage: async (message: string) => {
				errors.push(message);
			},
			showInformationMessage: async (message: string) => {
				infos.push(message);
			},
		});
	}

	beforeEach(() => {
		runs = [];
		errors = [];
		infos = [];
		opened = [];
		inputOptions = [];
	});

	afterEach(() => {
		(childProcess as any).execFile = originalExecFile;
		restoreVscodeStubs();
	});

	it("runs the scaffolder with the answers and opens the new files", async () => {
		stubPrompts(["forums", " Economic Forums ", " Track the forums. "]);
		fakeExecFile([
			{
				stdout: "Tabs: space, un, forums\n  wrote interface/MD_countrymissilesview.gui\n  wrote interface/MD_international_forums.gui\n",
			},
		]);

		await addInternationalSystem();

		assert.strictEqual(runs.length, 1);
		assert.deepStrictEqual(runs[0]!.args, scaffolderArgs("forums", "Economic Forums", "Track the forums.", "un"));
		assert.strictEqual(runs[0]!.cwd, "mod");
		assert.strictEqual(opened.length, 1);
		assert.ok(opened[0]!.endsWith("mod/interface/MD_international_forums.gui"), opened[0]);
		assert.deepStrictEqual(infos, ["Tabs: space, un, forums"]);
		assert.deepStrictEqual(errors, []);
		assert.notStrictEqual(inputOptions[0].validateInput("un"), undefined);
		assert.notStrictEqual(inputOptions[1].validateInput("  "), undefined);
		assert.strictEqual(inputOptions[2].validateInput("Text."), undefined);
	});

	it("tries the next Python when the first is not installed", async () => {
		stubPrompts(["forums", "Forums", "Forums."]);
		fakeExecFile([{ code: "ENOENT" }, { stdout: "Tabs: space, un, forums\n" }]);

		await addInternationalSystem();

		assert.strictEqual(runs.length, 2);
		assert.notStrictEqual(runs[0]!.file, runs[1]!.file);
		assert.deepStrictEqual(errors, []);
	});

	it("shows the scaffolder's own error when it refuses", async () => {
		stubPrompts(["forums", "Forums", "Forums."]);
		fakeExecFile([{ code: "1", stderr: "ERROR: add the tab icon first\n" }]);

		await addInternationalSystem();

		assert.strictEqual(runs.length, 1);
		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0]!.includes("ERROR: add the tab icon first"), errors[0]);
	});

	for (const [step, answers, after] of [
		["key", [undefined], "un"],
		["name", ["forums", undefined], "un"],
		["description", ["forums", "Forums", undefined], "un"],
		["placement", ["forums", "Forums", "Forums."], null],
	] as const) {
		it(`stops without running anything when the ${step} prompt is dismissed`, async () => {
			stubPrompts([...answers], after);
			fakeExecFile([]);

			await addInternationalSystem();

			assert.deepStrictEqual(runs, []);
			assert.deepStrictEqual(errors, []);
		});
	}

	it("asks for the Millennium Dawn repository when no folder has the scaffolder", async () => {
		stubPrompts([]);
		stubVscode({
			stat: async () => {
				throw new Error("missing");
			},
		});
		fakeExecFile([]);

		await addInternationalSystem();

		assert.strictEqual(errors.length, 1);
		assert.ok(errors[0]!.includes(scaffolderPath), errors[0]);
		assert.deepStrictEqual(runs, []);
	});

	it("registers the command", () => {
		let registered: string | undefined;
		stubVscode({
			registerCommand: (command: string) => {
				registered = command;
				return { dispose() {} };
			},
		});

		registerAddInternationalSystemCommand();

		assert.strictEqual(registered, "mdhoi4utilities.addinternationalsystem");
	});
});
