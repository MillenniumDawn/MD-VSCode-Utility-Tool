"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewBase = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const i18n_1 = require("../util/i18n");
const debug_1 = require("../util/debug");
const vsccommon_1 = require("../util/vsccommon");
const lodash_1 = require("lodash");
const fileloader_1 = require("../util/fileloader");
const vsccommon_2 = require("../util/vsccommon");
const telemetry_1 = require("../util/telemetry");
const common_1 = require("../util/common");
class PreviewBase {
    constructor(uri, panel) {
        this.uri = uri;
        this.panel = panel;
        this.cachedDependencies = undefined;
        this.dependencyChangedEmitter = new vscode.EventEmitter();
        this.onDependencyChanged = this.dependencyChangedEmitter.event;
        this.disposeEmitter = new vscode.EventEmitter();
        this.onDispose = this.disposeEmitter.event;
        this.disposed = false;
        this.registerEvents(panel);
    }
    onDocumentChange(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                this.panel.webview.html = yield this.getContent(document);
            }
            catch (e) {
                (0, debug_1.error)(e);
            }
        });
    }
    dispose() {
        this.dependencyChangedEmitter.dispose();
        this.disposed = true;
        this.disposeEmitter.fire(undefined);
        this.disposeEmitter.dispose();
    }
    get isDisposed() {
        return this.disposed;
    }
    initializePanelContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.panel.webview.html = (0, i18n_1.localize)('loading', 'Loading...');
            yield this.onDocumentChange(document);
        });
    }
    registerEvents(panel) {
        panel.webview.onDidReceiveMessage((msg) => {
            switch (msg.command) {
                case 'navigate':
                    if (msg.start !== undefined) {
                        if (msg.file === undefined) {
                            const document = (0, vsccommon_1.getDocumentByUri)(this.uri);
                            if (document === undefined) {
                                return;
                            }
                            vscode.window.showTextDocument(this.uri, {
                                selection: new vscode.Range(document.positionAt(msg.start), document.positionAt(msg.end)),
                                viewColumn: vscode.ViewColumn.One
                            });
                        }
                        else {
                            this.openOrCopyFile(msg.file, msg.start, msg.end);
                        }
                    }
                    break;
                case 'telemetry':
                    (0, telemetry_1.sendByMessage)(msg);
                    break;
                case 'reload':
                    this.reload();
                    break;
            }
        });
        panel.onDidDispose(() => {
            this.dispose();
        });
    }
    updateDependencies(dependencies) {
        if (this.cachedDependencies === undefined || !(0, lodash_1.isEqual)(this.cachedDependencies, dependencies)) {
            this.dependencyChangedEmitter.fire(dependencies);
            (0, debug_1.debug)("dependencies: ", this.uri.toString(), JSON.stringify(dependencies));
        }
        this.cachedDependencies = dependencies;
    }
    openOrCopyFile(file, start, end) {
        var _a, _b;
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const filePathInMod = yield (0, fileloader_1.getFilePathFromMod)(file);
            if (filePathInMod !== undefined) {
                const filePathInModWithoutOpened = (0, fileloader_1.getHoiOpenedFileOriginalUri)(filePathInMod);
                const document = (_a = (0, vsccommon_1.getDocumentByUri)(filePathInModWithoutOpened)) !== null && _a !== void 0 ? _a : yield vscode.workspace.openTextDocument(filePathInModWithoutOpened);
                yield vscode.window.showTextDocument(document, {
                    selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                    viewColumn: vscode.ViewColumn.One,
                });
                return;
            }
            if (!((_b = vscode.workspace.workspaceFolders) === null || _b === void 0 ? void 0 : _b.length)) {
                yield vscode.window.showErrorMessage((0, i18n_1.localize)('preview.mustopenafolder', 'Must open a folder before opening "{0}".', file));
                return;
            }
            let targetFolderUri = vscode.workspace.workspaceFolders[0].uri;
            if (vscode.workspace.workspaceFolders.length >= 1) {
                const folder = yield vscode.window.showWorkspaceFolderPick({ placeHolder: (0, i18n_1.localize)('preview.selectafolder', 'Select a folder to copy "{0}"', file) });
                if (!folder) {
                    return;
                }
                targetFolderUri = folder.uri;
            }
            try {
                const targetFolder = targetFolderUri;
                const [buffer] = yield (0, fileloader_1.readFileFromModOrHOI4)(file);
                const targetPath = vscode.Uri.joinPath(targetFolder, file);
                yield (0, vsccommon_2.mkdirs)((0, vsccommon_1.dirUri)(targetPath));
                yield (0, vsccommon_2.writeFile)(targetPath, buffer);
                const document = yield vscode.workspace.openTextDocument(targetPath);
                yield vscode.window.showTextDocument(document, {
                    selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                    viewColumn: vscode.ViewColumn.One,
                });
            }
            catch (e) {
                yield vscode.window.showErrorMessage((0, i18n_1.localize)('preview.failedtoopen', 'Failed to open file "{0}": {1}.', file, (0, common_1.forceError)(e).toString()));
            }
        });
    }
    reload() {
        const document = (0, vsccommon_1.getDocumentByUri)(this.uri);
        if (document === undefined) {
            return;
        }
        this.onDocumentChange(document);
    }
}
exports.PreviewBase = PreviewBase;
//# sourceMappingURL=previewbase.js.map