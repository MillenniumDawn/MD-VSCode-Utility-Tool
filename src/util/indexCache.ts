import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { Logger } from './logger';
import { fnv1a64Hex } from './hash';
import { readFile, writeFile, mkdirs, getLastModifiedAsync, getConfiguration, uriToFilePathWhenPossible } from './vsccommon';
import { getParentModUris } from './parentmods';
import { createTimeSlicer, mapLimit } from './common';

interface CacheManifest {
    version: number;
    entries: CacheFileEntry[];
}

interface CacheFileEntry {
    filePath: string;
    mtime: number;
}

export interface StalenessResult {
    stale: string[];
    removed: string[];
    added: string[];
}

const MTIME_CONCURRENCY = 32;

const CACHE_ROOT = 'indexCache';

/**
 * A short, stable name for "the thing being indexed", so two mods opened in the same VS Code
 * profile get two caches instead of overwriting each other's.
 *
 * The identity is the selected `modFile` plus the workspace folders, sorted, so reordering the
 * folders does not invalidate anything, plus the parent mod paths in setting order, because there
 * the order is the precedence. A plain FNV-1a hash rather than `node:crypto`, because this module
 * is loaded in the web build too (where it never reaches disk at all) and because a collision
 * costs no more than two mods sharing one cache -- which is exactly today's behaviour.
 *
 * The vanilla (`.global`) halves are namespaced along with the mod's, so a second mod rebuilds them
 * once. That is a few seconds of the shared parse queue, and it buys one identity rule instead of
 * two.
 */
function normalizePathIdentity(value: string): string {
    const normalized = value.replace(/\\+/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function cacheNamespaceFor(
    modFile: string | undefined,
    workspaceFolderUris: readonly string[],
    parentModPaths: readonly string[] = [],
): string {
    const parts: string[] = [];

    const mod = modFile?.trim();
    if (mod) {
        parts.push('mod:' + normalizePathIdentity(mod));
    }

    // Sorted, so that dragging a folder up the explorer does not throw the cache away.
    for (const uri of [...workspaceFolderUris].sort()) {
        parts.push('ws:' + uri);
    }

    for (const parent of parentModPaths) {
        const trimmed = parent.trim();
        if (trimmed) {
            parts.push('parent:' + normalizePathIdentity(trimmed));
        }
    }

    return fnv1a64Hex(parts.join('\n'));
}


/** The inputs to `cacheNamespaceFor`, each read defensively -- none is worth failing over. */
function cacheNamespace(parentModUris?: readonly vscode.Uri[]): string {
    let modFile: string | undefined;
    let parentModPaths: string[] = [];
    try {
        const conf = getConfiguration();
        modFile = conf.modFile as string | undefined;
        // The effective list, dependencies included: two `.mod` files that resolve differently
        // under the same setting must not share a cache. A supplied list is the snapshot captured
        // by an index build, so a later dependency refresh cannot mix its namespace with its files.
        parentModPaths = (parentModUris ?? getParentModUris())
            .map(uriToFilePathWhenPossible);
    } catch {
        modFile = undefined;
        parentModPaths = [];
    }

    let folders: string[] = [];
    try {
        folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.toString());
    } catch {
        folders = [];
    }

    return cacheNamespaceFor(modFile, folders, parentModPaths);
}

export type CacheScope = vscode.Uri | null;

export function captureCacheScope(
    parentModUris?: readonly vscode.Uri[],
): CacheScope {
    const ctx = contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return null;
    }
    return vscode.Uri.joinPath(ctx.globalStorageUri, CACHE_ROOT, cacheNamespace(parentModUris));
}

// Keyed on the directory rather than memoized once, because the namespace can change inside a
// session: a workspace folder is added, or the `modFile` setting is pointed at another mod.
const cacheDirPromises = new Map<string, Promise<vscode.Uri | null>>();

export function ensureCacheDir(scope: CacheScope = captureCacheScope()): Promise<vscode.Uri | null> {
    const dir = scope;
    if (!dir) {
        return Promise.resolve(null);
    }

    const key = dir.toString();
    let pending = cacheDirPromises.get(key);
    if (!pending) {
        pending = (async () => {
            try { await mkdirs(dir); } catch {}
            // One line per namespace, so a bug report about the wrong cache says which one it used.
            Logger.info(`[Index] cache directory: ${dir.fsPath}`);
            void removeUnnamespacedCaches();
            void removeSingleDocumentCaches(dir);
            return dir;
        })();
        cacheDirPromises.set(key, pending);
    }
    return pending;
}

let removedUnnamespacedCaches = false;

/**
 * The caches written before the namespacing above sit loose in `indexCache/` under names no one
 * reads any more. Delete them once per session rather than leaving them on disk forever. The
 * namespaces are directories, so only files are touched, and every part of this is best-effort:
 * a cache tidy-up must never be able to fail a build.
 */
