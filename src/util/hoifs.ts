import { trimStart } from 'lodash';
import * as vscode from 'vscode';
import { Commands, ConfigurationKey, Hoi4FsSchema } from '../constants';
import { forceError } from './common';
import { clearDlcZipCache } from './fileloader';
import { checkInstallPath, clearInstallPathCache, getInstallPathUri, setInstallPathUri } from './installpath';
import { sendEvent } from './telemetry';
import { getConfiguration, isFileScheme } from './vsccommon';

export function registerHoiFs(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    disposables.push(vscode.commands.registerCommand(Commands.SelectHoiFolder, selectHoiFolder));
    try {
        disposables.push(vscode.workspace.registerFileSystemProvider(Hoi4FsSchema, new Hoi4UtilsFsProvider(), { isReadonly: true }));
    } catch (e) {
        if (!forceError(e).message.includes(`scheme '${Hoi4FsSchema}' is already registered`)) {
            throw e;
        }
    }

    if (!IS_WEB_EXT) {
        disposables.push(vscode.workspace.onDidChangeConfiguration(onChangeWorkspaceConfiguration));
        void checkInstallPath();
    }

    return vscode.Disposable.from(...disposables);
}

async function selectHoiFolder(): Promise<void> {
    sendEvent('selectHoiFolder');

    const dialogOptions: vscode.OpenDialogOptions = { canSelectFolders: true, canSelectFiles: false, canSelectMany: false };
    // TODO proposed API
    // dialogOptions.allowUIResources = true;
    const result = await vscode.window.showOpenDialog(dialogOptions);
    if (!result) {
        return;
    }

    const uri = result[0];
    setInstallPathUri(uri);
    void clearDlcZipCache();

    if (!IS_WEB_EXT && isFileScheme(uri)) {
        const conf = getConfiguration();
        conf.update('installPath', uri.fsPath, vscode.ConfigurationTarget.Global);
    }
}

function onChangeWorkspaceConfiguration(e: vscode.ConfigurationChangeEvent): void {
    if (e.affectsConfiguration(`${ConfigurationKey}.installPath`)) {
        clearInstallPathCache();
        void clearDlcZipCache();
        void checkInstallPath();
    }
}

class Hoi4UtilsFsProvider implements vscode.FileSystemProvider {
    private onDidChangeFileEventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.onDidChangeFileEventEmitter.event;

    watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // TODO empty implementation
        return { dispose: () => {} };
    }

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        return vscode.workspace.fs.stat(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')));
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        return vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')));
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        return vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')));
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        return vscode.workspace.fs.readFile(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')));
    }
    
    writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
        return vscode.workspace.fs.writeFile(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')), content);
    }

    delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
        return vscode.workspace.fs.delete(vscode.Uri.joinPath(getInstallPathUri(), trimStart(uri.path, '/')), options);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
        return vscode.workspace.fs.rename(
            vscode.Uri.joinPath(getInstallPathUri(), trimStart(oldUri.path, '/')),
            vscode.Uri.joinPath(getInstallPathUri(), trimStart(newUri.path, '/')),
            options);
    }

    copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
        return vscode.workspace.fs.copy(
            vscode.Uri.joinPath(getInstallPathUri(), trimStart(source.path, '/')),
            vscode.Uri.joinPath(getInstallPathUri(), trimStart(destination.path, '/')),
            options);
    }
}
