import * as vscode from 'vscode';
import * as path from 'path';
import { PromiseCache } from './cache';
import { isSamePath } from './nodecommon';
import { getLastModifiedAsync, readDirFiles, isFile, isDirectory, readFile, readDir, isSameUri, fileOrUriStringToUri, ensureFileScheme, readDirFilesRecursively, getConfiguration, getDocumentByUri } from './vsccommon';
import { parseHoi4File, resolveScriptVariables, Node, ParseOptions } from '../hoiformat/hoiparser';
import { localize } from './i18n';
import { convertNodeToJson, SchemaDef, HOIPartial } from '../hoiformat/schema';
import { error } from './debug';
import { updateSelectedModFileStatus, workspaceModFilesCache } from './modfile';
import { UserError, memoizeWithTtl } from './common';
import type * as AdmZip from 'adm-zip';
import { Hoi4FsSchema } from '../constants';
import { trimStart } from 'lodash';

const dlcZipPathsCache = new PromiseCache({
    factory: getDlcZipPaths,
    life: 10 * 60 * 1000,
});

const dlcPathsCache = new PromiseCache({
    factory: getDlcPaths,
    life: 10 * 60 * 1000,
});

// Cached DLC zip with two lazily built indexes (one getEntries pass): entryName -> entry and
// directory -> file basenames. Lives on the cached instance, so mtime expiry rebuilds it for free.
export class DlcZip {
    private nameIndex?: Map<string, AdmZip.IZipEntry>;
    private dirIndex?: Map<string, string[]>;

    constructor(private readonly zip: AdmZip) {}

    getEntry(name: string): AdmZip.IZipEntry | null {
        this.ensureIndex();
        return this.nameIndex!.get(name) ?? null;
    }

    // Basenames of the non-directory entries directly under relativePath, matched the same way the
    // old getEntries loop did: leading slash/backslash stripped, path.resolve + lowercase compare.
    listDir(relativePath: string): string[] {
        this.ensureIndex();
        return this.dirIndex!.get(path.resolve(relativePath).toLowerCase()) ?? [];
    }

    private ensureIndex(): void {
        if (this.nameIndex !== undefined) {
            return;
        }
        const nameIndex = new Map<string, AdmZip.IZipEntry>();
        const dirIndex = new Map<string, string[]>();
        for (const entry of this.zip.getEntries()) {
            nameIndex.set(entry.entryName, entry);
            if (!entry.isDirectory) {
                const dir = path.resolve(path.dirname(entry.entryName.replace(/^[\\/]/, ''))).toLowerCase();
                const basenames = dirIndex.get(dir);
                if (basenames) {
                    basenames.push(path.basename(entry.name));
                } else {
                    dirIndex.set(dir, [path.basename(entry.name)]);
                }
            }
        }
        this.nameIndex = nameIndex;
        this.dirIndex = dirIndex;
    }
}

let dlcZipCache: PromiseCache<DlcZip> | null = null;

if (!IS_WEB_EXT) {
    // adm-zip requires fs, which doesn't work on web.
    function getDlcZip(dlcZipPath: string): Promise<DlcZip> {
        const uri = vscode.Uri.parse(dlcZipPath);
        if (uri.scheme === Hoi4FsSchema) {
            dlcZipPath = path.join(getConfiguration().installPath, trimStart(uri.path, '/'));
        } else {
            ensureFileScheme(uri);
            dlcZipPath = uri.fsPath;
        }

        const AdmZip = require('adm-zip');
        return Promise.resolve(new DlcZip(new AdmZip(dlcZipPath)));
    }

    dlcZipCache = new PromiseCache({
        factory: getDlcZip,
        expireWhenChange: key => getLastModifiedAsync(vscode.Uri.parse(key)),
        life: 10 * 60 * 1000,
        maxSize: 64,
    });
}

// Small bounded cache of read file contents, keyed by resolved path. Avoids re-reading the same
// mod/HOI4 files on every preview render. Opened/dirty documents bypass this cache (see
// readFileFromPath) so edits show up immediately. The cached Buffer is shared across all callers
// of a given path; treat it as read-only and never mutate it in place.
const fileContentCache = new PromiseCache<[Buffer, vscode.Uri]>({
    factory: key => readFileFromPathImpl(vscode.Uri.parse(key)),
    expireWhenChange: key => expiryToken(vscode.Uri.parse(key)),
    life: 60 * 1000,
    maxSize: 100,
    maxBytes: 32 * 1024 * 1024,
    weigher: ([buffer]) => buffer.length,
});

