import * as vscode from "vscode";
import { Commands } from "../constants";
import { error } from "./debug";
import { htmlEscape } from "./escape";
import { html } from "./html";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { getConfiguration } from "./vsccommon";

/**
 * Adds a tab to Millennium Dawn's International Systems screen by running the mod's own
 * scaffolder, tools/generators/add_international_system.py. The Python tool owns every edit,
 * the premade icons and the strip preview; this panel only gathers its arguments, shows what it
 * draws, and opens what it wrote.
 */
export const scaffolderPath = "tools/generators/add_international_system.py";
export const tabStripPath = "interface/MD_countrymissilesview.gui";

// Required only off the web build, where DefinePlugin drops the branch, as fileloader.ts does for fs.
let nodeModules: {
	childProcess: typeof import("child_process");
	fs: typeof import("fs");
	os: typeof import("os");
	path: typeof import("path");
} | null = null;
if (!IS_WEB_EXT) {
	nodeModules = {
		childProcess: require("child_process") as typeof import("child_process"),
		fs: require("fs") as typeof import("fs"),
		os: require("os") as typeof import("os"),
		path: require("path") as typeof import("path"),
	};
}

const keyPattern = /^[a-z][a-z0-9_]*$/;
const tabPattern = /name\s*=\s*"(\w+)_gui_ledger_button"/g;

export interface TabForm {
	key: string;
	name: string;
	description: string;
	title: string;
	after: string;
	icon: string;
}

export interface PremadeIcon {
	name: string;
	png: string;
}

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

/** What stops the form from being run, or undefined when it is ready. */
export function formProblem(form: TabForm, tabs: string[]): string | undefined {
	if (form.name.trim() === "" || form.description.trim() === "") {
		return localize("internationalsystem.required", "Enter a name and a description.");
	}
	return validateKey(form.key, tabs);
}