async function removeUnnamespacedCaches(): Promise<void> {
    if (removedUnnamespacedCaches) {
        return;
    }
    removedUnnamespacedCaches = true;

    const ctx = contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return;
    }

    try {
        const root = vscode.Uri.joinPath(ctx.globalStorageUri, CACHE_ROOT);
        const entries = await vscode.workspace.fs.readDirectory(root);
        let removed = 0;
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !name.endsWith('.json')) {
                continue;
            }
            try {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, name));
                removed++;
            } catch {}
        }
        if (removed > 0) {
            Logger.info(`[Index] removed ${removed} cache file(s) written before caches were per-mod.`);
        }
    } catch {
        // No cache directory yet, or no delete support -- either way there is nothing to clean.
    }
}

/**
 * The data files written before the line-per-record format, as `<index>.data.json`. Nothing reads
 * them any more, and the localisation one alone could run to hundreds of megabytes, so they go the
 * first time a session touches their namespace. Best-effort, like the tidy-up above.
 */
async function removeSingleDocumentCaches(dir: vscode.Uri): Promise<void> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.File || !name.endsWith('.data.json')) {
                continue;
            }
            try {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, name));
            } catch {}
        }
    } catch {
        // Nothing listed, nothing to remove.
    }
}

export async function saveCacheManifest(indexName: string, filePaths: string[], mtimes: Map<string, number>, version: number, scope?: CacheScope): Promise<void> {
    const dir = await ensureCacheDir(scope);
    if (!dir) { return; }
    try {
        const manifest: CacheManifest = {
            version,
            entries: filePaths.map(fp => ({ filePath: fp, mtime: mtimes.get(fp) ?? 0 })),
        };
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        await writeFile(uri, Buffer.from(JSON.stringify(manifest)));
    } catch (e) {
        Logger.error(`Failed to save cache manifest for ${indexName}: ${e}`);
        throw e;
    }
}

export async function loadCacheManifest(indexName: string, expectedVersion: number, scope?: CacheScope): Promise<CacheManifest | null> {
    const dir = scope === undefined ? captureCacheScope() : scope;
    if (!dir) { return null; }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        const data = (await readFile(uri)).toString();
        const manifest: CacheManifest = JSON.parse(data);
        if (manifest.version !== expectedVersion) { return null; }
        return manifest;
    } catch {
        return null;
    }
}

/*
 * The data file is one JSON record per line, then a last line holding the record count.
 *
 * It used to be the whole index as a single JSON document, stringified and parsed in one
 * synchronous call each way. On a mod the size of Millennium Dawn that was one string of hundreds
 * of megabytes, which held the extension host for seconds and at the top end ran past V8's maximum
 * string length. Line by line, no string is larger than one record, and both directions hand the
 * event loop back between slices.
 *
 * The count is what makes a write cut short detectable: a file truncated exactly at a line
 * boundary still parses line for line, and without it the build would trust a cache that silently
 * lost the files at its end.
 */
const CACHE_DATA_EXTENSION = '.data.jsonl';
const CACHE_WRITE_CHUNK = 1024 * 1024;
const NEWLINE = 0x0a;

export async function saveCacheRecords(indexName: string, records: readonly unknown[], scope?: CacheScope): Promise<void> {
    const dir = await ensureCacheDir(scope);
    if (!dir) { return; }
    try {
        const slice = createTimeSlicer();
        const chunks: Buffer[] = [];
        let lines: string[] = [];
        let pendingLength = 0;
        for (const record of records) {
            const line = JSON.stringify(record);
            lines.push(line);
            pendingLength += line.length + 1;
            if (pendingLength >= CACHE_WRITE_CHUNK) {
                chunks.push(Buffer.from(lines.join('\n') + '\n'));
                lines = [];
                pendingLength = 0;
            }
            await slice();
        }
        lines.push(String(records.length));
        chunks.push(Buffer.from(lines.join('\n') + '\n'));

        const uri = vscode.Uri.joinPath(dir, `${indexName}${CACHE_DATA_EXTENSION}`);
        await writeFile(uri, Buffer.concat(chunks));
    } catch (e) {
        Logger.error(`Failed to save cache data for ${indexName}: ${e}`);
        throw e;
    }
}

/**
 * The cached records, or null when there is no data file to read. Throws when the file is there but
 * is not a complete cache -- a line that does not parse, or a count that is missing or wrong.
 */
export async function loadCacheRecords(indexName: string, scope?: CacheScope): Promise<unknown[] | null> {
    const dir = scope === undefined ? captureCacheScope() : scope;
    if (!dir) { return null; }
    let data: Buffer;
    try {
        data = await readFile(vscode.Uri.joinPath(dir, `${indexName}${CACHE_DATA_EXTENSION}`));
    } catch {
        return null;
    }

    // Splitting on the newline byte is safe: JSON escapes newlines inside strings, and no byte of a
    // multi-byte UTF-8 sequence is 0x0A.
    const slice = createTimeSlicer();
    const lines: unknown[] = [];
    let start = 0;
    while (start < data.length) {
        let end = data.indexOf(NEWLINE, start);
        if (end < 0) {
            end = data.length;
        }
        if (end > start) {
            lines.push(JSON.parse(data.toString('utf8', start, end)));
        }
        start = end + 1;
        await slice();
    }

    const count = lines.pop();
    if (typeof count !== 'number' || count !== lines.length) {
        throw new Error(`${indexName}: cache data is incomplete`);
    }
    return lines;
}