export async function clearDlcZipCache() {
    dlcPathsCache.clear();
    dlcZipPathsCache.clear();
    dlcZipCache?.clear();
    fileContentCache.clear();
    fileListCache.clear();
    getFilePathMemo.clear();
    parseCache.clear();
}

export function getFilePathFromMod(relativePath: string): Promise<vscode.Uri | undefined> {
    return getFilePathFromModOrHOI4(relativePath, { hoi4: false });
}

// Every icon lookup and every expiry-token check resolves a path through here, doing several
// fs.stats each; a single render does this hundreds of times over the same paths. Collapse the
// repeats to one resolution per path/options within the same 500ms window getLastModifiedMemo
// uses. Keyed only on the mod/hoi4 fields the resolver reads, so unrelated option fields and key
// order don't split the cache. Cleared by clearDlcZipCache on folder/config change.
const getFilePathMemo = memoizeWithTtl(
    (key: string): Promise<vscode.Uri | undefined> => {
        const [relativePath, mod, hoi4] = JSON.parse(key) as [string, boolean | null, boolean | null];
        return getFilePathFromModOrHOI4Impl(relativePath, { mod: mod ?? undefined, hoi4: hoi4 ?? undefined });
    },
    { ttl: 500, maxSize: 1000 },
);

export function getFilePathFromModOrHOI4(relativePath: string, options?: { mod?: boolean, hoi4?: boolean }): Promise<vscode.Uri | undefined> {
    const normalizedPath = relativePath.replace(/\/\/+|\\+/g, '/');
    return getFilePathMemo(JSON.stringify([normalizedPath, options?.mod ?? null, options?.hoi4 ?? null]));
}

async function getFilePathFromModOrHOI4Impl(relativePath: string, options?: { mod?: boolean, hoi4?: boolean }): Promise<vscode.Uri | undefined> {
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    let absolutePath: vscode.Uri | undefined = undefined;

    if (options?.mod !== false) {
        // Find in opened workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                if (await isFile(findPath)) {
                    absolutePath = findPath;
                    break;
                }
            }
            
            if (absolutePath !== undefined) {
                // Opened document
                const document = vscode.workspace.textDocuments.find(d => isSameUri(d.uri, absolutePath!));
                if (document) {
                    return document.uri.with({ fragment: ':opened' });
                }
            }
        }

        if (absolutePath !== undefined) {
            return absolutePath;
        }

        const replacePaths = await getReplacePaths();
        if (replacePaths) {
            const relativePathDir = path.dirname(relativePath);
            for (const replacePath of replacePaths) {
                if (isSamePath(relativePathDir, replacePath)) {
                    return absolutePath;
                }
            }
        }
    }

    if (options?.hoi4 === false) {
        return absolutePath;
    }

    // Find in HOI4 install path
    const installPath = vscode.Uri.parse(Hoi4FsSchema + ':/');
    if (!absolutePath) {
        const findPath = vscode.Uri.joinPath(installPath, relativePath);
        if (await isFile(findPath)) {
            absolutePath = findPath;
        }
    }

    // Find in HOI4 DLCs
    const conf = getConfiguration();
    if (!absolutePath && conf.loadDlcContents) {
        const dlcs = await dlcZipPathsCache.get(installPath.toString());
        if (dlcs !== null && dlcZipCache !== null) {
            for (const dlc of dlcs) {
                const dlcZip = await dlcZipCache.get(dlc.toString());
                const entry = dlcZip.getEntry(relativePath);
                if (entry !== null) {
                    return dlc.with({ fragment: relativePath });
                }
            }
        }

        const dlcFolders = await dlcPathsCache.get(installPath.toString());
        if (dlcFolders !== null) {
            for (const dlc of dlcFolders) {
                const findPath = vscode.Uri.joinPath(dlc, relativePath);
                if (await isFile(findPath)) {
                    return findPath;
                }
            }
        }
    }

    return absolutePath;
}

export function isHoiFileOpened(path: vscode.Uri): boolean {
    return path.fragment === ':opened';
}

export function getHoiOpenedFileOriginalUri(path: vscode.Uri): vscode.Uri {
    return path.with({ fragment: '' });
}

