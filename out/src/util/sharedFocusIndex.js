"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSharedFocusIndex = registerSharedFocusIndex;
exports.findFileByFocusKey = findFileByFocusKey;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const path = tslib_1.__importStar(require("path"));
const common_1 = require("./common");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const telemetry_1 = require("./telemetry");
const logger_1 = require("./logger");
const schema_1 = require("../previewdef/focustree/schema");
const hoiparser_1 = require("../hoiformat/hoiparser");
const featureflags_1 = require("./featureflags");
const indexCache_1 = require("./indexCache");
const globalFocusIndex = {};
let workspaceFocusIndex = {};
// Reverse maps for O(1) lookup: focusKey -> filename
const globalFocusKeyToFile = new Map();
const workspaceFocusKeyToFile = new Map();
function registerSharedFocusIndex() {
    const disposables = [];
    if (featureflags_1.sharedFocusIndex) {
        const estimatedSize = [0];
        const task = Promise.all([
            buildGlobalFocusIndex(estimatedSize),
            buildWorkspaceFocusIndex(estimatedSize)
        ]);
        vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('sharedFocusIndex.building', 'Building Shared Focus index...'), task);
        task.then(() => {
            vscode.window.showInformationMessage((0, i18n_1.localize)('sharedFocusIndex.builddone', 'Building Shared Focus index done.'));
            (0, telemetry_1.sendEvent)('sharedFocusIndex', { size: estimatedSize[0].toString() });
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
const FOCUS_CACHE_VERSION = 1;
async function buildGlobalFocusIndex(estimatedSize) {
    const options = { mod: false, hoi4: true, recursively: true };
    const focusFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('common/national_focus', options)).map(f => 'common/national_focus/' + f);
    await buildFocusIndexWithCache('focusIndex.global', focusFiles, globalFocusIndex, globalFocusKeyToFile, options, estimatedSize);
}
async function buildWorkspaceFocusIndex(estimatedSize) {
    const options = { mod: true, hoi4: false, recursively: true };
    const focusFiles = (await (0, fileloader_1.listFilesFromModOrHOI4)('common/national_focus', options)).map(f => 'common/national_focus/' + f);
    await buildFocusIndexWithCache('focusIndex.workspace', focusFiles, workspaceFocusIndex, workspaceFocusKeyToFile, options, estimatedSize);
}
async function buildFocusIndexWithCache(cacheName, focusFiles, focusIndex, reverseMap, options, estimatedSize) {
    const timer = new indexCache_1.IndexTimer(cacheName);
    const resolveUri = (relativePath) => (0, fileloader_1.getFilePathFromModOrHOI4)(relativePath, options);
    const currentMtimes = await (0, indexCache_1.getFileMtimes)(focusFiles, resolveUri);
    timer.mark('mtime');
    const manifest = await (0, indexCache_1.loadCacheManifest)(cacheName, FOCUS_CACHE_VERSION);
    let filesToParse = focusFiles;
    if (manifest) {
        const staleness = (0, indexCache_1.computeStaleFiles)(manifest, currentMtimes);
        const cachedData = await (0, indexCache_1.loadCacheData)(cacheName);
        if (cachedData && staleness.stale.length + staleness.removed.length + staleness.added.length < focusFiles.length) {
            try {
                const cached = JSON.parse(cachedData);
                const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
                for (const file in cached) {
                    if (!skipFiles.has(file)) {
                        focusIndex[file] = cached[file];
                        for (const key of cached[file]) {
                            reverseMap.set(key, file);
                        }
                    }
                }
                filesToParse = [...staleness.stale, ...staleness.added];
            }
            catch {
                logger_1.Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
                filesToParse = focusFiles;
            }
        }
    }
    timer.mark('cache');
    await Promise.all(filesToParse.map(f => fillFocusItems(f, focusIndex, reverseMap, options, estimatedSize)));
    timer.mark('parse');
    timer.log(focusFiles.length, filesToParse.length);
    // fire-and-forget: write data before manifest for atomicity
    void Promise.all([
        (0, indexCache_1.saveCacheData)(cacheName, JSON.stringify(focusIndex)),
        (0, indexCache_1.saveCacheManifest)(cacheName, focusFiles, currentMtimes, FOCUS_CACHE_VERSION),
    ]).catch(e => logger_1.Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}
async function fillFocusItems(focusFile, focusIndex, reverseMap, options, estimatedSize) {
    const [fileBuffer, uri] = await (0, fileloader_1.readFileFromModOrHOI4)(focusFile, options);
    const fileContent = fileBuffer.toString();
    // Skip files that don't contain any focus type definitions
    if (!fileContent.includes('focus_tree')
        && !fileContent.includes('shared_focus')
        && !fileContent.includes('joint_focus')) {
        return;
    }
    try {
        const ids = (0, schema_1.extractFocusIds)((0, hoiparser_1.parseHoi4File)(fileContent, (0, i18n_1.localize)('infile', 'In file {0}:\n', focusFile)));
        focusIndex[focusFile] = ids;
        for (const key of ids) {
            reverseMap.set(key, focusFile);
        }
        if (estimatedSize) {
            estimatedSize[0] += fileBuffer.length;
        }
    }
    catch (e) {
        const baseMessage = options.hoi4
            ? (0, i18n_1.localize)('sharedFocusIndex.vanilla', '[Vanilla]')
            : (0, i18n_1.localize)('sharedFocusIndex.mod', '[Mod]');
        const failureMessage = (0, i18n_1.localize)('sharedFocusIndex.parseFailure', 'Parsing failed! Please check if the file has issues!');
        if (e instanceof Error) {
            logger_1.Logger.error(`${baseMessage} ${focusFile} ${failureMessage}\n${e.stack}`);
        }
    }
}
function findFileByFocusKey(key) {
    return workspaceFocusKeyToFile.get(key) ?? globalFocusKeyToFile.get(key);
}
function onChangeWorkspaceFolders(_) {
    workspaceFocusIndex = {};
    workspaceFocusKeyToFile.clear();
    const estimatedSize = [0];
    const task = buildWorkspaceFocusIndex(estimatedSize);
    vscode.window.setStatusBarMessage('$(loading~spin) ' + (0, i18n_1.localize)('sharedFocusIndex.workspace.building', 'Building workspace Focus index...'), task);
    task.then(() => {
        vscode.window.showInformationMessage((0, i18n_1.localize)('sharedFocusIndex.workspace.builddone', 'Building workspace Focus index done.'));
        (0, telemetry_1.sendEvent)('sharedFocusIndex.workspace', { size: estimatedSize[0].toString() });
    });
}
function onChangeTextDocument(e) {
    const file = e.document.uri;
    if (file.path.endsWith('.txt')) {
        onChangeTextDocumentImpl(file);
    }
}
const onChangeTextDocumentImpl = (0, common_1.debounceByInput)((file) => {
    removeWorkspaceFocusIndex(file);
    addWorkspaceFocusIndex(file);
}, file => file.toString(), 1000, { trailing: true });
function onCloseTextDocument(document) {
    const file = document.uri;
    if (file.path.endsWith('.txt') && document.isDirty) {
        removeWorkspaceFocusIndex(file);
        addWorkspaceFocusIndex(file);
    }
}
function onCreateFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.txt')) {
            addWorkspaceFocusIndex(file);
        }
    }
}
function onDeleteFiles(e) {
    for (const file of e.files) {
        if (file.path.endsWith('.txt')) {
            removeWorkspaceFocusIndex(file);
        }
    }
}
function onRenameFiles(e) {
    onDeleteFiles({ files: e.files.map(f => f.oldUri) });
    onCreateFiles({ files: e.files.map(f => f.newUri) });
}
function removeWorkspaceFocusIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('common/national_focus/')) {
            const keys = workspaceFocusIndex[relative];
            if (keys) {
                for (const key of keys) {
                    if (workspaceFocusKeyToFile.get(key) === relative) {
                        workspaceFocusKeyToFile.delete(key);
                    }
                }
            }
            delete workspaceFocusIndex[relative];
        }
    }
}
function addWorkspaceFocusIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('common/national_focus/')) {
            fillFocusItems(relative, workspaceFocusIndex, workspaceFocusKeyToFile, { hoi4: false });
        }
    }
}
//# sourceMappingURL=sharedFocusIndex.js.map