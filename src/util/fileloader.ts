import * as vscode from "vscode";
import * as path from "path";
import { PromiseCache } from "./cache";
import { isSamePath } from "./nodecommon";
import {
	getLastModifiedAsync,
	readDirFiles,
	isFile,
	isDirectory,
	readFile,
	readDir,
	isSameUri,
	fileOrUriStringToUri,
	ensureFileScheme,
	readDirFilesRecursively,
	getConfiguration,
	getDocumentByUri,
	isFileScheme,
} from "./vsccommon";
import {
	parseHoi4File,
	resolveScriptVariables,
	Node,
	ParseOptions,
} from "../hoiformat/hoiparser";
import { localize } from "./i18n";
import { convertNodeToJson, SchemaDef, HOIPartial } from "../hoiformat/schema";
import { error } from "./debug";
import { updateSelectedModFileStatus, workspaceModFilesCache } from "./modfile";
import {
	UserError,
	memoizeWithTtl,
	CancelledError,
	throwIfCancelled,
	forceError,
} from "./common";
import { Logger } from "./logger";
import { getInstallPathUri } from "./installpath";
import { appendEntriesWithErrorLogging } from "./promiseUtils";
import type * as AdmZip from "adm-zip";
import { Hoi4FsSchema } from "../constants";
import { trimStart } from "lodash";

const dlcRootFolders = ["dlc", "integrated_dlc"];

/** Which of the mod / HOI4 / DLC sources a listing looks in, and how deep. */
export interface ListFilesOptions {
	mod?: boolean;
	hoi4?: boolean;
	recursively?: boolean;
}

const dlcZipPathsCache = new PromiseCache({
	factory: getDlcZipPaths,
	life: 10 * 60 * 1000,
});

const dlcPathsCache = new PromiseCache({
	factory: getDlcPaths,
	life: 10 * 60 * 1000,
});

// Cached DLC zip that retains only a lightweight index (entryName -> isDirectory and directory ->
// file basenames), never the zip buffer; reads reopen the archive transiently via readEntryData.
export class DlcZip {
	private nameIndex?: Map<string, { isDirectory: boolean }>;
	private dirIndex?: Map<string, string[]>;

	constructor(private readonly openZip: () => AdmZip) {}

	getEntry(name: string): { isDirectory: boolean } | null {
		this.ensureIndex();
		return this.nameIndex!.get(name) ?? null;
	}

	// Basenames of the non-directory entries directly under relativePath, matched the same way the
	// old getEntries loop did: leading slash/backslash stripped, path.resolve + lowercase compare.
	listDir(relativePath: string): string[] {
		this.ensureIndex();
		return this.dirIndex!.get(path.resolve(relativePath).toLowerCase()) ?? [];
	}

	// Reopens the archive to read one entry's data. The index holds no buffers, so this pays a
	// transient re-open; repeated reads are served upstream by fileContentCache.
	async readEntryData(name: string): Promise<Buffer | null> {
		const entry = this.openZip().getEntry(name);
		if (!entry) {
			return null;
		}
		return await new Promise<Buffer>((resolve) => entry.getDataAsync(resolve));
	}

