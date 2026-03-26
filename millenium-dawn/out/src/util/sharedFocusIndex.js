"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFileByFocusKey = exports.registerSharedFocusIndex = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
const common_1 = require("./common");
const fileloader_1 = require("./fileloader");
const i18n_1 = require("./i18n");
const telemetry_1 = require("./telemetry");
const logger_1 = require("./logger");
const schema_1 = require("../previewdef/focustree/schema");
const hoiparser_1 = require("../hoiformat/hoiparser");
const featureflags_1 = require("./featureflags");
const globalFocusIndex = {};
let workspaceFocusIndex = {};
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
exports.registerSharedFocusIndex = registerSharedFocusIndex;
function buildGlobalFocusIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { mod: false, hoi4: true, recursively: true };
        const focusFiles = yield (0, fileloader_1.listFilesFromModOrHOI4)('common/national_focus', options);
        yield Promise.all(focusFiles.map(f => fillFocusItems('common/national_focus/' + f, globalFocusIndex, options, estimatedSize)));
    });
}
function buildWorkspaceFocusIndex(estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const options = { mod: true, hoi4: false, recursively: true };
        const focusFiles = yield (0, fileloader_1.listFilesFromModOrHOI4)('common/national_focus', options);
        yield Promise.all(focusFiles.map(f => fillFocusItems('common/national_focus/' + f, workspaceFocusIndex, options, estimatedSize)));
    });
}
function fillFocusItems(focusFile, focusIndex, options, estimatedSize) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [fileBuffer, uri] = yield (0, fileloader_1.readFileFromModOrHOI4)(focusFile, options);
        const fileContent = fileBuffer.toString();
        try {
            const sharedFocusTrees = [];
            const focusTrees = (0, schema_1.getFocusTree)((0, hoiparser_1.parseHoi4File)(fileContent, (0, i18n_1.localize)('infile', 'In file {0}:\n', focusFile)), sharedFocusTrees, focusFile);
            // Only store focus trees where isSharedFocues is true
            focusTrees.forEach(tree => {
                if (tree.isSharedFocues) {
                    const focusKeys = Object.keys(tree.focuses);
                    focusIndex[focusFile] = focusKeys;
                }
            });
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
    });
}
// Function to find the file name containing the specified focus key
function findFileByFocusKey(key) {
    let result;
    // Search in globalFocusIndex first
    for (const file in globalFocusIndex) {
        if (globalFocusIndex[file].includes(key)) {
            result = file;
            break;
        }
    }
    // Always search in workspaceFocusIndex, and if found, override the result
    for (const file in workspaceFocusIndex) {
        if (workspaceFocusIndex[file].includes(key)) {
            result = file;
            break;
        }
    }
    return result;
}
exports.findFileByFocusKey = findFileByFocusKey;
function onChangeWorkspaceFolders(_) {
    // Clear the workspace focus index
    workspaceFocusIndex = {};
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
    if (file.path.endsWith('.txt')) {
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
            delete workspaceFocusIndex[relative];
        }
    }
}
function addWorkspaceFocusIndex(file) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(file);
    if (wsFolder) {
        const relative = path.relative(wsFolder.uri.path, file.path).replace(/\\+/g, '/');
        if (relative && relative.startsWith('common/national_focus/')) {
            fillFocusItems(relative, workspaceFocusIndex, { hoi4: false });
        }
    }
}
//# sourceMappingURL=sharedFocusIndex.js.map