export function isHoiFileFromDlc(path: vscode.Uri): boolean {
    return path.fragment !== '' && path.path.endsWith('.zip');
}

export function getHoiDlcFileOriginalUri(path: vscode.Uri): { uri: vscode.Uri, entryPath: string } {
    return { uri: path.with({ fragment: '' }), entryPath: path.fragment };
}

export async function hoiFileExpiryToken(relativePath: string): Promise<string> {
    return await expiryToken(await getFilePathFromModOrHOI4(relativePath));;
}

// Short-TTL memo over the filesystem stat used to build a file's on-disk expiry token. A single
// preview render can resolve hundreds of icons, each re-checking its mtime; within EXPIRY_STAT_TTL
// the memoized mtime is reused so those hundreds of stat calls collapse to one per file. Opened/
// dirty documents never reach this memo (they take the Date.now() branch in expiryToken), so it
// can never make an edited document look unchanged.
const EXPIRY_STAT_TTL = 500;
const getLastModifiedMemo = memoizeWithTtl(
    (key: string) => getLastModifiedAsync(vscode.Uri.parse(key)),
    { ttl: EXPIRY_STAT_TTL },
);

export async function expiryToken(realPath: vscode.Uri | undefined): Promise<string> {
    if (!realPath) {
        return '';
    }

    if (isHoiFileOpened(realPath)) {
        // Opened/dirty documents must always look fresh: return a token that changes every call so
        // the content cache never serves stale editor text. This branch bypasses the stat memo.
        return realPath.toString() + '@' + Date.now();
    } else if (isHoiFileFromDlc(realPath)) {
        return realPath.with({ fragment: '' }).toString() + '@' + await getLastModifiedMemo(realPath.toString());
    }

    return realPath.toString() + '@' + await getLastModifiedMemo(realPath.toString());
}

export async function readFileFromPath(realPath: vscode.Uri, relativePath?: string): Promise<[Buffer, vscode.Uri]> {
    try {
        // Opened/dirty documents must always reflect the live editor text, so they bypass the
        // content cache entirely. The cache's nonExpireLife window could otherwise serve a stale
        // buffer for a short time after an edit. Only on-disk files (keyed by path + mtime) cache.
        if (isHoiFileOpened(realPath)) {
            return await readFileFromPathImpl(realPath, relativePath);
        }
        return await fileContentCache.get(realPath.toString());
    } catch (e) {
        if (relativePath !== undefined && e instanceof UserError) {
            throw new UserError("Can't find file " + relativePath);
        }
        throw e;
    }
}

async function readFileFromPathImpl(realPath: vscode.Uri, relativePath?: string): Promise<[Buffer, vscode.Uri]> {
    if (isHoiFileOpened(realPath)) {
        const realPathWithoutOpenMark = getHoiOpenedFileOriginalUri(realPath);
        const document = getDocumentByUri(realPathWithoutOpenMark);
        if (document) {
            return [Buffer.from(document.getText()), realPath];
        }

        realPath = realPathWithoutOpenMark;

    } else if (realPath.fragment !== '' && realPath.path.endsWith('.zip')) {
        if (dlcZipCache !== null) {
            const { uri: dlc, entryPath: filePath } = getHoiDlcFileOriginalUri(realPath);

            const dlcZip = await dlcZipCache.get(dlc.toString());
            const entry = dlcZip.getEntry(filePath);
            if (entry !== null) {
                return [await new Promise<Buffer>(resolve => entry.getDataAsync(resolve)), realPath];
            }
        }

        throw new UserError("Can't find file " + relativePath);
    }

    return [ await readFile(realPath), realPath ];
}

export async function readFileFromModOrHOI4(relativePath: string, options?: { mod?: boolean, hoi4?: boolean }): Promise<[Buffer, vscode.Uri]> {
    const realPath = await getFilePathFromModOrHOI4(relativePath, options);

    if (!realPath) {
        throw new UserError("Can't find file " + relativePath);
    }

    return await readFileFromPath(realPath, relativePath);
}

export async function readFileFromModOrHOI4AsJson<T>(relativePath: string, schema: SchemaDef<T>): Promise<HOIPartial<T>> {
    const [buffer, realPath] = await readFileFromModOrHOI4(relativePath);
    const nodes = parseHoi4File(buffer.toString(), localize('infile', 'In file {0}:\n', realPath));
    return convertNodeToJson<T>(nodes, schema);
}

