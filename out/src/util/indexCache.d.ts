import * as vscode from 'vscode';
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
export declare function saveCacheManifest(indexName: string, filePaths: string[], mtimes: Map<string, number>, version: number): Promise<void>;
export declare function loadCacheManifest(indexName: string, expectedVersion: number): Promise<CacheManifest | null>;
export declare function saveCacheData(indexName: string, data: string): Promise<void>;
export declare function loadCacheData(indexName: string): Promise<string | null>;
export declare function getFileMtimes(relativePaths: string[], resolveUri: (relativePath: string) => Promise<vscode.Uri | undefined>): Promise<Map<string, number>>;
export declare class IndexTimer {
    private readonly name;
    private readonly start;
    private lastMark;
    private readonly phases;
    constructor(name: string);
    mark(phaseName: string): void;
    log(fileCount: number, parsedCount: number): void;
}
export declare function computeStaleFiles(manifest: CacheManifest, currentMtimes: Map<string, number>): StalenessResult;
export {};
