import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { Logger } from './logger';

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

function getCacheDir(): vscode.Uri | null {
    const ctx = contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return null;
    }
    return vscode.Uri.joinPath(ctx.globalStorageUri, 'indexCache');
}

async function ensureCacheDir(): Promise<vscode.Uri | null> {
    const dir = getCacheDir();
    if (!dir) {
        return null;
    }
    try {
        await vscode.workspace.fs.createDirectory(dir);
    } catch {
        // Directory may already exist
    }
    return dir;
}

export async function saveCacheManifest(indexName: string, filePaths: string[], mtimes: Map<string, number>, version: number): Promise<void> {
    const dir = await ensureCacheDir();
    if (!dir) {
        return;
    }
    try {
        const manifest: CacheManifest = {
            version,
            entries: filePaths.map(fp => ({ filePath: fp, mtime: mtimes.get(fp) ?? 0 })),
        };
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(manifest)));
    } catch (e) {
        Logger.error(`Failed to save cache manifest for ${indexName}: ${e}`);
    }
}

export async function loadCacheManifest(indexName: string, expectedVersion: number): Promise<CacheManifest | null> {
    const dir = getCacheDir();
    if (!dir) {
        return null;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        const data = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
        const manifest: CacheManifest = JSON.parse(data);
        if (manifest.version !== expectedVersion) {
            return null;
        }
        return manifest;
    } catch {
        return null;
    }
}

export async function saveCacheData(indexName: string, data: string): Promise<void> {
    const dir = await ensureCacheDir();
    if (!dir) {
        return;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(data));
    } catch (e) {
        Logger.error(`Failed to save cache data for ${indexName}: ${e}`);
    }
}

export async function loadCacheData(indexName: string): Promise<string | null> {
    const dir = getCacheDir();
    if (!dir) {
        return null;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
    } catch {
        return null;
    }
}

export async function getFileMtimes(relativePaths: string[], resolveUri: (relativePath: string) => Promise<vscode.Uri | undefined>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await Promise.all(relativePaths.map(async (relativePath) => {
        try {
            const uri = await resolveUri(relativePath);
            if (uri) {
                const stat = await vscode.workspace.fs.stat(uri);
                result.set(relativePath, stat.mtime);
            }
        } catch {
            // File doesn't exist or is inaccessible
        }
    }));
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
