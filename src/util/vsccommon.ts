import type * as vscode from 'vscode';
import * as path from 'path';
import { host } from './host';
import { localize } from './i18n';
import { UserError, mapLimit } from './common';
import { pathIdentity } from './nodecommon';
import { ConfigurationKey } from '../constants';
import { defaultYmlSuffix, ymlSuffixBySettingName } from './locales';
import { contextContainer } from '../context';

export function getConfiguration() {
    return host().workspace.getConfiguration(ConfigurationKey);
}

export function getDocumentByUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    return host().workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
}

export function getRelativePathInWorkspace(uri: vscode.Uri): string {
    const folder = host().workspace.getWorkspaceFolder(uri);
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
    return (isFileScheme(uriA) && isFileScheme(uriB) && filePathIdentity(uriA.fsPath) === filePathIdentity(uriB.fsPath)) || uriA.toString() === uriB.toString();
}

// Off Windows a backslash is part of a file name, so only Windows paths fold slashes and case.
export function filePathIdentity(fsPath: string): string {
    const resolved = path.resolve(fsPath);
    return process.platform === 'win32' ? pathIdentity(resolved) : resolved;
}

export async function getLastModifiedAsync(path: vscode.Uri): Promise<number> {
    return (await host().workspace.fs.stat(path)).mtime;
}

export async function readDir(dir: vscode.Uri): Promise<string[]> {
    return (await host().workspace.fs.readDirectory(dir)).map(f => f[0]);
}

export async function readDirFiles(dir: vscode.Uri): Promise<string[]> {
    // FileType is a bitfield: a link to a file comes back File|SymbolicLink, so a file is anything
    // carrying the File bit, not one whose type is exactly File.
    return (await host().workspace.fs.readDirectory(dir)).filter(f => (f[1] & host().FileType.File) !== 0).map(f => f[0]);
}

/**
 * Every directory listing is a round trip to the extension host (two for `hoi4installpath:`, whose
 * provider answers by asking `vscode.workspace.fs` again), so subdirectories are read several at a
 * time rather than each waiting on the whole subtree of the one listed before it. Results keep the
 * listing order a serial walk produced.
 */
const DIR_CONCURRENCY = 8;

// The native walk stops at the same depth. A link whose target lists that link again grows a new
// path on every descent, and workspace.fs has no realpath with which to see that it is the same folder.
const MAX_WALK_DEPTH = 32;

export async function readDirFilesRecursively(dir: vscode.Uri): Promise<string[]> {
    // A directory is walked when it is descended into, so the walk starts at the root before
    // anything lists anything: a link back to the root is already seen by the time it is reached.
    return readDirFilesRecursivelyImpl(dir, '', directoryIdentity(dir), new Set([directoryIdentity(dir)]), 0);
}

async function readDirFilesRecursivelyImpl(
    dir: vscode.Uri,
    prefix: string,
    walkRoot: string,
    visitedDirectories: Set<string>,
    depth: number,
): Promise<string[]> {
    const items = await host().workspace.fs.readDirectory(dir);
    const nested = await mapLimit(items, DIR_CONCURRENCY, async ([name, type]) => {
        // FileType is a bitfield: a link comes back with the SymbolicLink bit on top of the type of
        // what it points at, so a file carries the File bit and a directory the Directory bit. A
        // bare SymbolicLink has neither and stays out, as before.
        if ((type & host().FileType.File) !== 0) {
            return [prefix + name];
        } else if ((type & host().FileType.Directory) !== 0) {
            const child = host().Uri.joinPath(dir, name);
            const childIdentity = directoryIdentity(child);
            // Only a link can point outside the walk root or back into the tree already walked; an
            // entry of a plain listing is always inside its own directory. workspace.fs has no
            // realpath to see a link's target through, so the identity of the path the walk
            // descends through is what the visited set holds. The check and the mark both run
            // before the listing below awaits, so concurrent siblings cannot both walk a path.
            const linked = (type & host().FileType.SymbolicLink) !== 0;
            const seenLinkName = linked && prefix.split('/').includes(name);
            if (
                depth >= MAX_WALK_DEPTH ||
                seenLinkName ||
                !childIdentity.startsWith(walkRoot + '/') ||
                visitedDirectories.has(childIdentity)
            ) {
                return [];
            }
            visitedDirectories.add(childIdentity);
            return readDirFilesRecursivelyImpl(child, prefix + name + '/', walkRoot, visitedDirectories, depth + 1);
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

/**
 * The string on which the walk tells directories apart: the URI path with any `.` and `..` segments
 * collapsed to the folder they resolve to, under the scheme it was reached through. workspace.fs can
 * hand the walk no realpath for a link's target, so the path it descends through is the only
 * identity there is, and an entry that names its way back -- even `..`-by-`..` -- must meet the one
 * the visited set already holds. Collapsing here, rather than trusting `Uri.joinPath` to have, keeps
 * that true whatever the editor's own joining does.
 */
function directoryIdentity(uri: vscode.Uri): string {
    const segments: string[] = [];
    for (const segment of uri.path.split('/')) {
        if (segment === '..') {
            segments.pop();
        } else if (segment !== '.' && segment !== '') {
            segments.push(segment);
        }
    }
    return uri.scheme + '://' + segments.join('/');
}

export async function readFile(path: vscode.Uri): Promise<Buffer> {
    return Buffer.from(await host().workspace.fs.readFile(path));
}

export async function writeFile(path: vscode.Uri, buffer: Buffer): Promise<void> {
    return await host().workspace.fs.writeFile(path, buffer);
}

export async function mkdirs(path: vscode.Uri): Promise<void> {
    await host().workspace.fs.createDirectory(path);
}

export async function isFile(path: vscode.Uri): Promise<boolean> {
    try {
        return ((await host().workspace.fs.stat(path)).type & host().FileType.File) !== 0;
    } catch (e) {
        return false;
    }
}

export async function isDirectory(path: vscode.Uri): Promise<boolean> {
    try {
        return ((await host().workspace.fs.stat(path)).type & host().FileType.Directory) !== 0;
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
            return host().Uri.file(normalizedPath);
        }

        if (normalizedPath.indexOf(':') > 2) { // try to avoid prefix like "D:\"
            return host().Uri.parse(normalizedPath);
        } else {
            return host().Uri.file(normalizedPath);
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
