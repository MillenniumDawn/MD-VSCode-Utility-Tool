import { trimStart } from "lodash";
import * as vscode from "vscode";
import { Commands, ConfigurationKey, Hoi4FsSchema } from "../constants";
import { forceError } from "./common";
import { clearDlcZipCache } from "./fileloader";
import {
	checkInstallPath,
	clearInstallPathCache,
	getInstallPathUri,
	setInstallPathUri,
} from "./installpath";
import { refreshModDependencies } from "./moddependencies";
import { checkParentModPaths, clearParentModCache } from "./parentmods";
import { sendEvent } from "./telemetry";
import { getConfiguration, isFileScheme } from "./vsccommon";

export function registerHoiFs(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	disposables.push(
		vscode.commands.registerCommand(Commands.SelectHoiFolder, selectHoiFolder),
	);
	try {
		disposables.push(
			vscode.workspace.registerFileSystemProvider(
				Hoi4FsSchema,
				new Hoi4UtilsFsProvider(),
				{ isReadonly: true },
			),
		);
	} catch (e) {
		if (
			!forceError(e).message.includes(
				`scheme '${Hoi4FsSchema}' is already registered`,
			)
		) {
			throw e;
		}
	}

	if (!IS_WEB_EXT) {
		disposables.push(
			vscode.workspace.onDidChangeConfiguration(onChangeWorkspaceConfiguration),
		);
		void checkInstallPath();
	}

	disposables.push(
		vscode.workspace.onDidChangeConfiguration(onChangeParentModPaths),
	);
	disposables.push(
		vscode.workspace.onDidSaveTextDocument(onSaveTextDocument),
	);
	disposables.push(
		vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders),
	);
	void checkParentModPaths();
	void refreshModDependencies();

	return vscode.Disposable.from(...disposables);
}

async function selectHoiFolder(): Promise<void> {
	sendEvent("selectHoiFolder");

	const dialogOptions: vscode.OpenDialogOptions = {
		canSelectFolders: true,
		canSelectFiles: false,
		canSelectMany: false,
	};
	// TODO proposed API
	// dialogOptions.allowUIResources = true;
	const result = await vscode.window.showOpenDialog(dialogOptions);
	if (!result) {
		return;
	}

	const uri = result[0];
	if (uri === undefined) {
		return;
	}
	setInstallPathUri(uri);
	void clearDlcZipCache();

	if (!IS_WEB_EXT && isFileScheme(uri)) {
		const conf = getConfiguration();
		await conf.update("installPath", uri.fsPath, vscode.ConfigurationTarget.Global);
	}
}

function onChangeWorkspaceConfiguration(
	e: vscode.ConfigurationChangeEvent,
): void {
	if (e.affectsConfiguration(`${ConfigurationKey}.installPath`)) {
		clearInstallPathCache();
		void clearDlcZipCache();
		void checkInstallPath();
	}
}

// Every input to the parent list ends in one resolution of the `.mod` dependencies, which tells
// the indexes and the status bar once the list is final rather than once per input.
function onChangeParentModPaths(e: vscode.ConfigurationChangeEvent): void {
	if (e.affectsConfiguration(`${ConfigurationKey}.parentModPaths`)) {
		clearParentModCache();
		void clearDlcZipCache();
		void checkParentModPaths();
		void refreshModDependencies();
	} else if (
		e.affectsConfiguration(`${ConfigurationKey}.modFile`) ||
		e.affectsConfiguration(`${ConfigurationKey}.userDataPath`)
	) {
		void refreshModDependencies();
	}
}

// With `modFile` unset the selected `.mod` is the first one found in the workspace folders, so a
// folder added or removed can change which file the dependencies come from, and where the
// launcher's registry is looked for above it.
function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent): void {
	void refreshModDependencies();
}

// An edited `dependencies` block takes effect on save, not on the next reload.
function onSaveTextDocument(document: vscode.TextDocument): void {
	if (document.uri.path.endsWith(".mod")) {
		void refreshModDependencies();
	}
}

class Hoi4UtilsFsProvider implements vscode.FileSystemProvider {
	private onDidChangeFileEventEmitter = new vscode.EventEmitter<
		vscode.FileChangeEvent[]
	>();

	onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
		this.onDidChangeFileEventEmitter.event;

	watch(
		_uri: vscode.Uri,
		_options: { recursive: boolean; excludes: string[] },
	): vscode.Disposable {
		// TODO empty implementation
		return { dispose: () => {} };
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		return vscode.workspace.fs.stat(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
		);
	}

	readDirectory(
		uri: vscode.Uri,
	): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		return vscode.workspace.fs.readDirectory(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
		);
	}

	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		return vscode.workspace.fs.createDirectory(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
		);
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		return vscode.workspace.fs.readFile(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
		);
	}

	writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		_options: { create: boolean; overwrite: boolean },
	): void | Thenable<void> {
		return vscode.workspace.fs.writeFile(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
			content,
		);
	}

	delete(
		uri: vscode.Uri,
		options: { recursive: boolean },
	): void | Thenable<void> {
		return vscode.workspace.fs.delete(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, "/")),
			options,
		);
	}

	rename(
		oldUri: vscode.Uri,
		newUri: vscode.Uri,
		options: { overwrite: boolean },
	): void | Thenable<void> {
		return vscode.workspace.fs.rename(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(oldUri.path, "/")),
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(newUri.path, "/")),
			options,
		);
	}

	copy(
		source: vscode.Uri,
		destination: vscode.Uri,
		options: { overwrite: boolean },
	): void | Thenable<void> {
		return vscode.workspace.fs.copy(
			vscode.Uri.joinPath(getInstallPathUri(), trimStart(source.path, "/")),
			vscode.Uri.joinPath(
				getInstallPathUri(),
				trimStart(destination.path, "/"),
			),
			options,
		);
	}
}
