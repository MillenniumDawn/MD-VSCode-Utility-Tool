"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHoiFs = void 0;
const tslib_1 = require("tslib");
const lodash_1 = require("lodash");
const vscode = require("vscode");
const constants_1 = require("../constants");
const common_1 = require("./common");
const fileloader_1 = require("./fileloader");
const telemetry_1 = require("./telemetry");
const vsccommon_1 = require("./vsccommon");
const installPathContainer = {
    current: null,
};
function registerHoiFs() {
    const disposables = [];
    disposables.push(vscode.commands.registerCommand(constants_1.Commands.SelectHoiFolder, selectHoiFolder));
    try {
        disposables.push(vscode.workspace.registerFileSystemProvider(constants_1.Hoi4FsSchema, new Hoi4UtilsFsProvider(), { isReadonly: true }));
    }
    catch (e) {
        if (!(0, common_1.forceError)(e).message.includes(`scheme '${constants_1.Hoi4FsSchema}' is already registered`)) {
            throw e;
        }
    }
    if (!IS_WEB_EXT) {
        disposables.push(vscode.workspace.onDidChangeConfiguration(onChangeWorkspaceConfiguration));
    }
    return vscode.Disposable.from(...disposables);
}
exports.registerHoiFs = registerHoiFs;
function selectHoiFolder() {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        (0, telemetry_1.sendEvent)('selectHoiFolder');
        const dialogOptions = { canSelectFolders: true, canSelectFiles: false, canSelectMany: false };
        // TODO proposed API
        // dialogOptions.allowUIResources = true;
        const result = yield vscode.window.showOpenDialog(dialogOptions);
        if (!result) {
            return;
        }
        const uri = result[0];
        installPathContainer.current = uri;
        (0, fileloader_1.clearDlcZipCache)();
        if (!IS_WEB_EXT && (0, vsccommon_1.isFileScheme)(uri)) {
            const conf = (0, vsccommon_1.getConfiguration)();
            conf.update('installPath', uri.fsPath, vscode.ConfigurationTarget.Global);
        }
    });
}
function onChangeWorkspaceConfiguration(e) {
    if (e.affectsConfiguration(`${constants_1.ConfigurationKey}.installPath`)) {
        installPathContainer.current = null;
        (0, fileloader_1.clearDlcZipCache)();
    }
}
class Hoi4UtilsFsProvider {
    constructor() {
        this.onDidChangeFileEventEmitter = new vscode.EventEmitter();
        this.onDidChangeFile = this.onDidChangeFileEventEmitter.event;
    }
    watch(uri, options) {
        // TODO empty implementation
        return { dispose: () => { } };
    }
    stat(uri) {
        return vscode.workspace.fs.stat(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')));
    }
    readDirectory(uri) {
        return vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')));
    }
    createDirectory(uri) {
        return vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')));
    }
    readFile(uri) {
        return vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')));
    }
    writeFile(uri, content, options) {
        return vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')), content);
    }
    delete(uri, options) {
        return vscode.workspace.fs.delete(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(uri.path, '/')), options);
    }
    rename(oldUri, newUri, options) {
        return vscode.workspace.fs.rename(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(oldUri.path, '/')), vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(newUri.path, '/')), options);
    }
    copy(source, destination, options) {
        return vscode.workspace.fs.copy(vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(source.path, '/')), vscode.Uri.joinPath(this.getInstallPath(), (0, lodash_1.trimStart)(destination.path, '/')), options);
    }
    getInstallPath() {
        if (installPathContainer.current !== null) {
            return installPathContainer.current;
        }
        const installPath = (0, vsccommon_1.getConfiguration)().installPath;
        if (installPath === '') {
            throw new common_1.UserError("Install path of Heart of Iron IV is not set.");
        }
        return installPathContainer.current = vscode.Uri.file(installPath);
    }
}
//# sourceMappingURL=hoifs.js.map