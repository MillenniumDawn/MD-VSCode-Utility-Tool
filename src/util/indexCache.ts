import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { Logger } from './logger';
import { readFile, writeFile, mkdirs, getLastModifiedAsync } from './vsccommon';

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

function getCacheDir(): vscode.Uri | null {
    const ctx = contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return null;
    }
    return vscode.Uri.joinPath(ctx.globalStorageUri, 'indexCache');
}

let cacheDirPromise: Promise<vscode.Uri | null> | null = null;

function ensureCacheDir(): Promise<vscode.Uri | null> {
    if (!cacheDirPromise) {
        cacheDirPromise = (async () => {
            const dir = getCacheDir();
            if (!dir) { return null; }
            try { await mkdirs(dir); } catch {}
            return dir;
        })();
    }
    return cacheDirPromise;
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