export function scaffolderArgs(form: TabForm, preview?: string): string[] {
	const args = [scaffolderPath, form.key, form.name.trim(), "--description", form.description.trim(), "--after", form.after];
	if (form.title.trim() !== "") {
		args.push("--title", form.title.trim());
	}
	if (form.icon !== "") {
		args.push("--icon", form.icon);
	}
	if (preview !== undefined) {
		args.push("--preview", preview);
	}
	return args;
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
				execFile(python, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (failure, stdout, stderr) => {
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

function failureText(e: unknown): string {
	const stderr = (e as { stderr?: string }).stderr;
	return stderr || (e instanceof Error ? e.message : `${e}`);
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

export function panelBody(tabs: string[], icons: PremadeIcon[]): string {
	const options = tabs
		.map((tab, index) => `<option value="${htmlEscape(tab)}"${index === tabs.length - 1 ? " selected" : ""}>${htmlEscape(tab)}</option>`)
		.join("");
	const tiles = icons
		.map(
			(icon) =>
				`<button class="icon" data-icon="${htmlEscape(icon.name)}" title="${htmlEscape(icon.name)}">` +
				`<img src="data:image/png;base64,${icon.png}" alt="${htmlEscape(icon.name)}"></button>`,
		)
		.join("");
	const field = (id: string, label: string, input: string) => `<label for="${id}">${htmlEscape(label)}</label>${input}`;
	return `
<h2>${htmlEscape(localize("internationalsystem.title", "Add International Systems tab"))}</h2>
<div class="form">
	${field("key", localize("internationalsystem.key.label", "Key"), '<input id="key" placeholder="forums">')}
	${field("name", localize("internationalsystem.name.label", "Name"), '<input id="name" placeholder="Economic Forums">')}
	${field("description", localize("internationalsystem.description.label", "Tooltip"), '<input id="description">')}
	${field("title", localize("internationalsystem.header.label", "Header (optional)"), '<input id="title">')}
	${field("after", localize("internationalsystem.after.label", "After tab"), `<select id="after">${options}</select>`)}
</div>
<h3>${htmlEscape(localize("internationalsystem.icon.label", "Icon"))}</h3>
<div class="icons">${tiles}</div>
<p><button id="pick">${htmlEscape(localize("internationalsystem.icon.pick", "Use an image file..."))}</button> <span id="picked"></span></p>
<h3>${htmlEscape(localize("internationalsystem.preview.label", "Preview"))}</h3>
<img id="preview" alt=""><p id="message"></p>
<p><button id="create" disabled>${htmlEscape(localize("internationalsystem.create", "Add tab"))}</button></p>`;
}

const panelStyle = `
body { padding: 12px; }
.form { display: grid; grid-template-columns: max-content 320px; gap: 6px 10px; align-items: center; }
.icons { display: flex; flex-wrap: wrap; gap: 4px; }
.icon { background: #262626; border: 2px solid transparent; padding: 2px; cursor: pointer; }
.icon.selected { border-color: var(--vscode-focusBorder); }
.icon img, #preview { image-rendering: pixelated; }
.icon img { width: 56px; height: 54px; }
#preview { width: 1100px; max-width: 100%; }
#message { color: var(--vscode-errorForeground); white-space: pre-wrap; }`;

const panelScript = `
const vscode = acquireVsCodeApi();
const byId = (id) => document.getElementById(id);
let icon = "";
let timer;
function form() {
	return { key: byId("key").value.trim(), name: byId("name").value, description: byId("description").value,
		title: byId("title").value, after: byId("after").value, icon };
}
function requestPreview() {
	clearTimeout(timer);
	timer = setTimeout(() => vscode.postMessage({ type: "preview", form: form() }), 400);
}
for (const id of ["key", "name", "description", "title", "after"]) {
	byId(id).addEventListener("input", requestPreview);
}
for (const tile of document.querySelectorAll(".icon")) {
	tile.addEventListener("click", () => {
		document.querySelectorAll(".icon").forEach((other) => other.classList.remove("selected"));
		tile.classList.add("selected");
		icon = tile.dataset.icon;
		byId("picked").textContent = "";
		requestPreview();
	});
}
byId("pick").addEventListener("click", () => vscode.postMessage({ type: "pickImage" }));
byId("create").addEventListener("click", () => vscode.postMessage({ type: "create", form: form() }));
window.addEventListener("message", (event) => {
	const message = event.data;
	if (message.type === "picked") {
		document.querySelectorAll(".icon").forEach((other) => other.classList.remove("selected"));
		icon = message.path;
		byId("picked").textContent = message.label;
		requestPreview();
	} else if (message.type === "preview") {
		byId("preview").src = message.png ? "data:image/png;base64," + message.png : "";
		byId("message").textContent = message.problem || "";
		byId("create").disabled = !message.png;
	}
});`;

export class InternationalSystemPanel {
	private previewCounter = 0;

	constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly root: vscode.Uri,
		private readonly tabs: string[],
		private readonly processes: NonNullable<typeof nodeModules>,
	) {}

	async onMessage(message: { type: string; form?: TabForm }): Promise<void> {
		if (message.type === "pickImage") {
			const picked = await vscode.window.showOpenDialog({
				canSelectMany: false,
				filters: { [localize("internationalsystem.icon.images", "Images")]: ["png", "dds", "jpg", "jpeg", "tga", "bmp"] },
			});
			const file = picked?.[0];
			if (file !== undefined) {
				await this.panel.webview.postMessage({ type: "picked", path: file.fsPath, label: file.fsPath });
			}
		} else if (message.type === "preview" && message.form !== undefined) {
			await this.preview(message.form);
		} else if (message.type === "create" && message.form !== undefined) {
			await this.create(message.form);
		}
	}

	private async preview(form: TabForm): Promise<void> {
		const problem = formProblem(form, this.tabs);
		if (problem !== undefined) {
			await this.panel.webview.postMessage({ type: "preview", problem });
			return;
		}
		this.previewCounter += 1;
		const { fs, os, path } = this.processes;
		const target = path.join(os.tmpdir(), `md-international-system-${process.pid}-${this.previewCounter}.png`);
		try {
			await runScaffolder(this.processes.childProcess.execFile, this.root.fsPath, scaffolderArgs(form, target));
			const png = (await fs.promises.readFile(target)).toString("base64");
			await fs.promises.unlink(target);
			await this.panel.webview.postMessage({ type: "preview", png });
		} catch (e) {
			await this.panel.webview.postMessage({ type: "preview", problem: failureText(e) });
		}
	}

	private async create(form: TabForm): Promise<void> {
		try {
			const output = await runScaffolder(this.processes.childProcess.execFile, this.root.fsPath, scaffolderArgs(form));
			for (const file of createdFiles(output, form.key)) {
				await vscode.window.showTextDocument(vscode.Uri.joinPath(this.root, file), { preview: false });
			}
			void vscode.window.showInformationMessage(output.trim().split(/\r?\n/)[0] ?? "");
			this.panel.dispose();
		} catch (e) {
			error(e);
			void vscode.window.showErrorMessage(localize("internationalsystem.failed", "Adding the tab failed: {0}", failureText(e)));
		}
	}
}

export async function addInternationalSystem(): Promise<void> {
	sendEvent("addInternationalSystem");
	if (!getConfiguration().millenniumDawnInternationalSystems) {
		void vscode.window.showInformationMessage(
			localize("internationalsystem.disabled", "Turn on the Millennium Dawn: International Systems Tabs setting to add International Systems tabs."),
		);
		return;
	}
	const processes = nodeModules;
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

	let icons: PremadeIcon[];
	try {
		icons = JSON.parse(await runScaffolder(processes.childProcess.execFile, root.fsPath, [scaffolderPath, "--list-icons"])) as PremadeIcon[];
	} catch (e) {
		error(e);
		void vscode.window.showErrorMessage(localize("internationalsystem.failed", "Adding the tab failed: {0}", failureText(e)));
		return;
	}
	const gui = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, tabStripPath));
	const tabs = listTabs(Buffer.from(gui).toString("utf8"));
	const panel = vscode.window.createWebviewPanel(
		"mdinternationalsystem",
		localize("internationalsystem.title", "Add International Systems tab"),
		vscode.ViewColumn.Active,
		{ enableScripts: true },
	);
	panel.webview.html = html(panel.webview, panelBody(tabs, icons), [{ content: panelScript }], [{ content: panelStyle }]);
	const controller = new InternationalSystemPanel(panel, root, tabs, processes);
	panel.webview.onDidReceiveMessage((message) => controller.onMessage(message));
}

export function registerAddInternationalSystemCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(Commands.AddInternationalSystem, addInternationalSystem);
}