// Buffers are cached (fileContentCache), but every call site re-tokenizes them into a Node tree.
// This caches the parsed tree so unchanged files aren't re-parsed on every render. The returned Node
// is shared and must be treated as read-only: consumers like convertNodeToJson/getSpriteTypes only
// read it. resolveScriptVariables rewrites node.value in place, so the resolved variant parses a
// fresh tree in the factory under its own key and never touches a plain entry. Keyed by relativePath
// + parse options + resolve flag; opened/dirty documents bypass this cache (see
// parseHoi4FileCachedImpl). Node trees run ~5-10x the buffer size, so this is bounded by entry count.
const parseCache = new PromiseCache<Node>({
    factory: parseHoi4FileForCache,
    expireWhenChange: key => hoiFileExpiryToken(JSON.parse(key)[0]),
    life: 60 * 1000,
    maxSize: 64,
});

async function parseHoi4FileForCache(key: string): Promise<Node> {
    const [relativePath, options, resolve] = JSON.parse(key) as [string, ParseOptions | null, boolean];
    const [buffer, realPath] = await readFileFromModOrHOI4(relativePath);
    return parseHoi4Buffer(buffer, realPath, options ?? undefined, resolve);
}

function parseHoi4Buffer(buffer: Buffer, realPath: vscode.Uri, options: ParseOptions | undefined, resolve: boolean): Node {
    const node = parseHoi4File(buffer.toString().replace(/^\uFEFF/, ''), localize('infile', 'In file {0}:\n', realPath), options);
    return resolve ? resolveScriptVariables(node) : node;
}

// Returns the shared, read-only parsed tree for a file. Opened/dirty documents bypass the cache and
// parse the live editor text directly (mirrors readFileFromPath), so per-keystroke edits never churn
// or stale it.
export function parseHoi4FileCached(relativePath: string, options?: ParseOptions): Promise<Node> {
    return parseHoi4FileCachedImpl(relativePath, options, false);
}

// Like parseHoi4FileCached but resolves @script constants. resolveScriptVariables mutates its Node in
// place, so this gets its own cache entry; never hand a plain parseHoi4FileCached tree to it.
export function parseAndResolveHoi4FileCached(relativePath: string): Promise<Node> {
    return parseHoi4FileCachedImpl(relativePath, undefined, true);
}

async function parseHoi4FileCachedImpl(relativePath: string, options: ParseOptions | undefined, resolve: boolean): Promise<Node> {
    const realPath = await getFilePathFromModOrHOI4(relativePath);
    if (realPath && isHoiFileOpened(realPath)) {
        const [buffer, openedPath] = await readFileFromPath(realPath, relativePath);
        return parseHoi4Buffer(buffer, openedPath, options, resolve);
    }
    return parseCache.get(JSON.stringify([relativePath, options ?? null, resolve]));
}

// Short-lived cache of directory listings. listFilesFromModOrHOI4 walks the workspace, the HOI4
// install and every DLC on each call, and a single preview render calls it many times in quick
// succession (e.g. the inlay scan over interface/). A small TTL collapses those repeated walks
// while staying fresh enough to pick up new files within a couple of seconds.
const fileListCache = new PromiseCache<string[]>({
    factory: key => listFilesFromModOrHOI4Impl(JSON.parse(key)[0], JSON.parse(key)[1]),
    life: 3 * 1000,
    maxSize: 300,
});

export function listFilesFromModOrHOI4(relativePath: string, options?: { mod?: boolean, hoi4?: boolean, recursively?: boolean }): Promise<string[]> {
    return fileListCache.get(JSON.stringify([relativePath, options ?? null]));
}

