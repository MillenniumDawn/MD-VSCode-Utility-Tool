"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewBase = void 0;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const i18n_1 = require("../util/i18n");
const debug_1 = require("../util/debug");
const vsccommon_1 = require("../util/vsccommon");
const lodash_1 = require("lodash");
const fileloader_1 = require("../util/fileloader");
const vsccommon_2 = require("../util/vsccommon");
const telemetry_1 = require("../util/telemetry");
const common_1 = require("../util/common");
class PreviewBase {
    uri;
    panel;
    cachedDependencies = undefined;
    dependencyChangedEmitter = new vscode.EventEmitter();
    onDependencyChanged = this.dependencyChangedEmitter.event;
    disposeEmitter = new vscode.EventEmitter();
    onDispose = this.disposeEmitter.event;
    disposed = false;
    constructor(uri, panel) {
        this.uri = uri;
        this.panel = panel;
        this.registerEvents(panel);
    }
    async onDocumentChange(document) {
        try {
            this.panel.webview.html = await this.getContent(document);
        }
        catch (e) {
            (0, debug_1.error)(e);
        }
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
    async initializePanelContent(document) {
        this.panel.webview.html = (0, i18n_1.localize)('loading', 'Loading...');
        await this.onDocumentChange(document);
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
    async openOrCopyFile(file, start, end) {
        const filePathInMod = await (0, fileloader_1.getFilePathFromMod)(file);
        if (filePathInMod !== undefined) {
            const filePathInModWithoutOpened = (0, fileloader_1.getHoiOpenedFileOriginalUri)(filePathInMod);
            const document = (0, vsccommon_1.getDocumentByUri)(filePathInModWithoutOpened) ?? await vscode.workspace.openTextDocument(filePathInModWithoutOpened);
            await vscode.window.showTextDocument(document, {
                selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                viewColumn: vscode.ViewColumn.One,
            });
            return;
        }
        if (!vscode.workspace.workspaceFolders?.length) {
            await vscode.window.showErrorMessage((0, i18n_1.localize)('preview.mustopenafolder', 'Must open a folder before opening "{0}".', file));
            return;
        }
        let targetFolderUri = vscode.workspace.workspaceFolders[0].uri;
        if (vscode.workspace.workspaceFolders.length >= 1) {
            const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: (0, i18n_1.localize)('preview.selectafolder', 'Select a folder to copy "{0}"', file) });
            if (!folder) {
                return;
            }
            targetFolderUri = folder.uri;
        }
        try {
            const targetFolder = targetFolderUri;
            const [buffer] = await (0, fileloader_1.readFileFromModOrHOI4)(file);
            const targetPath = vscode.Uri.joinPath(targetFolder, file);
            await (0, vsccommon_2.mkdirs)((0, vsccommon_1.dirUri)(targetPath));
            await (0, vsccommon_2.writeFile)(targetPath, buffer);
            const document = await vscode.workspace.openTextDocument(targetPath);
            await vscode.window.showTextDocument(document, {
                selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                viewColumn: vscode.ViewColumn.One,
            });
        }
        catch (e) {
            await vscode.window.showErrorMessage((0, i18n_1.localize)('preview.failedtoopen', 'Failed to open file "{0}": {1}.', file, (0, common_1.forceError)(e).toString()));
        }
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