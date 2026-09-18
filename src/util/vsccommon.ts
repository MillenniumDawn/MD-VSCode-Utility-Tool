import * as vscode from 'vscode';
import * as path from 'path';
import { localize } from './i18n';
import { UserError, mapLimit } from './common';
import { isSamePath } from './nodecommon';
import { ConfigurationKey } from '../constants';
import { defaultYmlSuffix, ymlSuffixBySettingName } from './locales';
import { contextContainer } from '../context';

export function getConfiguration() {
    return vscode.workspace.getConfiguration(ConfigurationKey);
}

export function getDocumentByUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}

export function getRelativePathInWorkspace(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        return path.relative(folder.uri.path, uri.path).replace(/\\/g, '/');
    } else {
        ensureFileScheme(uri);
        return uri.fsPath;
    }
}

export function isFileScheme(uri: vscode.Uri) {
    return uri.scheme === 'file';
}

export function ensureFileScheme(uri: vscode.Uri) {
    if (!isFileScheme(uri)) {
        throw new UserError(localize('filenotondisk', 'File is not on disk: {0}.', uri.toString()));
    }
}

export function isSameUri(uriA: vscode.Uri, uriB: vscode.Uri) {
    return (isFileScheme(uriA) && isFileScheme(uriB) && isSamePath(uriA.fsPath, uriB.fsPath)) || uriA.toString() === uriB.toString();
}

export async function getLastModifiedAsync(path: vscode.Uri): Promise<number> {
    return (await vscode.workspace.fs.stat(path)).mtime;
}

export async function readDir(dir: vscode.Uri): Promise<string[]> {
    return (await vscode.workspace.fs.readDirectory(dir)).map(f => f[0]);
}

export async function readDirFiles(dir: vscode.Uri): Promise<string[]> {
    return (await vscode.workspace.fs.readDirectory(dir)).filter(f => f[1] === vscode.FileType.File).map(f => f[0]);
}

/**
 * Every directory listing is a round trip to the extension host (two for `hoi4installpath:`, whose
 * provider answers by asking `vscode.workspace.fs` again), so subdirectories are read several at a
 * time rather than each waiting on the whole subtree of the one listed before it. Results keep the
 * listing order a serial walk produced.
 */
const DIR_CONCURRENCY = 8;

export async function readDirFilesRecursively(dir: vscode.Uri): Promise<string[]> {
    return readDirFilesRecursivelyImpl(dir, '');
}

async function readDirFilesRecursivelyImpl(dir: vscode.Uri, prefix: string): Promise<string[]> {
    const items = await vscode.workspace.fs.readDirectory(dir);
    const nested = await mapLimit(items, DIR_CONCURRENCY, async ([name, type]) => {
        if (type === vscode.FileType.File) {
            return [prefix + name];
        } else if (type === vscode.FileType.Directory) {
            return readDirFilesRecursivelyImpl(vscode.Uri.joinPath(dir, name), prefix + name + '/');
        }
        return [];
    });
    const result: string[] = [];
    for (const files of nested) {
        for (const file of files) {
            result.push(file);
        }
    }
    return result;
}

export async function readFile(path: vscode.Uri): Promise<Buffer> {
    return Buffer.from(await vscode.workspace.fs.readFile(path));
}

export async function writeFile(path: vscode.Uri, buffer: Buffer): Promise<void> {
    return await vscode.workspace.fs.writeFile(path, buffer);
}

export async function mkdirs(path: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(path);
}

export async function isFile(path: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.File;
    } catch (e) {
        return false;
    }
}

export async function isDirectory(path: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(path)).type === vscode.FileType.Directory;
    } catch (e) {
        return false;
    }
}

export function dirUri(uri: vscode.Uri): vscode.Uri {
    const updatedPath = path.dirname(uri.path);
    return uri.with({ path: updatedPath });
}

export function basename(uri: vscode.Uri, ext?: string): string {
    return path.basename(uri.path, ext);
}

export function fileOrUriStringToUri(path: string | undefined): vscode.Uri | undefined {
    const normalizedPath = normalizeFileOrUriString(path);

    if (normalizedPath === '') {
        return undefined;
    }

    try {
        if (/^[a-zA-Z]:[\\/]/.test(normalizedPath) || /^\\\\/.test(normalizedPath)) {
            return vscode.Uri.file(normalizedPath);
        }

        if (normalizedPath.indexOf(':') > 2) { // try to avoid prefix like "D:\"
            return vscode.Uri.parse(normalizedPath);
        } else {
            return vscode.Uri.file(normalizedPath);
        }
    } catch (e) {
        return undefined;
    }
}

function normalizeFileOrUriString(path: string | undefined): string {
    const trimmedPath = (path ?? '').trim();
    if (trimmedPath.length >= 2) {
        const startsWithDoubleQuote = trimmedPath.startsWith('"') && trimmedPath.endsWith('"');
        const startsWithSingleQuote = trimmedPath.startsWith("'") && trimmedPath.endsWith("'");
        if (startsWithDoubleQuote || startsWithSingleQuote) {
            return trimmedPath.slice(1, -1).trim();
        }
    }

    return trimmedPath;
}

export function uriToFilePathWhenPossible(uri: vscode.Uri): string {
    if (isFileScheme(uri)) {
        return uri.fsPath;
    }

    return uri.toString();
}

export function getLanguageIdInYml(): string {
    // The table this used to carry was the composition of the two in localisationIndex.ts, kept in
    // step by hand. It lives in locales.ts now, with the rest.
    const setting = getConfiguration().previewLocalisation;
    return (setting !== undefined ? ymlSuffixBySettingName[setting] : undefined) ?? defaultYmlSuffix;
}

/**
 * Options for every preview webview. `localResourceRoots` is scoped to the extension's own
 * folder: left out, VS Code also allows every workspace folder, and the CSP lets the webview
 * load scripts and styles from any allowed root, so a mod could ship a script the preview would
 * run. Nothing the previews show comes from the workspace (images are data URIs), so the
 * extension folder is the whole list.
 */
export function previewWebviewOptions(): vscode.WebviewOptions {
    return {
        enableScripts: true,
        localResourceRoots: contextContainer.current ? [contextContainer.current.extensionUri] : [],
    };
}
