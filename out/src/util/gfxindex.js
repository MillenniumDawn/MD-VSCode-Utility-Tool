"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGfxIndex = registerGfxIndex;
exports.getGfxContainerFile = getGfxContainerFile;
exports.getGfxContainerFiles = getGfxContainerFiles;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
const hoiparser_1 = require("../hoiformat/hoiparser");
const spritetype_1 = require("../hoiformat/spritetype");
const common_1 = require("./common");
const debug_1 = require("./debug");
const featureflags_1 = require("./featureflags");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const lodash_1 = require("lodash");
const telemetry_1 = require("./telemetry");
const logger_1 = require("./logger");
const indexCache_1 = require("./indexCache");
const globalGfxIndex = {};
let workspaceGfxIndex = {};
// Reverse map for O(1) removal: file path -> sprite names from that file
const workspaceGfxFileToKeys = new Map();
function registerGfxIndex() {
    const disposables = [];
    if (featureflags_1.gfxIndex) {
        const estimatedSize = [0];
        const task = Promise.all([buildGlobalGfxIndex(estimatedSize), buildWorkspaceGfxIndex(estimatedSize)]);
        vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('gfxindex.building', 'Building GFX index...'), task);
        task.then(() => {
            vscode.window.showInformationMessage((0, i18n_1.localize)('gfxindex.builddone', 'Building GFX index done.'));
            (0, telemetry_1.sendEvent)('gfxIndex', { size: estimatedSize[0].toString() });
        });
        disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders));
        disposables.push(vscode.workspace.onDidChangeTextDocument(onChangeTextDocument));
        disposables.push(vscode.workspace.onDidCloseTextDocument(onCloseTextDocument));
        disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
        disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
        disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
    }
    return vscode.Disposable.from(...disposables);
}
async function getGfxContainerFile(gfxName) {
    if (!featureflags_1.gfxIndex || !gfxName) {
        return undefined;
    }
    return (globalGfxIndex[gfxName] ?? workspaceGfxIndex[gfxName])?.file;
}
async function getGfxContainerFiles(gfxNames) {
    return (0, lodash_1.uniq)((await Promise.all(gfxNames.map(getGfxContainerFile))).filter((v) => v !== undefined));
}
const GFX_CACHE_VERSION = 1;
async function buildGlobalGfxIndex(estimatedSize) {
    const options = { mod: false, recursively: true };
    const gfxFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx')).map(f => 'interface/' + f);
    await buildGfxIndexWithCache('gfxIndex.global', gfxFiles, globalGfxIndex, null, options, estimatedSize);
}
async function buildWorkspaceGfxIndex(estimatedSize) {
    const options = { hoi4: false, recursively: true };
    const gfxFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx')).map(f => 'interface/' + f);
    await buildGfxIndexWithCache('gfxIndex.workspace', gfxFiles, workspaceGfxIndex, workspaceGfxFileToKeys, options, estimatedSize);
}
async function buildGfxIndexWithCache(cacheName, gfxFiles, targetIndex, fileToKeysMap, options, estimatedSize) {
    const timer = new indexCache_1.IndexTimer(cacheName);
    const resolveUri = (relativePath) => (0, fileloader_1.getFilePathFromModOrHOI4)(relativePath, options);
    const currentMtimes = await (0, indexCache_1.getFileMtimes)(gfxFiles, resolveUri);
    timer.mark('mtime');
    const manifest = await (0, indexCache_1.loadCacheManifest)(cacheName, GFX_CACHE_VERSION);
    let filesToParse = gfxFiles;
    if (manifest) {
        const staleness = (0, indexCache_1.computeStaleFiles)(manifest, currentMtimes);
        const cachedData = await (0, indexCache_1.loadCacheData)(cacheName);
        if (cachedData && staleness.stale.length + staleness.removed.length + staleness.added.length < gfxFiles.length) {
            try {
                const cached = JSON.parse(cachedData);
                const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
                for (const spriteName in cached.index) {
                    const item = cached.index[spriteName];
                    if (item && !skipFiles.has(item.file)) {
                        targetIndex[spriteName] = item;
                    }
                }
                if (fileToKeysMap && cached.fileToKeys) {
                    for (const file in cached.fileToKeys) {
                        if (!skipFiles.has(file)) {
                            fileToKeysMap.set(file, cached.fileToKeys[file]);
                        }
                    }
                }
                filesToParse = [...staleness.stale, ...staleness.added];
            }
            catch {
                logger_1.Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
                filesToParse = gfxFiles;
            }
        }
    }
    timer.mark('cache');
    await Promise.all(filesToParse.map(f => fillGfxItems(f, targetIndex, fileToKeysMap, options, estimatedSize)));
    timer.mark('parse');
    timer.log(gfxFiles.length, filesToParse.length);
    const serializedFileToKeys = {};
    if (fileToKeysMap) {
        fileToKeysMap.forEach((keys, file) => { serializedFileToKeys[file] = keys; });
    }
    const cacheData = {
        index: targetIndex,
        fileToKeys: serializedFileToKeys,
    };
    // fire-and-forget: write data before manifest for atomicity
    void Promise.all([
        (0, indexCache_1.saveCacheData)(cacheName, JSON.stringify(cacheData)),
        (0, indexCache_1.saveCacheManifest)(cacheName, gfxFiles, currentMtimes, GFX_CACHE_VERSION),
    ]).catch(e => logger_1.Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}
async function fillGfxItems(gfxFile, gfxIndex, fileToKeysMap, options, estimatedSize) {
    try {
        if (estimatedSize) {
            estimatedSize[0] += gfxFile.length;
        }
        const [fileBuffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(gfxFile, options);
        const spriteTypes = (0, spritetype_1.getSpriteTypes)((0, hoiparser_1.parseHoi4File)(fileBuffer.toString(), (0, i18n_1.localize)('infile', 'In file {0}:\n', uri.toString())));
        const spriteNames = [];
        for (const spriteType of spriteTypes) {
            gfxIndex[spriteType.name] = { file: gfxFile };
            if (fileToKeysMap) {
                spriteNames.push(spriteType.name);
            }
            if (estimatedSize) {
                estimatedSize[0] += spriteType.name.length + 8;
            }
        }
        if (fileToKeysMap && spriteNames.length > 0) {
            fileToKeysMap.set(gfxFile, spriteNames);
        }
    }
    catch (e) {
        (0, debug_1.error)(new common_1.UserError((0, common_1.forceError)(e).toString()));
    }
}
function onChangeWorkspaceFolders(_) {
    workspaceGfxIndex = {};
    workspaceGfxFileToKeys.clear();
    const estimatedSize = [0];
    const task = buildWorkspaceGfxIndex(estimatedSize);
    vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('gfxindex.workspace.building', 'Building workspace GFX index...'), task);
    task.then(() => {
        vscode.window.showInformationMessage((0, i18n_1.localize)('gfxindex.workspace.builddone', 'Building workspace GFX index done.'));
        (0, telemetry_1.sendEvent)('gfxIndex.workspace', { size: estimatedSize[0].toString() });
    });
}
function onChangeTextDocument(e) {
    const file = e.document.uri;
    if (file.path.endsWith('.gfx')) {
        onChangeTextDocumentImpl(file);
    }
}
const onChangeTextDocumentImpl = (0, common_1.debounceByInput)((file) => {
    removeWorkspaceGfxIndex(file);
    addWorkspaceGfxIndex(file);
}, file => file.toString(), 1000, { trailing: true });
function onCloseTextDocument(document) {
    const file = document.uri;
    if (file.path.endsWith('.gfx') && document.isDirty) {
        removeWorkspaceGfxIndex(file);
        addWorkspaceGfxIndex(file);
    }
}
function onCreateFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.gfx')) {
            addWorkspaceGfxIndex(file);
        }
    }
}
function onDeleteFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.gfx')) {
            removeWorkspaceGfxIndex(file);
        }
    }
}
function onRenameFiles(e) {
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}
function removeWorkspaceGfxIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            const keys = workspaceGfxFileToKeys.get(relative);
            if (keys) {
                for (const key of keys) {
                    delete workspaceGfxIndex[key];
                }
                workspaceGfxFileToKeys.delete(relative);
            }
        }
    }
}
function addWorkspaceGfxIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            fillGfxItems(relative, workspaceGfxIndex, workspaceGfxFileToKeys, { hoi4: false });
        }
    }
}
//# sourceMappingURL=gfxindex.js.map