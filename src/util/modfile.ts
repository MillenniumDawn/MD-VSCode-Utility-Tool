import * as vscode from "vscode";
import * as path from "path";
import { ConfigurationKey, Commands } from "../constants";
import { PromiseCache } from "./cache";
import { localize } from "./i18n";
import {
	clearParentModCache,
	getParentModUris,
	getUnresolvedDependencies,
	onDidChangeParentMods,
} from "./parentmods";
import {
	basename,
	fileOrUriStringToUri,
	getConfiguration,
	uriToFilePathWhenPossible,
	isFile,
	readDir,
} from "./vsccommon";

export const modFileStatusContainer: { current: vscode.StatusBarItem | null } =
	{
		current: null,
	};

export const workspaceModFilesCache = new PromiseCache({
	factory: getWorkspaceModFiles,
	life: 10 * 1000,
});

// What the item last showed, so a redraw for a reason unrelated to the mod file -- the parent list
// changed -- keeps the error marker rather than resetting it to "fine" until the next real check.
let lastStatus: { modFile: vscode.Uri | undefined; error: boolean } = {
	modFile: undefined,
	error: false,
};

export function registerModFile(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	disposables.push(
		vscode.commands.registerCommand(Commands.SelectModFile, selectModFile),
	);
	disposables.push(
		(modFileStatusContainer.current = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			50,
		)),
	);
	disposables.push(
		vscode.workspace.onDidChangeConfiguration(onChangeWorkspaceConfiguration),
	);
	disposables.push(onDidChangeParentMods(redrawSelectedModFileStatus));
	disposables.push(
		new vscode.Disposable(() => {
			modFileStatusContainer.current = null;
		}),
	);

	// Initial status bar
	void checkAndUpdateModFileStatus(
		fileOrUriStringToUri(getConfiguration().modFile),
	);
	return vscode.Disposable.from(...disposables);
}

export function updateSelectedModFileStatus(
	modFile: vscode.Uri | undefined,
	error: boolean = false,
): void {
	lastStatus = { modFile, error };
	if (modFileStatusContainer.current) {
		const modName = modFileStatusContainer.current;
		const parents = getParentModUris();
		// The parent mods ride along on this item rather than getting one of their own: they are
		// part of what "the working mod" resolves to, and a second item costs status bar space.
		const parentSuffix = parents.length > 0 ? ` +${parents.length}` : "";
		const parentTooltip =
			parents
				.map(
					(parent) =>
						"\n" +
						localize("modfile.extends", "Extends: {0}", uriToFilePathWhenPossible(parent)),
				)
				.join("") +
			getUnresolvedDependencies()
				.map(
					(name) =>
						"\n" +
						localize(
							"modfile.unresolveddependency",
							"Unresolved dependency: {0}",
							name,
						),
				)
				.join("");
		if (modFile) {
			const modFileName = basename(modFile, ".mod");
			modName.command = Commands.SelectModFile;
			modName.text =
				(error ? "$(error) " : "$(file-code) ") + modFileName + parentSuffix;
			modName.tooltip =
				(error
					? localize("modfile.errorreading", "Error reading this file: ")
					: "") +
				uriToFilePathWhenPossible(modFile) +
				parentTooltip;
			modName.show();
		} else {
			modName.command = Commands.SelectModFile;
			modName.text =
				"$(file-code) " +
				localize("modfile.nomodfile", "(No mod descriptor)") +
				parentSuffix;
			modName.tooltip =
				localize("modfile.clicktoselect", "Click to select a mod file...") +
				parentTooltip;
			modName.show();
		}
	}
}

/** Redraws the item with the mod file and error state it last showed. */
export function redrawSelectedModFileStatus(): void {
	updateSelectedModFileStatus(lastStatus.modFile, lastStatus.error);
}

function onChangeWorkspaceConfiguration(
	e: vscode.ConfigurationChangeEvent,
): void {
	if (e.affectsConfiguration(`${ConfigurationKey}.modFile`)) {
		void checkAndUpdateModFileStatus(
			fileOrUriStringToUri(getConfiguration().modFile),
		);
	} else if (e.affectsConfiguration(`${ConfigurationKey}.parentModPaths`)) {
		// This listener is registered ahead of the one in hoifs.ts that owns the cache, so drop
		// it here too or the item redraws with the old list. The resolved dependencies redraw
		// through onDidChangeParentMods once hoifs.ts has re-resolved them.
		clearParentModCache();
		redrawSelectedModFileStatus();
	}
}

