"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSelectedModFileStatus = exports.registerModFile = exports.workspaceModFilesCache = exports.modFileStatusContainer = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const path = require("path");
const constants_1 = require("../constants");
const cache_1 = require("./cache");
const i18n_1 = require("./i18n");
const vsccommon_1 = require("./vsccommon");
const vsccommon_2 = require("./vsccommon");
exports.modFileStatusContainer = {
    current: null,
};
exports.workspaceModFilesCache = new cache_1.PromiseCache({
    factory: getWorkspaceModFiles,
    life: 10 * 1000,
});
function registerModFile() {
    const disposables = [];
    disposables.push(vscode.commands.registerCommand(constants_1.Commands.SelectModFile, selectModFile));
    disposables.push(exports.modFileStatusContainer.current = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50));
    disposables.push(vscode.workspace.onDidChangeConfiguration(onChangeWorkspaceConfiguration));
    disposables.push(new vscode.Disposable(() => { exports.modFileStatusContainer.current = null; }));
    // Initial status bar
    checkAndUpdateModFileStatus((0, vsccommon_1.fileOrUriStringToUri)((0, vsccommon_1.getConfiguration)().modFile));
    return vscode.Disposable.from(...disposables);
}
exports.registerModFile = registerModFile;
function updateSelectedModFileStatus(modFile, error = false) {
    if (exports.modFileStatusContainer.current) {
        const modName = exports.modFileStatusContainer.current;
        if (modFile) {
            const modFileName = (0, vsccommon_1.basename)(modFile, ".mod");
            modName.command = constants_1.Commands.SelectModFile;
            modName.text = (error ? "$(error) " : "$(file-code) ") + modFileName;
            modName.tooltip = (error ? (0, i18n_1.localize)('modfile.errorreading', "Error reading this file: ") : '') + (0, vsccommon_1.uriToFilePathWhenPossible)(modFile);
            modName.show();
        }
        else {
            modName.command = constants_1.Commands.SelectModFile;
            modName.text = "$(file-code) " + (0, i18n_1.localize)('modfile.nomodfile', '(No mod descriptor)');
            modName.tooltip = (0, i18n_1.localize)('modfile.clicktoselect', 'Click to select a mod file...');
            modName.show();
        }
    }
}
exports.updateSelectedModFileStatus = updateSelectedModFileStatus;
function onChangeWorkspaceConfiguration(e) {
    if (e.affectsConfiguration(`${constants_1.ConfigurationKey}.modFile`)) {
        checkAndUpdateModFileStatus((0, vsccommon_1.fileOrUriStringToUri)((0, vsccommon_1.getConfiguration)().modFile));
    }
}
function checkAndUpdateModFileStatus(modFile) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (modFile === undefined) {
            updateSelectedModFileStatus(undefined);
            return;
        }
        const error = !(yield (0, vsccommon_2.isFile)(modFile));
        updateSelectedModFileStatus(modFile, error);
        if (error) {
            vscode.window.showErrorMessage((0, i18n_1.localize)('modfile.filenotexist', 'Mod file not exist: {0}', modFile));
        }
    });
}
function selectModFile() {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const conf = (0, vsccommon_1.getConfiguration)();
        const modFileInspect = conf.inspect('modFile');
        const modsList = !(modFileInspect === null || modFileInspect === void 0 ? void 0 : modFileInspect.globalValue) ? [] : [{
                label: path.basename(modFileInspect.globalValue, '.mod'),
                description: (0, i18n_1.localize)('modfile.globalsetting', 'Global setting'),
                detail: modFileInspect.globalValue
            }];
        let selected = conf.modFile.trim();
        exports.workspaceModFilesCache.clear();
        if (vscode.workspace.workspaceFolders) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const workspaceFolderPath = workspaceFolder.uri;
                const mods = yield exports.workspaceModFilesCache.get(workspaceFolderPath.toString());
                if (selected === '' && mods.length > 0) {
                    selected = (0, vsccommon_1.uriToFilePathWhenPossible)(mods[0]);
                }
                modsList.push(...mods.map(mod => ({
                    label: (0, vsccommon_1.basename)(mod, '.mod'),
                    description: (0, i18n_1.localize)('modfile.infolder', 'In folder {0}', (0, vsccommon_1.basename)(workspaceFolderPath)),
                    detail: (0, vsccommon_1.uriToFilePathWhenPossible)(mod),
                })));
            }
        }
        modsList.forEach(r => r.detail === selected ? r.picked = true : undefined);
        if (modsList.every(r => !r.picked) && selected !== '') {
            modsList.push({
                label: path.basename(selected, '.mod'),
                description: (0, i18n_1.localize)('modfile.workspacesetting', 'Workspace setting'),
                detail: selected,
                picked: true,
            });
        }
        modsList.sort((a, b) => a.picked ? -1 : b.picked ? 1 : 0);
        modsList.push({
            label: (0, i18n_1.localize)('modfile.select', 'Browse a .mod file...'),
            selectModFile: true,
        });
        const selectResult = yield vscode.window.showQuickPick(modsList, { placeHolder: (0, i18n_1.localize)('modfile.selectworkingmod', 'Select working mod') });
        if (selectResult) {
            let modPath = selectResult.detail;
            if (selectResult.selectModFile) {
                const result = yield vscode.window.showOpenDialog({ filters: { [(0, i18n_1.localize)('modfile.type', 'Mod file')]: ['mod'] } });
                if (result) {
                    modPath = (0, vsccommon_1.uriToFilePathWhenPossible)(result[0]);
                }
                else {
                    return;
                }
            }
            if (modPath === (modFileInspect === null || modFileInspect === void 0 ? void 0 : modFileInspect.globalValue)) {
                conf.update('modFile', undefined, vscode.ConfigurationTarget.Workspace);
            }
            else {
                conf.update('modFile', modPath, vscode.ConfigurationTarget.Workspace);
            }
            checkAndUpdateModFileStatus(modPath ? (0, vsccommon_1.fileOrUriStringToUri)(modPath) : undefined);
        }
    });
}
function getWorkspaceModFiles(uriString) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const uri = vscode.Uri.parse(uriString);
        const items = yield (0, vsccommon_2.readDir)(uri);
        return items.filter(i => i.endsWith('.mod')).map(i => vscode.Uri.joinPath(uri, i));
    });
}
//# sourceMappingURL=modfile.js.map