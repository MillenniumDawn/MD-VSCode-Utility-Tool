import * as assert from "assert";
import {
	addInternationalSystem,
	createdFiles,
	formProblem,
	listTabs,
	panelBody,
	registerAddInternationalSystemCommand,
	scaffolderArgs,
	scaffolderPath,
	TabForm,
	validateKey,
} from "../util/internationalsystem";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

// The module objects themselves, which the command reads execFile from at call time; an `import *`
// namespace only has getters.
const childProcess = require("child_process") as typeof import("child_process");
const fs = require("fs") as typeof import("fs");

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

const form: TabForm = {
	key: "forums",
	name: " Economic Forums ",
	description: " Track the forums. ",
	title: "",
	after: "un",
	icon: "handshake",
};

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

	it("needs a name and a description before anything runs", () => {
		assert.strictEqual(formProblem(form, ["space", "un"]), undefined);
		assert.notStrictEqual(formProblem({ ...form, name: "  " }, ["space"]), undefined);
		assert.notStrictEqual(formProblem({ ...form, description: "" }, ["space"]), undefined);
		assert.notStrictEqual(formProblem({ ...form, key: "un" }, ["space", "un"]), undefined);
	});

	it("passes every answer to the scaffolder as its own argument", () => {
		assert.deepStrictEqual(scaffolderArgs(form), [
			scaffolderPath,
			"forums",
			"Economic Forums",
			"--description",
			"Track the forums.",
			"--after",
			"un",
			"--icon",
			"handshake",
		]);
		assert.deepStrictEqual(scaffolderArgs({ ...form, title: " Forums ", icon: "" }, "out.png").slice(7), [
			"--title",
			"Forums",
			"--preview",
			"out.png",
		]);
	});

	it("opens only the files the scaffolder created for the new tab", () => {
		const output = [
			"Tabs: space, un, forums",
			"  wrote common/scripted_guis/00_missiles_scripted_guis.txt",
			"  wrote common/scripted_guis/01_international_forums_gui.txt",
			"  wrote interface/MD_international_forums.gui",
			"",
		].join("\r\n");
		assert.deepStrictEqual(createdFiles(output, "forums"), [
			"common/scripted_guis/01_international_forums_gui.txt",
			"interface/MD_international_forums.gui",
		]);
	});

	it("draws a tab choice, the last tab selected, and every premade icon, escaped", () => {
		const body = panelBody(["space", "un<"], [{ name: "hand\"shake", png: "AAAA" }]);
		assert.ok(body.includes('<option value="un&lt;" selected>'), body);
		assert.ok(body.includes('data-icon="hand&quot;shake"'), body);
		assert.ok(body.includes('src="data:image/png;base64,AAAA"'), body);
	});
});