async function listFilesFromModOrHOI4Impl(relativePath: string, options?: { mod?: boolean, hoi4?: boolean, recursively?: boolean } | null): Promise<string[]> {
    const readFunction = options?.recursively ? readDirFilesRecursively : readDirFiles;
    relativePath = relativePath.replace(/\/\/+|\\+/g, '/');
    const result: string[] = [];

    if (options?.mod !== false) {
        // Find in opened workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
                if (await isDirectory(findPath)) {
                    try {
                        result.push(...await readFunction(findPath));
                    } catch(e) {}
                }
            }
        }

        const replacePaths = await getReplacePaths();
        if (replacePaths) {
            for (const replacePath of replacePaths) {
                if (isSamePath(relativePath, replacePath)) {
                    return [...new Set(result)];
                }
            }
        }
    }

    if (options?.hoi4 === false) {
        return result;
    }

    // Find in HOI4 install path
    const conf = getConfiguration();
    const installPath = vscode.Uri.parse(Hoi4FsSchema + ':/');
    {
        const findPath = vscode.Uri.joinPath(installPath, relativePath);
        if (await isDirectory(findPath)) {
            try {
                result.push(...await readFunction(findPath));
            } catch(e) {}
        }
    }

    // Find in HOI4 DLCs
    if (conf.loadDlcContents) {
        const dlcs = await dlcZipPathsCache.get(installPath.toString());
        if (dlcs !== null && dlcZipCache !== null) {
            for (const dlc of dlcs) {
                const dlcZip = await dlcZipCache.get(dlc.toString());
                const folderEntry = dlcZip.getEntry(relativePath);
                if (folderEntry && folderEntry.isDirectory) {
                    result.push(...dlcZip.listDir(relativePath));
                }
            }
        }

        const dlcFolders = await dlcPathsCache.get(installPath.toString());
        if (dlcFolders !== null) {
            for (const dlc of dlcFolders) {
                const findPath = vscode.Uri.joinPath(dlc, relativePath);
                if (await isDirectory(findPath)) {
                    try {
                        result.push(...await readFunction(findPath));
                    } catch(e) {}
                }
            }
        }
    }

    return [...new Set(result)];
}

async function getDlcZipPaths(installPath: string): Promise<vscode.Uri[] | null> {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await isDirectory(dlcPath)) {
        return null;
    }

    const dlcFolders = await readDir(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await isDirectory(dlcZipFolder)) {
            const files =  await readDir(dlcZipFolder);
            const zipFile = files.find(file => file.endsWith('.zip'));
            if (zipFile) {
                return vscode.Uri.joinPath(dlcZipFolder, zipFile);
            }
        }

        return null;
    }));

    return paths.filter((path): path is vscode.Uri => path !== null);
}

async function getDlcPaths(installPath: string): Promise<vscode.Uri[] | null> {
    const dlcPath = vscode.Uri.joinPath(vscode.Uri.parse(installPath), 'dlc');
    if (!await isDirectory(dlcPath)) {
        return null;
    }

    const dlcFolders = await readDir(dlcPath);
    const paths = await Promise.all(dlcFolders.map(async (dlcFolder) => {
        const dlcZipFolder = vscode.Uri.joinPath(dlcPath, dlcFolder);
        if (await isDirectory(dlcZipFolder) && dlcFolder.startsWith("dlc")) {
            return dlcZipFolder;
        }

        return null;
    }));

    return paths.filter((path): path is vscode.Uri => path !== null);
}

const replacePathsCache = new PromiseCache({
    factory: getReplacePathsFromModFile,
    expireWhenChange: key => getLastModifiedAsync(vscode.Uri.parse(key)),
    life: 60 * 1000,
});

interface ModFile {
    replace_path: string[];
}

const modFileSchema: SchemaDef<ModFile> = {
    replace_path: {
        _innerType: "string",
        _type: "array",
    },
};

async function getReplacePaths(): Promise<string[] | undefined> {
    const conf = getConfiguration();
    let modFile = fileOrUriStringToUri(conf.modFile);

    if (conf.modFile === "") {
        if (vscode.workspace.workspaceFolders) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const workspaceFolderPath = workspaceFolder.uri;
                const mods = await workspaceModFilesCache.get(workspaceFolderPath.toString());
                if (mods.length > 0) {
                    modFile = mods[0];
                    break;
                }
            }
        }
    }

    try {
        if (modFile && await isFile(modFile)) {
            const result = await replacePathsCache.get(modFile.toString());
            updateSelectedModFileStatus(modFile);
            return result;
        }
    } catch (e) {
        error(e);
    }

    updateSelectedModFileStatus(modFile, true);
    return undefined;
}

async function getReplacePathsFromModFile(absolutePath: string): Promise<string[]> {
    const content = (await readFile(vscode.Uri.parse(absolutePath))).toString();
    const node = parseHoi4File(content, localize('infile', 'In file {0}:\n', absolutePath));
    const modFile = convertNodeToJson<ModFile>(node, modFileSchema);
    return modFile.replace_path.filter((v): v is string => typeof v === 'string');
}
