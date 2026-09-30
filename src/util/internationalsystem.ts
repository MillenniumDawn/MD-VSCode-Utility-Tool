import * as vscode from "vscode";
import { Commands } from "../constants";
import { error } from "./debug";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";

/**
 * Adds a tab to Millennium Dawn's International Systems screen by running the mod's own
 * scaffolder, tools/generators/add_international_system.py. The Python tool owns every edit;
 * this command only asks for its arguments and opens what it wrote.
 */
export const scaffolderPath = "tools/generators/add_international_system.py";
export const tabStripPath = "interface/MD_countrymissilesview.gui";

// Required only off the web build, where DefinePlugin drops the branch, as fileloader.ts does for fs.
let childProcess: typeof import("child_process") | null = null;
if (!IS_WEB_EXT) {
	childProcess = require("child_process") as typeof import("child_process");
}

const keyPattern = /^[a-z][a-z0-9_]*$/;
const tabPattern = /name\s*=\s*"(\w+)_gui_ledger_button"/g;

export function listTabs(gui: string): string[] {
	return [...gui.matchAll(tabPattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

export function validateKey(key: string, tabs: string[]): string | undefined {
	if (!keyPattern.test(key)) {
		return localize("internationalsystem.key.invalid", "Use lower_snake_case, for example forums.");
	}
	if (tabs.includes(key)) {
		return localize("internationalsystem.key.taken", "The {0} tab already exists.", key);
	}
	return undefined;
}

export function scaffolderArgs(key: string, name: string, description: string, after: string): string[] {
	return [scaffolderPath, key, name, "--description", description, "--after", after];
}

/** The files the scaffolder created, from its "  wrote <path>" lines, new files only. */
export function createdFiles(output: string, key: string): string[] {
	return output
		.split(/\r?\n/)
		.map((line) => /^\s+wrote (.+)$/.exec(line)?.[1]?.trim())
		.filter((file): file is string => file !== undefined && file.includes(`international_${key}`));
}

function pythonCandidates(): string[] {
	return process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
}

async function runScaffolder(execFile: typeof import("child_process").execFile, root: string, args: string[]): Promise<string> {
	let lastError: unknown;
	for (const python of pythonCandidates()) {
		try {
			return await new Promise<string>((resolve, reject) => {
				execFile(python, args, { cwd: root }, (failure, stdout, stderr) => {
					if (failure) {
						reject(Object.assign(failure, { stderr: stderr.trim() }));
					} else {
						resolve(stdout);
					}
				});
			});
		} catch (e) {
			lastError = e;
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
				break;
			}
		}
	}
	throw lastError;
}

async function findModRoot(): Promise<vscode.Uri | undefined> {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, scaffolderPath));
			return folder.uri;
		} catch {
			// Not the Millennium Dawn checkout; try the next folder.
		}
	}
	return undefined;
}

export async function addInternationalSystem(): Promise<void> {
	sendEvent("addInternationalSystem");
	const processes = childProcess;
	if (processes === null) {
		void vscode.window.showErrorMessage(
			localize("internationalsystem.web", "Adding an International Systems tab needs desktop VS Code, because it runs the mod's Python tool."),
		);
		return;
	}
	const root = await findModRoot();
	if (root === undefined) {
		void vscode.window.showErrorMessage(
			localize("internationalsystem.norepo", "Open the Millennium Dawn repository first: no workspace folder has {0}.", scaffolderPath),
		);
		return;
	}

	const gui = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, tabStripPath));
	const tabs = listTabs(Buffer.from(gui).toString("utf8"));
	const key = await vscode.window.showInputBox({
		title: localize("internationalsystem.title", "Add International Systems tab"),
		prompt: localize("internationalsystem.key.prompt", "Tab key. It names the tab's variables, files and loc keys."),
		placeHolder: "forums",
		validateInput: (value) => validateKey(value, tabs),
	});
	if (key === undefined) {
		return;
	}
	const name = await vscode.window.showInputBox({
		title: localize("internationalsystem.title", "Add International Systems tab"),
		prompt: localize("internationalsystem.name.prompt", "Tab name, shown in its tooltip."),
		placeHolder: "Economic Forums",
		validateInput: (value) => (value.trim() === "" ? localize("internationalsystem.required", "Required.") : undefined),
	});
	if (name === undefined) {
		return;
	}
	const description = await vscode.window.showInputBox({
		title: localize("internationalsystem.title", "Add International Systems tab"),
		prompt: localize("internationalsystem.description.prompt", "One sentence for the tab's longer tooltip."),
		validateInput: (value) => (value.trim() === "" ? localize("internationalsystem.required", "Required.") : undefined),
	});
	if (description === undefined) {
		return;
	}
	const after = await vscode.window.showQuickPick(tabs.slice().reverse(), {
		title: localize("internationalsystem.title", "Add International Systems tab"),
		placeHolder: localize("internationalsystem.after.prompt", "Place the new tab after"),
	});
	if (after === undefined) {
		return;
	}

	try {
		const output = await runScaffolder(processes.execFile, root.fsPath, scaffolderArgs(key, name.trim(), description.trim(), after));
		for (const file of createdFiles(output, key)) {
			await vscode.window.showTextDocument(vscode.Uri.joinPath(root, file), { preview: false });
		}
		void vscode.window.showInformationMessage(output.trim().split(/\r?\n/)[0] ?? "");
	} catch (e) {
		error(e);
		const stderr = (e as { stderr?: string }).stderr;
		void vscode.window.showErrorMessage(
			localize("internationalsystem.failed", "Adding the tab failed: {0}", stderr || (e instanceof Error ? e.message : `${e}`)),
		);
	}
}

export function registerAddInternationalSystemCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(Commands.AddInternationalSystem, addInternationalSystem);
}
