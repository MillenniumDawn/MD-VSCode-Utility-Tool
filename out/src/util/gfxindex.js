"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGfxContainerFiles = exports.getGfxContainerFile = exports.registerGfxIndex = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
const hoiparser_1 = require("../hoiformat/hoiparser");
const spritetype_1 = require("../hoiformat/spritetype");
const common_1 = require("./common");
const debug_1 = require("./debug");
const featureflags_1 = require("./featureflags");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const lodash_1 = require("lodash");
const telemetry_1 = require("./telemetry");
const globalGfxIndex = {};
let workspaceGfxIndex = {};
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
exports.registerGfxIndex = registerGfxIndex;
function getGfxContainerFile(gfxName) {
    var _a, _b;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!featureflags_1.gfxIndex || !gfxName) {
            return undefined;
        }
        return (_b = ((_a = globalGfxIndex[gfxName]) !== null && _a !== void 0 ? _a : workspaceGfxIndex[gfxName])) === null || _b === void 0 ? void 0 : _b.file;
    });
}
exports.getGfxContainerFile = getGfxContainerFile;
function getGfxContainerFiles(gfxNames) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return (0, lodash_1.uniq)((yield Promise.all(gfxNames.map(getGfxContainerFile))).filter((v) => v !== undefined));
    });
}
exports.getGfxContainerFiles = getGfxContainerFiles;
function buildGlobalGfxIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { mod: false, recursively: true };
        const gfxFiles = (yield (0, fileloader_1.listFilesFromModOrHOI4)('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx'));
        yield Promise.all(gfxFiles.map(f => fillGfxItems('interface/' + f, globalGfxIndex, options, estimatedSize)));
    });
}
function buildWorkspaceGfxIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { hoi4: false, recursively: true };
        const gfxFiles = (yield (0, fileloader_1.listFilesFromModOrHOI4)('interface', options)).filter(f => f.toLocaleLowerCase().endsWith('.gfx'));
        yield Promise.all(gfxFiles.map(f => fillGfxItems('interface/' + f, workspaceGfxIndex, options, estimatedSize)));
    });
}
function fillGfxItems(gfxFile, gfxIndex, options, estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            if (estimatedSize) {
                estimatedSize[0] += gfxFile.length;
            }
            const [fileBuffer, uri] = yield (0, fileloader_1.readFileFromModOrHOI4)(gfxFile, options);
            const spriteTypes = (0, spritetype_1.getSpriteTypes)((0, hoiparser_1.parseHoi4File)(fileBuffer.toString(), (0, i18n_1.localize)('infile', 'In file {0}:\n', uri.toString())));
            for (const spriteType of spriteTypes) {
                gfxIndex[spriteType.name] = { file: gfxFile };
                if (estimatedSize) {
                    estimatedSize[0] += spriteType.name.length + 8;
                }
            }
        }
        catch (e) {
            (0, debug_1.error)(new common_1.UserError((0, common_1.forceError)(e).toString()));
        }
    });
}
function onChangeWorkspaceFolders(_) {
    workspaceGfxIndex = {};
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
    if (file.path.endsWith('.gfx')) {
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
    var _a;
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            for (const key in workspaceGfxIndex) {
                if (((_a = workspaceGfxIndex[key]) === null || _a === void 0 ? void 0 : _a.file) === relative) {
                    delete workspaceGfxIndex[key];
                }
            }
        }
    }
}
function addWorkspaceGfxIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('interface/')) {
            fillGfxItems(relative, workspaceGfxIndex, { hoi4: false });
        }
    }
}
//# sourceMappingURL=gfxindex.js.map