	private ensureIndex(): void {
		if (this.nameIndex !== undefined) {
			return;
		}
		const nameIndex = new Map<string, { isDirectory: boolean }>();
		const dirIndex = new Map<string, string[]>();
		for (const entry of this.openZip().getEntries()) {
			nameIndex.set(entry.entryName, { isDirectory: entry.isDirectory });
			if (!entry.isDirectory) {
				const dir = path
					.resolve(path.dirname(entry.entryName.replace(/^[\\/]/, "")))
					.toLowerCase();
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

/**
 * The node-only directory walk, or null on the web build, where callers take the
 * `vscode.workspace.fs` path instead. The require sits inside the `!IS_WEB_EXT` branch so webpack's
 * DefinePlugin drops it and never tries to resolve `node:fs/promises` for a bundle that has no `fs`.
 */
let nativeWalk: typeof import("./nativewalk") | null = null;

if (!IS_WEB_EXT) {
	nativeWalk = require("./nativewalk") as typeof import("./nativewalk");
}

let dlcZipCache: PromiseCache<DlcZip> | null = null;

if (!IS_WEB_EXT) {
	// adm-zip requires fs, which doesn't work on web.
	function getDlcZip(dlcZipPath: string): Promise<DlcZip> {
		const uri = vscode.Uri.parse(dlcZipPath);
		if (uri.scheme === Hoi4FsSchema) {
			// Resolve through the shared install path so this gets the same normalization (and
			// cache) as every hoi4installpath: lookup; adm-zip needs a real fs path.
			const installPath = getInstallPathUri();
			ensureFileScheme(installPath);
			dlcZipPath = path.join(installPath.fsPath, trimStart(uri.path, "/"));
		} else {
			ensureFileScheme(uri);
			dlcZipPath = uri.fsPath;
		}

		const AdmZip = require("adm-zip");
		return Promise.resolve(new DlcZip(() => new AdmZip(dlcZipPath)));
	}

	dlcZipCache = new PromiseCache({
		factory: getDlcZip,
		expireWhenChange: (key) => getLastModifiedAsync(vscode.Uri.parse(key)),
		life: 10 * 60 * 1000,
		maxSize: 64,
	});
}

// Small bounded cache of read file contents, keyed by resolved path. Avoids re-reading the same
// mod/HOI4 files on every preview render. Opened/dirty documents bypass this cache (see
// readFileFromPath) so edits show up immediately. The cached Buffer is shared across all callers
// of a given path; treat it as read-only and never mutate it in place.
const fileContentCache = new PromiseCache<[Buffer, vscode.Uri]>({
	factory: (key) => readFileFromPathImpl(vscode.Uri.parse(key)),
	expireWhenChange: (key) => expiryToken(vscode.Uri.parse(key)),
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

export function getFilePathFromMod(
	relativePath: string,
): Promise<vscode.Uri | undefined> {
	return getFilePathFromModOrHOI4(relativePath, { hoi4: false });
}

function parseJsonTuple(key: string): unknown[] | undefined {
	try {
		const parsed = JSON.parse(key);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isBooleanOrNull(value: unknown): value is boolean | null {
	return value === null || typeof value === "boolean";
}

function isCacheOptionsObject(
	value: unknown,
): value is { mod?: boolean; hoi4?: boolean; recursively?: boolean } {
	if (value === null || typeof value !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return false;
	}

	const options = value as {
		mod?: unknown;
		hoi4?: unknown;
		recursively?: unknown;
	};
	if (options.mod !== undefined && typeof options.mod !== "boolean") {
		return false;
	}
	if (options.hoi4 !== undefined && typeof options.hoi4 !== "boolean") {
		return false;
	}
	if (
		options.recursively !== undefined &&
		typeof options.recursively !== "boolean"
	) {
		return false;
	}
	return true;
}

function parseFilePathCacheKey(
	key: string,
): [string, boolean | null, boolean | null] | undefined {
	const parsed = parseJsonTuple(key);
	if (
		!parsed ||
		parsed.length !== 3 ||
		typeof parsed[0] !== "string" ||
		!isBooleanOrNull(parsed[1]) ||
		!isBooleanOrNull(parsed[2])
	) {
		return undefined;
	}

	return [parsed[0], parsed[1], parsed[2]];
}

function parseParseCacheKey(
	key: string,
): [string, ParseOptions | null, boolean] | undefined {
	const parsed = parseJsonTuple(key);
	if (
		!parsed ||
		parsed.length !== 3 ||
		typeof parsed[0] !== "string" ||
		(parsed[1] !== null && typeof parsed[1] !== "object") ||
		typeof parsed[2] !== "boolean"
	) {
		return undefined;
	}

	return [parsed[0], parsed[1], parsed[2]];
}

function parseListCacheKey(
	key: string,
):
	| [string, { mod?: boolean; hoi4?: boolean; recursively?: boolean } | null]
	| undefined {
	const parsed = parseJsonTuple(key);
	if (
		!parsed ||
		parsed.length !== 2 ||
		typeof parsed[0] !== "string" ||
		(parsed[1] !== null && !isCacheOptionsObject(parsed[1]))
	) {
		return undefined;
	}

	return [parsed[0], parsed[1] ?? null];
}

// Every icon lookup and every expiry-token check resolves a path through here, doing several
// fs.stats each; a single render does this hundreds of times over the same paths. Collapse the
// repeats to one resolution per path/options within the 500ms window getLastModifiedMemo
// uses. Keyed only on the mod/hoi4 fields the resolver reads, so unrelated option fields and key
// order don't split the cache. Cleared by clearDlcZipCache on folder/config change.
const getFilePathMemo = memoizeWithTtl(
	(key: string): Promise<vscode.Uri | undefined> => {
		const parsed = parseFilePathCacheKey(key);
		if (!parsed) {
			return Promise.resolve(undefined);
		}
		return getFilePathFromModOrHOI4Impl(parsed[0], {
			mod: parsed[1] ?? undefined,
			hoi4: parsed[2] ?? undefined,
		});
	},
	{ ttl: 500, maxSize: 1000 },
);

export function getFilePathFromModOrHOI4(
	relativePath: string,
	options?: { mod?: boolean; hoi4?: boolean },
): Promise<vscode.Uri | undefined> {
	const normalizedPath = relativePath.replace(/\/\/+|\\+/g, "/");
	return getFilePathMemo(
		JSON.stringify([
			normalizedPath,
			options?.mod ?? null,
			options?.hoi4 ?? null,
		]),
	);
}

async function getFilePathFromModOrHOI4Impl(
	relativePath: string,
	options?: { mod?: boolean; hoi4?: boolean },
): Promise<vscode.Uri | undefined> {
	relativePath = relativePath.replace(/\/\/+|\\+/g, "/");
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
				const document = vscode.workspace.textDocuments.find((d) =>
					isSameUri(d.uri, absolutePath!),
				);
				if (document) {
					return document.uri.with({ fragment: ":opened" });
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
	const installPath = vscode.Uri.parse(Hoi4FsSchema + ":/");
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
	return path.fragment === ":opened";
}

export function getHoiOpenedFileOriginalUri(path: vscode.Uri): vscode.Uri {
	return path.with({ fragment: "" });
}

export function isHoiFileFromDlc(path: vscode.Uri): boolean {
	return path.fragment !== "" && path.path.endsWith(".zip");
}

export function getHoiDlcFileOriginalUri(path: vscode.Uri): {
	uri: vscode.Uri;
	entryPath: string;
} {
	return { uri: path.with({ fragment: "" }), entryPath: path.fragment };
}

export async function hoiFileExpiryToken(
	relativePath: string,
): Promise<string> {
	return await expiryToken(await getFilePathFromModOrHOI4(relativePath));
}

// Short-TTL memo over the filesystem stat used to build a file's on-disk expiry token. A single
// preview render can resolve hundreds of icons, each re-checking its mtime; within EXPIRY_STAT_TTL
// the memoized mtime is reused to one per file. Opened/dirty documents never reach this memo (they
// take the Date.now() branch in expiryToken), so it can never make an edited document look unchanged.
const EXPIRY_STAT_TTL = 500;
const getLastModifiedMemo = memoizeWithTtl(
	(key: string) => getLastModifiedAsync(vscode.Uri.parse(key)),
	{ ttl: EXPIRY_STAT_TTL },
);

export async function expiryToken(
	realPath: vscode.Uri | undefined,
): Promise<string> {
	if (!realPath) {
		return "";
	}

	if (isHoiFileOpened(realPath)) {
		// Opened/dirty documents must always look fresh: return a token that changes every call so
		// the content cache never serves stale editor text. This branch bypasses the stat memo.
		return realPath.toString() + "@" + Date.now();
	} else if (isHoiFileFromDlc(realPath)) {
		return (
			realPath.with({ fragment: "" }).toString() +
			"@" +
			(await getLastModifiedMemo(realPath.toString()))
		);
	}

	return (
		realPath.toString() + "@" + (await getLastModifiedMemo(realPath.toString()))
	);
}

export async function readFileFromPath(
	realPath: vscode.Uri,
	relativePath?: string,
): Promise<[Buffer, vscode.Uri]> {
	try {
		// Opened/dirty documents must always reflect the live editor text, so they bypass the
		// content cache entirely. The cache's nonExpireLife window could otherwise serve stale
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

async function readFileFromPathImpl(
	realPath: vscode.Uri,
	relativePath?: string,
): Promise<[Buffer, vscode.Uri]> {
	if (isHoiFileOpened(realPath)) {
		const realPathWithoutOpenMark = getHoiOpenedFileOriginalUri(realPath);
		const document = getDocumentByUri(realPathWithoutOpenMark);
		if (document) {
			return [Buffer.from(document.getText()), realPath];
		}

		realPath = realPathWithoutOpenMark;
	} else if (realPath.fragment !== "" && realPath.path.endsWith(".zip")) {
		if (dlcZipCache !== null) {
			const { uri: dlc, entryPath: filePath } =
				getHoiDlcFileOriginalUri(realPath);

			const dlcZip = await dlcZipCache.get(dlc.toString());
			const data = await dlcZip.readEntryData(filePath);
			if (data !== null) {
				return [data, realPath];
			}
		}

		throw new UserError("Can't find file " + relativePath);
	}

	return [await readFile(realPath), realPath];
}

export async function readFileFromModOrHOI4(
	relativePath: string,
	options?: { mod?: boolean; hoi4?: boolean },
	/**
	 * A path a listing already resolved, for callers that have one. Skips getFilePathFromModOrHOI4,
	 * which during an index build is a stat of the install path plus one of every DLC folder, per
	 * file, through a filesystem provider that answers by calling vscode.workspace.fs again. A file
	 * open in an editor is still read from the live document, so a dirty buffer indexes what its
	 * reader can see.
	 */
	resolvedUri?: vscode.Uri,
): Promise<[Buffer, vscode.Uri]> {
	if (resolvedUri !== undefined) {
		return await readResolvedFile(resolvedUri, relativePath);
	}

	const realPath = await getFilePathFromModOrHOI4(relativePath, options);

	if (!realPath) {
		throw new UserError("Can't find file " + relativePath);
	}

	return await readFileFromPath(realPath, relativePath);
}

/**
 * Reads straight through, bypassing fileContentCache. Whoever passes a resolved path is walking a
 * list of thousands of files and reading each of them once, so the cache would never be hit, its
 * expiry check would cost another stat per file, and the entries it evicted would be the ones a
 * preview actually re-reads.
 */
async function readResolvedFile(
	resolvedUri: vscode.Uri,
	relativePath: string,
): Promise<[Buffer, vscode.Uri]> {
	try {
		return await readFileFromPathImpl(
			openedDocumentUriFor(resolvedUri) ?? resolvedUri,
			relativePath,
		);
	} catch (e) {
		if (e instanceof UserError) {
			throw new UserError("Can't find file " + relativePath);
		}
		throw e;
	}
}

/**
 * The `:opened` form of `uri` when an editor holds that file, otherwise undefined. Backed by a map of
 * the open documents rebuilt at most every EXPIRY_STAT_TTL, because the scan
 * getFilePathFromModOrHOI4 does is fine a few hundred times a render and not fine several thousand
 * times a build. Both directions of staleness inside that window are harmless: a document that has
 * since closed falls back to disk inside readFileFromPathImpl, and one that has since opened is read
 * from disk, which is the same window getFilePathMemo has always had.
 */
let openedDocuments:
	| { at: number; byPath: Map<string, vscode.Uri> }
	| undefined;

function openedDocumentUriFor(uri: vscode.Uri): vscode.Uri | undefined {
	if (!isFileScheme(uri) || vscode.workspace.textDocuments.length === 0) {
		return undefined;
	}

	const now = Date.now();
	if (
		openedDocuments === undefined ||
		now - openedDocuments.at >= EXPIRY_STAT_TTL
	) {
		const byPath = new Map<string, vscode.Uri>();
		for (const document of vscode.workspace.textDocuments) {
			if (isFileScheme(document.uri)) {
				byPath.set(document.uri.fsPath.toLowerCase(), document.uri);
			}
		}
		openedDocuments = { at: now, byPath };
	}

	return openedDocuments.byPath
		.get(uri.fsPath.toLowerCase())
		?.with({ fragment: ":opened" });
}

export async function readFileFromModOrHOI4AsJson<T>(
	relativePath: string,
	schema: SchemaDef<T>,
): Promise<HOIPartial<T>> {
	const realPath = await getFilePathFromModOrHOI4(relativePath);
	if (!realPath) {
		throw new UserError("Can't find file " + relativePath);
	}

	const [buffer, resolvedPath] = await readFileFromPathImpl(
		realPath,
		relativePath,
	);
	const nodes = parseHoi4File(
		buffer.toString(),
		localize("infile", "In file {0}:\n", resolvedPath),
	);
	return convertNodeToJson<T>(nodes, schema);
}

// Buffers are cached (fileContentCache), but every call site re-tokenizes them into a Node tree.
// This caches the parsed tree so unchanged files aren't re-parsed on every render. The returned Node
// is shared and must be treated as read-only: consumers like convertNodeToJson/getSpriteTypes only
// read it. resolveScriptVariables rewrites node.value in place, so the resolved variant parses a
// fresh tree in the factory under its own key and never touches a plain entry. Keyed by relativePath
// + parse options + resolve flag; opened/dirty documents bypass this cache (see
// parseHoi4FileCachedImpl). Node trees run ~5-10x the file size, so this is bounded by entry count.
const parseCache = new PromiseCache<Node>({
	factory: parseHoi4FileForCache,
	expireWhenChange: (key) => {
		const parsed = parseParseCacheKey(key);
		if (!parsed) {
			return "";
		}
		return hoiFileExpiryToken(parsed[0]);
	},
	life: 60 * 1000,
	maxSize: 64,
});

async function parseHoi4FileForCache(key: string): Promise<Node> {
	const parsed = parseParseCacheKey(key);
	if (!parsed) {
		throw new Error(`Cannot parse cache key: ${key}`);
	}
	const [buffer, realPath] = await readFileFromModOrHOI4(parsed[0]);
	return parseHoi4Buffer(buffer, realPath, parsed[1] ?? undefined, parsed[2]);
}

function parseHoi4Buffer(
	buffer: Buffer,
	realPath: vscode.Uri,
	options: ParseOptions | undefined,
	resolve: boolean,
): Node {
	const node = parseHoi4File(
		buffer.toString().replace(/^\uFEFF/, ""),
		localize("infile", "In file {0}:\n", realPath),
		options,
	);
	return resolve ? resolveScriptVariables(node) : node;
}

// Returns the shared, read-only parsed tree for a file. Opened/dirty documents bypass the cache and
// parse the live editor text directly (mirrors readFileFromPath), so per-keystroke edits never churn
// or stale it.
export function parseHoi4FileCached(
	relativePath: string,
	options?: ParseOptions,
): Promise<Node> {
	return parseHoi4FileCachedImpl(relativePath, options, false);
}

// Like parseHoi4FileCached but resolves @script constants. resolveScriptVariables mutates its Node in
// place, so this gets its own cache entry; never hand a plain parseHoi4FileCached tree to it.
export function parseAndResolveHoi4FileCached(
	relativePath: string,
): Promise<Node> {
	return parseHoi4FileCachedImpl(relativePath, undefined, true);
}

async function parseHoi4FileCachedImpl(
	relativePath: string,
	options: ParseOptions | undefined,
	resolve: boolean,
): Promise<Node> {
	const realPath = await getFilePathFromModOrHOI4(relativePath);
	if (realPath && isHoiFileOpened(realPath)) {
		const [buffer, openedPath] = await readFileFromPath(realPath, relativePath);
		return parseHoi4Buffer(buffer, openedPath, options, resolve);
	}
	return parseCache.get(
		JSON.stringify([relativePath, options ?? null, resolve]),
	);
}

// Short-lived cache of directory listings. listFilesFromModOrHOI4 walks the workspace, the HOI4
// install and every DLC on each call, and a single preview render calls it many times in quick
// succession (e.g. the inlay scan over interface/). A small TTL collapses those repeated walks
// while staying fresh enough to pick up new files within a couple of seconds.
const fileListCache = new PromiseCache<string[]>({
	factory: (key) => {
		const parsed = parseListCacheKey(key);
		if (!parsed) {
			return Promise.resolve([]);
		}
		return listFilesFromModOrHOI4Impl(parsed[0], parsed[1]);
	},
	life: 3 * 1000,
	maxSize: 300,
});

export function listFilesFromModOrHOI4(
	relativePath: string,
	options?: ListFilesOptions,
): Promise<string[]> {
	return fileListCache.get(JSON.stringify([relativePath, options ?? null]));
}

async function listFilesFromModOrHOI4Impl(
	relativePath: string,
	options?: ListFilesOptions | null,
): Promise<string[]> {
	const readFunction = options?.recursively
		? readDirFilesRecursively
		: readDirFiles;
	const result: string[] = [];

	const shouldDedupe = await visitFileSources(relativePath, options, {
		directory: (dir, listFailureMessage) =>
			appendEntriesWithErrorLogging(
				result,
				() => readFunction(dir),
				listFailureMessage,
				(message: string) => error(message),
			),
		dlcZip: async (zip, _zipUri, normalizedPath) => {
			result.push(...zip.listDir(normalizedPath));
		},
	});

	return shouldDedupe ? [...new Set(result)] : result;
}

export interface ListFileEntriesOptions extends ListFilesOptions {
	/**
	 * Only `isCancellationRequested` is read, so a test can hand in a plain object literal -- the
	 * unit-test vscode stub has no CancellationTokenSource to build a real one from.
	 */
	token?: vscode.CancellationToken;
}

/** One file a listing found, with everything an index build needs about it, from a single pass. */
export interface ModOrHoi4FileEntry {
	/** Path relative to the folder listed -- the same string listFilesFromModOrHOI4 returns. */
	relativePath: string;
	/** Where it was found. A real `file:` path wherever one exists, so reads skip re-resolving it. */
	uri: vscode.Uri;
	/** Absent when this source cannot date the file in the same pass: the web build, or a remote install. */
	mtime: number | undefined;
}

/**
 * Like listFilesFromModOrHOI4, but hands back each file's URI and mtime alongside its name, gathered
 * in the same pass as the listing. The index builds use this so they never make a second pass that
 * resolves every listed name back to a path and stats it again -- which, for the vanilla half, was a
 * stat of the install path plus one of every DLC folder, per file, through a filesystem provider that
 * answers by calling `vscode.workspace.fs` a second time.
 *
 * Deliberately not served from `fileListCache`. A three-second-stale mtime is exactly the wrong thing
 * to decide cache staleness on, a CancellationToken has no business in a JSON cache key, and an index
 * asks for this once per build. The expensive shared caches behind it -- DLC discovery, replace_path,
 * the zip index -- still apply.
 */
export async function listFileEntriesFromModOrHOI4(
	relativePath: string,
	options?: ListFileEntriesOptions,
): Promise<ModOrHoi4FileEntry[]> {
	const recursively = options?.recursively ?? false;
	const token = options?.token;
	const result: ModOrHoi4FileEntry[] = [];

	throwIfCancelled(token);

	const shouldDedupe = await visitFileSources(relativePath, options, {
		directory: async (dir, listFailureMessage) => {
			try {
				result.push(...(await listDirectoryEntries(dir, recursively, token)));
			} catch (cause) {
				if (cause instanceof CancelledError) {
					throw cause;
				}
				// One unreadable folder costs that folder and nothing else, as it always has.
				error(`${listFailureMessage}: ${forceError(cause).toString()}`);
			}
		},
		dlcZip: async (zip, zipUri, normalizedPath) => {
			// One stat for the whole archive. Every entry in it is dated by the archive today anyway:
			// getFilePathFromModOrHOI4 hands back `<zipUri>#<entry>` and a stat ignores the fragment.
			// Leaving them undated would have the vanilla half call every DLC file deleted on every
			// build and re-read it forever.
			const mtime = await lastModifiedOrUndefined(zipUri);
			for (const name of zip.listDir(normalizedPath)) {
				result.push({
					relativePath: name,
					uri: zipUri.with({ fragment: `${normalizedPath}/${name}` }),
					mtime,
				});
			}
		},
	});

	return shouldDedupe ? dedupeEntriesByRelativePath(result) : result;
}

/**
 * First occurrence wins, which is what `[...new Set(...)]` does for the name-only listing and what
 * getFilePathFromModOrHOI4 does when it resolves that same name. Entries carry a resolved URI, so
 * unlike a duplicated name a duplicated entry would be an outright wrong answer about where a file is.
 */
function dedupeEntriesByRelativePath(
	entries: ModOrHoi4FileEntry[],
): ModOrHoi4FileEntry[] {
	const seen = new Set<string>();
	return entries.filter((entry) => {
		if (seen.has(entry.relativePath)) {
			return false;
		}
		seen.add(entry.relativePath);
		return true;
	});
}

async function listDirectoryEntries(
	dir: vscode.Uri,
	recursively: boolean,
	token: vscode.CancellationToken | undefined,
): Promise<ModOrHoi4FileEntry[]> {
	const nativePath = nativeWalk === null ? undefined : toNativeWalkPath(dir);
	if (nativePath !== undefined) {
		try {
			const walked = await nativeWalk!.walkFilesWithMtime(nativePath, {
				recursively,
				token,
				onWarning: (message) => Logger.warn(message),
			});
			return walked.map((entry) => ({
				relativePath: entry.relativePath,
				// The real path, not a hoi4installpath: one: whoever reads this file next should reach
				// the disk directly rather than back through the provider.
				uri: vscode.Uri.file(entry.fsPath),
				mtime: entry.mtime,
			}));
		} catch (cause) {
			if (cause instanceof CancelledError || !isMissingPathError(cause)) {
				throw cause;
			}
			// The folder went away between the probe that found it and the walk, or -- in the unit
			// tests -- its fsPath was never a real path to begin with. vscode.workspace.fs is the thing
			// that can still answer, and answering is what this did before there was a native walk.
		}
	}

	const names = recursively
		? await readDirFilesRecursively(dir)
		: await readDirFiles(dir);
	// No mtimes: readDirectory reports names and types only, so dating these costs a stat each and is
	// left to the caller, which knows whether it needs them at all. Symlinked entries are dropped here
	// and kept by the native walk -- vscode.FileType reports them as File|SymbolicLink, which matches
	// neither value readDirFilesRecursively tests for.
	return names.map((relativePath) => ({
		relativePath,
		uri: vscode.Uri.joinPath(dir, relativePath),
		mtime: undefined,
	}));
}

/** The path on this disk a listing directory maps to, or undefined when there is not one to walk. */
function toNativeWalkPath(dir: vscode.Uri): string | undefined {
	if (dir.scheme === Hoi4FsSchema) {
		// Resolve the install path to a real path once per listing, so the walk never re-enters the
		// hoi4installpath: FileSystemProvider -- which only calls vscode.workspace.fs again, making
		// every vanilla stat two extension-host hops instead of one syscall.
		let installPath: vscode.Uri;
		try {
			installPath = getInstallPathUri();
		} catch {
			return undefined; // not configured at all: UserError
		}
		if (!isFileScheme(installPath) || !installPath.fsPath) {
			return undefined;
		}
		return path.join(installPath.fsPath, trimStart(dir.path, "/"));
	}

	// Anything else -- a remote workspace, vsls:, untitled: -- has no path on this disk.
	return isFileScheme(dir) && dir.fsPath ? dir.fsPath : undefined;
}

function isMissingPathError(cause: unknown): boolean {
	const code = (cause as { code?: unknown } | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

async function lastModifiedOrUndefined(
	uri: vscode.Uri,
): Promise<number | undefined> {
	try {
		return await getLastModifiedAsync(uri);
	} catch {
		return undefined;
	}
}

interface FileSourceVisitor {
	/** A directory of this source that exists and could hold the requested folder. */
	directory(dir: vscode.Uri, listFailureMessage: string): Promise<void>;
	/**
	 * A DLC archive whose `normalizedPath` entry exists and is a directory. Always a flat listing:
	 * `DlcZip.listDir` returns the basenames directly under that entry and nothing below them, even
	 * when the caller asked for a recursive listing.
	 */
	dlcZip(
		zip: DlcZip,
		zipUri: vscode.Uri,
		normalizedPath: string,
	): Promise<void>;
}

/**
 * Walks the mod, HOI4 and DLC sources that could hold `relativePath`, in the same order
 * getFilePathFromModOrHOI4 resolves them, handing each one that exists to `visitor` -- awaited and in
 * order, because for a listing the first occurrence of a name is the one that wins.
 *
 * Both listings share this rather than each spelling the precedence out for itself. If they ever
 * disagreed about which source a name came from, an index would record one file's mtime and read
 * another file's contents, and stay quietly stale for as long as neither changed.
 *
 * Returns whether the caller should deduplicate what it collected. Every exit says yes except the one
 * `options.hoi4 === false` takes, which has always handed back its raw result -- so two workspace
 * folders holding the same relative path still list it twice there, exactly as before.
 */
async function visitFileSources(
	relativePath: string,
	options: ListFilesOptions | null | undefined,
	visitor: FileSourceVisitor,
): Promise<boolean> {
	relativePath = relativePath.replace(/\/\/+|\\+/g, "/");

	if (options?.mod !== false) {
		// Find in opened workspace folders
		if (vscode.workspace.workspaceFolders) {
			for (const folder of vscode.workspace.workspaceFolders) {
				const findPath = vscode.Uri.joinPath(folder.uri, relativePath);
				if (await isDirectory(findPath)) {
					await visitor.directory(
						findPath,
						`Failed to list workspace files in ${findPath}`,
					);
				}
			}
		}

		const replacePaths = await getReplacePaths();
		if (replacePaths) {
			for (const replacePath of replacePaths) {
				if (isSamePath(relativePath, replacePath)) {
					return true;
				}
			}
		}
	}

	if (options?.hoi4 === false) {
		return false;
	}

	// Find in HOI4 install path
	const conf = getConfiguration();
	const installPath = vscode.Uri.parse(Hoi4FsSchema + ":/");
	{
		const findPath = vscode.Uri.joinPath(installPath, relativePath);
		if (await isDirectory(findPath)) {
			await visitor.directory(
				findPath,
				`Failed to list HOI4 files in ${findPath}`,
			);
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
					await visitor.dlcZip(dlcZip, dlc, relativePath);
				}
			}
		}

		const dlcFolders = await dlcPathsCache.get(installPath.toString());
		if (dlcFolders !== null) {
			for (const dlc of dlcFolders) {
				const findPath = vscode.Uri.joinPath(dlc, relativePath);
				if (await isDirectory(findPath)) {
					await visitor.directory(
						findPath,
						`Failed to list DLC files in ${findPath}`,
					);
				}
			}
		}
	}

	return true;
}

async function mapDlcFolders<T>(
	installPath: string,
	map: (dlcFolder: vscode.Uri, dlcFolderName: string) => Promise<T | null>,
): Promise<T[] | null> {
	const root = vscode.Uri.parse(installPath);
	const dlcRoots = (
		await Promise.all(
			dlcRootFolders.map(async (dlcRootFolder) => {
				const dlcPath = vscode.Uri.joinPath(root, dlcRootFolder);
				return (await isDirectory(dlcPath)) ? dlcPath : null;
			}),
		)
	).filter((dlcPath): dlcPath is vscode.Uri => dlcPath !== null);

	if (dlcRoots.length === 0) {
		return null;
	}

	const results: (T | null)[][] = await Promise.all(
		dlcRoots.map(async (dlcPath) => {
			const dlcFolders = await readDir(dlcPath);
			return await Promise.all(
				dlcFolders.map((dlcFolder) =>
					map(vscode.Uri.joinPath(dlcPath, dlcFolder), dlcFolder),
				),
			);
		}),
	);

	return results.flat().filter((result): result is T => result !== null);
}

function getDlcZipPaths(installPath: string): Promise<vscode.Uri[] | null> {
	return mapDlcFolders(installPath, async (dlcZipFolder) => {
		if (await isDirectory(dlcZipFolder)) {
			const files = await readDir(dlcZipFolder);
			const zipFile = files.find((file) => file.endsWith(".zip"));
			if (zipFile) {
				return vscode.Uri.joinPath(dlcZipFolder, zipFile);
			}
		}

		return null;
	});
}

function getDlcPaths(installPath: string): Promise<vscode.Uri[] | null> {
	return mapDlcFolders(installPath, async (dlcZipFolder, dlcFolder) => {
		if ((await isDirectory(dlcZipFolder)) && dlcFolder.startsWith("dlc")) {
			return dlcZipFolder;
		}

		return null;
	});
}

const replacePathsCache = new PromiseCache({
	factory: getReplacePathsFromModFile,
	expireWhenChange: (key) => getLastModifiedAsync(vscode.Uri.parse(key)),
	life: 60 * 1000,
});

interface ModFile {
	replace_path: string[];
}

const modListSchema: SchemaDef<ModFile> = {
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
				const mods = await workspaceModFilesCache.get(
					workspaceFolderPath.toString(),
				);
				if (mods.length > 0) {
					modFile = mods[0];
					break;
				}
			}
		}
	}

	try {
		if (modFile && (await isFile(modFile))) {
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

async function getReplacePathsFromModFile(
	absolutePath: string,
): Promise<string[]> {
	const content = (await readFile(vscode.Uri.parse(absolutePath))).toString();
	const node = parseHoi4File(
		content,
		localize("infile", "In file {0}:\n", absolutePath),
	);
	const modFile = convertNodeToJson<ModFile>(node, modListSchema);
	return modFile.replace_path.filter((v): v is string => typeof v === "string");
}
