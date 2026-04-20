"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IndexTimer = void 0;
exports.saveCacheManifest = saveCacheManifest;
exports.loadCacheManifest = loadCacheManifest;
exports.saveCacheData = saveCacheData;
exports.loadCacheData = loadCacheData;
exports.getFileMtimes = getFileMtimes;
exports.computeStaleFiles = computeStaleFiles;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const context_1 = require("../context");
const logger_1 = require("./logger");
const vsccommon_1 = require("./vsccommon");
const MTIME_BATCH_SIZE = 30;
function getCacheDir() {
    const ctx = context_1.contextContainer.current;
    if (!ctx || IS_WEB_EXT) {
        return null;
    }
    return vscode.Uri.joinPath(ctx.globalStorageUri, 'indexCache');
}
let cacheDirPromise = null;
function ensureCacheDir() {
    if (!cacheDirPromise) {
        cacheDirPromise = (async () => {
            const dir = getCacheDir();
            if (!dir) {
                return null;
            }
            try {
                await (0, vsccommon_1.mkdirs)(dir);
            }
            catch { }
            return dir;
        })();
    }
    return cacheDirPromise;
}
async function saveCacheManifest(indexName, filePaths, mtimes, version) {
    const dir = await ensureCacheDir();
    if (!dir) {
        return;
    }
    try {
        const manifest = {
            version,
            entries: filePaths.map(fp => ({ filePath: fp, mtime: mtimes.get(fp) ?? 0 })),
        };
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        await (0, vsccommon_1.writeFile)(uri, Buffer.from(JSON.stringify(manifest)));
    }
    catch (e) {
        logger_1.Logger.error(`Failed to save cache manifest for ${indexName}: ${e}`);
    }
}
async function loadCacheManifest(indexName, expectedVersion) {
    const dir = getCacheDir();
    if (!dir) {
        return null;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.manifest.json`);
        const data = (await (0, vsccommon_1.readFile)(uri)).toString();
        const manifest = JSON.parse(data);
        if (manifest.version !== expectedVersion) {
            return null;
        }
        return manifest;
    }
    catch {
        return null;
    }
}
async function saveCacheData(indexName, data) {
    const dir = await ensureCacheDir();
    if (!dir) {
        return;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        await (0, vsccommon_1.writeFile)(uri, Buffer.from(data));
    }
    catch (e) {
        logger_1.Logger.error(`Failed to save cache data for ${indexName}: ${e}`);
    }
}
async function loadCacheData(indexName) {
    const dir = getCacheDir();
    if (!dir) {
        return null;
    }
    try {
        const uri = vscode.Uri.joinPath(dir, `${indexName}.data.json`);
        return (await (0, vsccommon_1.readFile)(uri)).toString();
    }
    catch {
        return null;
    }
}
async function getFileMtimes(relativePaths, resolveUri) {
    const result = new Map();
    for (let i = 0; i < relativePaths.length; i += MTIME_BATCH_SIZE) {
        const batch = relativePaths.slice(i, i + MTIME_BATCH_SIZE);
        await Promise.all(batch.map(async (relativePath) => {
            try {
                const uri = await resolveUri(relativePath);
                if (uri) {
                    result.set(relativePath, await (0, vsccommon_1.getLastModifiedAsync)(uri));
                }
            }
            catch {
                // File doesn't exist or is inaccessible
            }
        }));
    }
    return result;
}
class IndexTimer {
    name;
    start;
    lastMark;
    phases = [];
    constructor(name) {
        this.name = name;
        this.start = Date.now();
        this.lastMark = this.start;
    }
    mark(phaseName) {
        const now = Date.now();
        this.phases.push({ name: phaseName, ms: now - this.lastMark });
        this.lastMark = now;
    }
    log(fileCount, parsedCount) {
        const total = Date.now() - this.start;
        const breakdown = this.phases.map(p => `${p.name}=${p.ms}ms`).join(', ');
        logger_1.Logger.info(`[Timer] ${this.name}: ${total}ms total (${breakdown}) | ${fileCount} files, ${parsedCount} parsed`);
    }
}
exports.IndexTimer = IndexTimer;
function computeStaleFiles(manifest, currentMtimes) {
    const cachedPaths = new Set(manifest.entries.map(e => e.filePath));
    const currentPaths = new Set(currentMtimes.keys());
    const stale = [];
    const removed = [];
    const added = [];
    for (const entry of manifest.entries) {
        if (!currentPaths.has(entry.filePath)) {
            removed.push(entry.filePath);
        }
        else {
            const currentMtime = currentMtimes.get(entry.filePath);
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
//# sourceMappingURL=indexCache.js.map