async function checkAndUpdateModFileStatus(
	modFile: vscode.Uri | undefined,
): Promise<void> {
	if (modFile === undefined) {
		updateSelectedModFileStatus(undefined);
		return;
	}

	const error = !(await isFile(modFile));

	updateSelectedModFileStatus(modFile, error);
	if (error) {
		void vscode.window.showErrorMessage(
			localize("modfile.filenotexist", "Mod file not exist: {0}", modFile),
		);
	}
}

async function selectModFile(): Promise<void> {
	const conf = getConfiguration();
	const modFileInspect = conf.inspect<string>("modFile");
	const modsList: (vscode.QuickPickItem & { selectModFile?: true })[] =
		!modFileInspect?.globalValue
			? []
			: [
					{
						label: path.basename(modFileInspect.globalValue, ".mod"),
						description: localize("modfile.globalsetting", "Global setting"),
						detail: modFileInspect.globalValue,
					},
				];

	let selected = conf.modFile.trim();

	workspaceModFilesCache.clear();
	if (vscode.workspace.workspaceFolders) {
		for (const workspaceFolder of vscode.workspace.workspaceFolders) {
			const workspaceFolderPath = workspaceFolder.uri;
			const mods = await workspaceModFilesCache.get(
				workspaceFolderPath.toString(),
			);
			const firstMod = mods[0];
			if (selected === "" && firstMod !== undefined) {
				selected = uriToFilePathWhenPossible(firstMod);
			}
			modsList.push(
				...mods.map((mod) => ({
					label: basename(mod, ".mod"),
					description: localize(
						"modfile.infolder",
						"In folder {0}",
						basename(workspaceFolderPath),
					),
					detail: uriToFilePathWhenPossible(mod),
				})),
			);
		}
	}

	modsList.forEach((r) =>
		r.detail === selected ? (r.picked = true) : undefined,
	);
	if (modsList.every((r) => !r.picked) && selected !== "") {
		modsList.push({
			label: path.basename(selected, ".mod"),
			description: localize("modfile.workspacesetting", "Workspace setting"),
			detail: selected,
			picked: true,
		});
	}

	modsList.sort((a, b) => (a.picked ? -1 : b.picked ? 1 : 0));

	modsList.push({
		label: localize("modfile.select", "Browse a .mod file..."),
		selectModFile: true,
	});

	const selectResult = await vscode.window.showQuickPick(modsList, {
		placeHolder: localize("modfile.selectworkingmod", "Select working mod"),
	});

	if (selectResult) {
		let modPath = selectResult.detail;
		if (selectResult.selectModFile) {
			const result = await vscode.window.showOpenDialog({
				filters: { [localize("modfile.type", "Mod file")]: ["mod"] },
			});
			const selectedMod = result?.[0];
			if (selectedMod !== undefined) {
				modPath = uriToFilePathWhenPossible(selectedMod);
			} else {
				return;
			}
		}

		if (modPath === modFileInspect?.globalValue) {
			await conf.update("modFile", undefined, vscode.ConfigurationTarget.Workspace);
		} else {
			await conf.update("modFile", modPath, vscode.ConfigurationTarget.Workspace);
		}

		void checkAndUpdateModFileStatus(
			modPath ? fileOrUriStringToUri(modPath) : undefined,
		);
	}
}

/**
 * The `.mod` file the extension works from: the `modFile` setting when set, else the first `.mod`
 * in the first workspace folder that has one. Undefined when there is neither; the file is not
 * checked to exist here.
 */
export async function getSelectedModFileUri(): Promise<vscode.Uri | undefined> {
	const conf = getConfiguration();
	if (conf.modFile !== "") {
		return fileOrUriStringToUri(conf.modFile);
	}

	if (vscode.workspace.workspaceFolders) {
		for (const workspaceFolder of vscode.workspace.workspaceFolders) {
			const mods = await workspaceModFilesCache.get(
				workspaceFolder.uri.toString(),
			);
			if (mods.length > 0) {
				return mods[0];
			}
		}
	}

	return undefined;
}

async function getWorkspaceModFiles(uriString: string): Promise<vscode.Uri[]> {
	const uri = vscode.Uri.parse(uriString);
	const items = await readDir(uri);
	return items
		.filter((i) => i.endsWith(".mod"))
		.map((i) => vscode.Uri.joinPath(uri, i));
}
