import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { Logger } from './logger';
import { fnv1a64Hex } from './hash';
import { readFile, writeFile, mkdirs, getLastModifiedAsync, getConfiguration } from './vsccommon';

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

const MTIME_BATCH_SIZE = 30;

const CACHE_ROOT = 'indexCache';

/**
 * A short, stable name for "the thing being indexed", so two mods opened in the same VS Code
 * profile get two caches instead of overwriting each other's.
 *
 * The identity is the selected `modFile` plus the workspace folders, sorted, so reordering the
 * folders does not invalidate anything. A plain FNV-1a hash rather than `node:crypto`, because this
 * module is loaded in the web build too (where it never reaches disk at all) and because a collision
 * costs no more than two mods sharing one cache -- which is exactly today's behaviour.
 *
 * The vanilla (`.global`) halves are namespaced along with the mod's, so a second mod rebuilds them
 * once. That is a few seconds of the shared parse queue, and it buys one identity rule instead of
 * two.
 */
export function cacheNamespaceFor(modFile: string | undefined, workspaceFolderUris: readonly string[]): string {
    const parts: string[] = [];

    const mod = modFile?.trim();
    if (mod) {
        parts.push('mod:' + mod.replace(/\\+/g, '/').toLowerCase());
    }

    // Sorted, so that dragging a folder up the explorer does not throw the cache away.
    for (const uri of [...workspaceFolderUris].sort()) {
        parts.push('ws:' + uri);
    }

    return fnv1a64Hex(parts.join('\n'));
}


/** The two inputs to `cacheNamespaceFor`, each read defensively -- neither is worth failing over. */
function cacheNamespace(): string {
    let modFile: string | undefined;
    try {
        modFile = getConfiguration().modFile as string | undefined;
    } catch {
        modFile = undefined;
    }

    let folders: string[] = [];
    try {
        folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.toString());
    } catch {
        folders = [];
    }

    return cacheNamespaceFor(modFile, folders);
}

function getCacheDir(): vscode.Uri | null {
    const ctx = contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return null;
    }
    return vscode.Uri.joinPath(ctx.globalStorageUri, CACHE_ROOT, cacheNamespace());
}

// Keyed on the directory rather than memoized once, because the namespace can change inside a
// session: a workspace folder is added, or the `modFile` setting is pointed at another mod.
const cacheDirPromises = new Map<string, Promise<vscode.Uri | null>>();

function ensureCacheDir(): Promise<vscode.Uri | null> {
    const dir = getCacheDir();
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

export async function saveCacheManifest(indexName: string, filePaths: string[], mtimes: Map<string, number>, version: number): Promise<void> {
    const dir = await ensureCacheDir();
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
    }
}

export async function loadCacheManifest(indexName: string, expectedVersion: number): Promise<CacheManifest | null> {
    const dir = getCacheDir();
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

export async function saveCacheData(indexName: string, data: string): Promise<void> {
    const dir = await ensureCacheDir();
    if (!dir) { return; }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        await writeFile(uri, Buffer.from(data));
    } catch (e) {
        Logger.error(`Failed to save cache data for ${indexName}: ${e}`);
    }
}

export async function loadCacheData(indexName: string): Promise<string | null> {
    const dir = getCacheDir();
    if (!dir) { return null; }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        return (await readFile(uri)).toString();
    } catch {
        return null;
    }
}

export async function getFileMtimes(relativePaths: string[], resolveUri: (relativePath: string) => Promise<vscode.Uri | undefined>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (let i = 0; i < relativePaths.length; i += MTIME_BATCH_SIZE) {
        const batch = relativePaths.slice(i, i + MTIME_BATCH_SIZE);
        await Promise.all(batch.map(async (relativePath) => {
            try {
                const uri = await resolveUri(relativePath);
                if (uri) {
                    result.set(relativePath, await getLastModifiedAsync(uri));
                }
            } catch {
                // File doesn't exist or is inaccessible
            }
        }));
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