describe("Add International Systems Tab command", () => {
	type Run = { args: readonly string[] };
	const originalExecFile = childProcess.execFile;
	let runs: Run[];
	let errors: string[];
	let infos: string[];
	let opened: string[];
	let posted: any[];
	let handler: ((message: any) => Promise<void>) | undefined;
	let disposed: boolean;

	const folder = { uri: { fsPath: "mod", path: "/mod", toString: () => "file://mod" }, name: "mod", index: 0 };
	const catalog = JSON.stringify([{ name: "handshake", png: "AAAA" }]);

	function fakeExecFile(results: Array<{ code?: string; stderr?: string; stdout?: string }>): void {
		(childProcess as any).execFile = (_file: string, args: readonly string[], _options: any, callback: any) => {
			runs.push({ args });
			const result = results.shift() ?? {};
			const preview = args.indexOf("--preview");
			if (!result.code && preview !== -1) {
				fs.writeFileSync(args[preview + 1]!, Buffer.from([1, 2, 3]));
			}
			const failure = result.code ? Object.assign(new Error(result.code), { code: result.code }) : null;
			callback(failure, result.stdout ?? "", result.stderr ?? "");
		};
	}

	function stubCommand(enabled = true): void {
		stubVscode({
			configuration: { millenniumDawnInternationalSystems: enabled },
			workspaceFolders: [folder],
			stat: async () => ({ type: 1 }),
			readFile: async () => Buffer.from(strip, "utf8"),
			createWebviewPanel: () => ({
				webview: {
					html: "",
					cspSource: "stub",
					asWebviewUri: (uri: any) => uri,
					postMessage: async (message: any) => posted.push(message),
					onDidReceiveMessage: (listener: any) => {
						handler = listener;
						return { dispose() {} };
					},
				},
				dispose: () => {
					disposed = true;
				},
			}),
			showOpenDialog: async () => [{ fsPath: "logo.png" }],
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
		posted = [];
		handler = undefined;
		disposed = false;
	});

	afterEach(() => {
		(childProcess as any).execFile = originalExecFile;
		restoreVscodeStubs();
	});

	it("does nothing but point at the setting while it is off", async () => {
		stubCommand(false);
		fakeExecFile([]);

		await addInternationalSystem();

		assert.deepStrictEqual(runs, []);
		assert.strictEqual(infos.length, 1);
		assert.strictEqual(handler, undefined);
	});

	it("opens the panel with the premade icons from the scaffolder", async () => {
		stubCommand();
		fakeExecFile([{ stdout: catalog }]);

		await addInternationalSystem();

		assert.deepStrictEqual(runs[0]!.args, [scaffolderPath, "--list-icons"]);
		assert.notStrictEqual(handler, undefined);
	});

	it("previews the strip the scaffolder draws, and reports what it refuses", async () => {
		stubCommand();
		fakeExecFile([{ stdout: catalog }, {}, { code: "1", stderr: "ERROR: unknown icon" }]);
		await addInternationalSystem();

		await handler!({ type: "preview", form });
		await handler!({ type: "preview", form: { ...form, name: "" } });
		await handler!({ type: "preview", form });

		assert.strictEqual(runs[1]!.args.includes("--preview"), true);
		assert.deepStrictEqual(posted[0], { type: "preview", png: Buffer.from([1, 2, 3]).toString("base64") });
		assert.ok(posted[1].problem, posted[1]);
		assert.strictEqual(posted[2].problem, "ERROR: unknown icon");
		assert.strictEqual(runs.length, 3);
	});

	it("hands a picked image back to the panel", async () => {
		stubCommand();
		fakeExecFile([{ stdout: catalog }]);
		await addInternationalSystem();

		await handler!({ type: "pickImage" });

		assert.deepStrictEqual(posted, [{ type: "picked", path: "logo.png", label: "logo.png" }]);
	});

	it("creates the tab, opens its files and closes the panel", async () => {
		stubCommand();
		fakeExecFile([
			{ stdout: catalog },
			{ stdout: "Tabs: space, un, forums\n  wrote interface/MD_international_forums.gui\n" },
		]);
		await addInternationalSystem();

		await handler!({ type: "create", form });

		assert.deepStrictEqual(runs[1]!.args, scaffolderArgs(form));
		assert.strictEqual(opened.length, 1);
		assert.ok(opened[0]!.endsWith("mod/interface/MD_international_forums.gui"), opened[0]);
		assert.deepStrictEqual(infos, ["Tabs: space, un, forums"]);
		assert.strictEqual(disposed, true);
	});

	it("keeps the panel open and shows the scaffolder's refusal when creating fails", async () => {
		stubCommand();
		fakeExecFile([{ stdout: catalog }, { code: "ENOENT" }, { code: "1", stderr: "ERROR: tab exists" }]);
		await addInternationalSystem();

		await handler!({ type: "create", form });

		assert.strictEqual(runs.length, 3);
		assert.ok(errors[0]!.includes("ERROR: tab exists"), errors[0]);
		assert.strictEqual(disposed, false);
	});

	it("reports a scaffolder that cannot list its icons", async () => {
		stubCommand();
		fakeExecFile([{ code: "1", stderr: "ERROR: old scaffolder" }]);

		await addInternationalSystem();

		assert.ok(errors[0]!.includes("ERROR: old scaffolder"), errors[0]);
		assert.strictEqual(handler, undefined);
	});

	it("asks for the Millennium Dawn repository when no folder has the scaffolder", async () => {
		stubCommand();
		stubVscode({
			stat: async () => {
				throw new Error("missing");
			},
		});
		fakeExecFile([]);

		await addInternationalSystem();

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