export async function getFileMtimes(relativePaths: string[], resolveUri: (relativePath: string) => Promise<vscode.Uri | undefined>): Promise<Map<string, number>> {
    // A worker pool rather than fixed waves: a wave waited for its slowest stat before the next
    // one started, so one slow file idled the other 29 slots.
    const mtimes = await mapLimit(relativePaths, MTIME_CONCURRENCY, async (relativePath) => {
        try {
            const uri = await resolveUri(relativePath);
            return uri ? await getLastModifiedAsync(uri) : undefined;
        } catch {
            // File doesn't exist or is inaccessible
            return undefined;
        }
    });
    const result = new Map<string, number>();
    for (let i = 0; i < relativePaths.length; i++) {
        const mtime = mtimes[i];
        if (mtime !== undefined) {
            result.set(relativePaths[i]!, mtime);
        }
    }
    return result;
}

/** Every timer that has begun a phase and not finished yet, for the heartbeat and the status report. */
const liveTimers = new Set<IndexTimer>();
const HEARTBEAT_INTERVAL = 15 * 1000;
let heartbeat: NodeJS.Timeout | null = null;

function startHeartbeat(): void {
    if (heartbeat) {
        return;
    }
    heartbeat = setInterval(() => {
        if (liveTimers.size === 0) {
            stopHeartbeat();
            return;
        }
        Logger.info(`[Index] still working: ${describeLiveIndexBuilds().join('; ')}`);
    }, HEARTBEAT_INTERVAL);
    // Never hold the host process open just to print progress.
    (heartbeat as unknown as { unref?: () => void }).unref?.();
}

function stopHeartbeat(): void {
    if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
    }
}

/**
 * One line per index build currently in flight, e.g.
 * `ideaSwapIndex.workspace phase=parse 1240/3850 for 12s`. A build that finishes normally logs its
 * own breakdown; this is what makes a build that *doesn't* finish diagnosable.
 */
export function describeLiveIndexBuilds(): string[] {
    return [...liveTimers].map(t => t.describe());
}

export class IndexTimer {
    private readonly name: string;
    private readonly start: number;
    private lastMark: number;
    private readonly phases: { name: string; ms: number }[] = [];
    private currentPhase: string | undefined;
    private done = 0;
    private total = 0;

    constructor(name: string) {
        this.name = name;
        this.start = Date.now();
        this.lastMark = this.start;
    }

    /** Closes the phase that was running (recording its duration) and opens `phaseName`. */
    begin(phaseName: string): void {
        this.closeCurrentPhase();
        this.currentPhase = phaseName;
        this.done = 0;
        this.total = 0;
        liveTimers.add(this);
        startHeartbeat();
    }

    /** Progress within the current phase, surfaced by the heartbeat and the status report. */
    progress(done: number, total: number): void {
        this.done = done;
        this.total = total;
    }

    describe(): string {
        const elapsed = Math.round((Date.now() - this.start) / 1000);
        const counts = this.total > 0 ? ` ${this.done}/${this.total}` : '';
        return `${this.name} phase=${this.currentPhase ?? 'none'}${counts} for ${elapsed}s`;
    }

    /** Closes the last phase, logs the breakdown, and takes this timer out of the live set. */
    end(fileCount: number, parsedCount: number): void {
        this.closeCurrentPhase();
        this.dispose();
        const total = Date.now() - this.start;
        const breakdown = this.phases.map(p => `${p.name}=${p.ms}ms`).join(', ');
        Logger.info(`[Timer] ${this.name}: ${total}ms total (${breakdown}) | ${fileCount} files, ${parsedCount} parsed`);
    }

    /** Stops tracking this build without logging, for the failure path. Safe to call twice. */
    dispose(): void {
        this.currentPhase = undefined;
        liveTimers.delete(this);
        if (liveTimers.size === 0) {
            stopHeartbeat();
        }
    }

    private closeCurrentPhase(): void {
        const now = Date.now();
        if (this.currentPhase !== undefined) {
            this.phases.push({ name: this.currentPhase, ms: now - this.lastMark });
        }
        this.lastMark = now;
    }
}

export function computeStaleFiles(manifest: CacheManifest, currentMtimes: Map<string, number>): StalenessResult {
    const cachedPaths = new Set(manifest.entries.map(e => e.filePath));
    const currentPaths = new Set(currentMtimes.keys());

    const stale: string[] = [];
    const removed: string[] = [];
    const added: string[] = [];

    for (const entry of manifest.entries) {
        if (!currentPaths.has(entry.filePath)) {
            removed.push(entry.filePath);
        } else {
            const currentMtime = currentMtimes.get(entry.filePath)!;
            if (currentMtime !== entry.mtime) {
                stale.push(entry.filePath);
            }
        }
    }

    for (const filePath of currentPaths) {
        if (!cachedPaths.has(filePath)) {
            added.push(filePath);
        }
    }

    return { stale, removed, added };
}
