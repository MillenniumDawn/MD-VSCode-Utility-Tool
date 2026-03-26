"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldMap = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const worldmapview_html_1 = require("./worldmapview.html");
const worldmapview_css_1 = require("./worldmapview.css");
const i18n_1 = require("../../util/i18n");
const html_1 = require("../../util/html");
const debug_1 = require("../../util/debug");
const nodecommon_1 = require("../../util/nodecommon");
const vsccommon_1 = require("../../util/vsccommon");
const common_1 = require("../../util/common");
const fileloader_1 = require("../../util/fileloader");
const worldmaploader_1 = require("./loader/worldmaploader");
const lodash_1 = require("lodash");
const loader_1 = require("../../util/loader/loader");
const telemetry_1 = require("../../util/telemetry");
const vsccommon_2 = require("../../util/vsccommon");
class WorldMap {
    constructor(panel) {
        this.onDocumentChange = (0, common_1.debounceByInput)((uri) => {
            if (!this.worldMapDependencies) {
                return;
            }
            if (this.worldMapDependencies.some(d => (0, nodecommon_1.matchPathEnd)(uri.toString(), d.split('/')))) {
                this.sendProvinceMapSummaryToWebview(false);
            }
        }, uri => uri.toString(), 1000, { trailing: true });
        this.progressReporter = (progress) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            (0, debug_1.debug)('Progress:', progress);
            yield this.postMessageToWebview({
                command: 'progress',
                data: progress,
            });
        });
        this.panel = panel;
        this.worldMapLoader = new worldmaploader_1.WorldMapLoader();
        this.worldMapLoader.onProgress(this.progressReporter);
    }
    initialize() {
        if (!this.panel) {
            return;
        }
        const webview = this.panel.webview;
        webview.html = this.renderWorldMap(webview);
        webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    }
    dispose() {
        this.panel = undefined;
    }
    renderWorldMap(webview) {
        return (0, html_1.html)(webview, (0, i18n_1.localizeText)(worldmapview_html_1.default), [
            { content: (0, i18n_1.i18nTableAsScript)() },
            { content: 'window.__enableSupplyArea = ' + (0, vsccommon_2.getConfiguration)().enableSupplyArea + ';' },
            'common.js',
            'worldmap.js'
        ], ['common.css', 'codicon.css', { content: worldmapview_css_1.default }]);
    }
    onMessage(msg) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                (0, debug_1.debug)('worldmap message ' + JSON.stringify(msg));
                switch (msg.command) {
                    case 'loaded':
                        yield this.sendProvinceMapSummaryToWebview(msg.force);
                        break;
                    case 'requestprovinces':
                        yield this.sendMapData('provinces', msg, (yield this.worldMapLoader.getWorldMap()).provinces);
                        break;
                    case 'requeststates':
                        yield this.sendMapData('states', msg, (yield this.worldMapLoader.getWorldMap()).states);
                        break;
                    case 'requestcountries':
                        yield this.sendMapData('countries', msg, (yield this.worldMapLoader.getWorldMap()).countries);
                        break;
                    case 'requeststrategicregions':
                        yield this.sendMapData('strategicregions', msg, (yield this.worldMapLoader.getWorldMap()).strategicRegions);
                        break;
                    case 'requestsupplyareas':
                        yield this.sendMapData('supplyareas', msg, (yield this.worldMapLoader.getWorldMap()).supplyAreas);
                        break;
                    case 'requestrailways':
                        yield this.sendMapData('railways', msg, (yield this.worldMapLoader.getWorldMap()).railways);
                        break;
                    case 'requestsupplynodes':
                        yield this.sendMapData('supplynodes', msg, (yield this.worldMapLoader.getWorldMap()).supplyNodes);
                        break;
                    case 'openfile':
                        yield this.openFile(msg.file, msg.type, msg.start, msg.end);
                        break;
                    case 'telemetry':
                        yield (0, telemetry_1.sendByMessage)(msg);
                        break;
                    case 'requestexportmap':
                        yield this.requestExportMap();
                        break;
                    case 'exportmap':
                        yield this.exportMap(msg.dataUrl);
                        break;
                }
            }
            catch (e) {
                (0, debug_1.error)(e);
            }
        });
    }
    sendMapData(command, msg, value) {
        return this.postMessageToWebview({
            command: command,
            data: JSON.stringify((0, common_1.slice)(value, msg.start, msg.end)),
            start: msg.start,
            end: msg.end,
        });
    }
    sendProvinceMapSummaryToWebview(force) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                this.worldMapLoader.shallowForceReload();
                const oldCachedWorldMap = this.cachedWorldMap;
                const loaderSession = new loader_1.LoaderSession(force, () => this.panel === undefined);
                const { result: worldMap, dependencies } = yield this.worldMapLoader.load(loaderSession);
                this.worldMapDependencies = dependencies;
                this.cachedWorldMap = worldMap;
                if (!force && oldCachedWorldMap && (yield this.sendDifferences(oldCachedWorldMap, worldMap))) {
                    return;
                }
                const summary = Object.assign(Object.assign({}, worldMap), { provinces: [], states: [], countries: [], strategicRegions: [], supplyAreas: [] });
                yield this.postMessageToWebview({
                    command: 'provincemapsummary',
                    data: summary,
                });
            }
            catch (e) {
                (0, debug_1.error)(e);
                yield this.postMessageToWebview({
                    command: 'error',
                    data: (0, i18n_1.localize)('worldmap.failedtoload', 'Failed to load world map: {0}.', (0, common_1.forceError)(e).toString()),
                });
            }
        });
    }
    openFile(file, type, start, end) {
        var _a, _b;
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // TODO duplicate with previewbase.ts
            const filePathInMod = yield (0, fileloader_1.getFilePathFromMod)(file);
            if (filePathInMod !== undefined) {
                const filePathInModWithoutOpened = (0, fileloader_1.getHoiOpenedFileOriginalUri)(filePathInMod);
                const document = (_a = (0, vsccommon_1.getDocumentByUri)(filePathInModWithoutOpened)) !== null && _a !== void 0 ? _a : yield vscode.workspace.openTextDocument(filePathInModWithoutOpened);
                yield vscode.window.showTextDocument(document, {
                    selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                });
                return;
            }
            const typeName = (0, i18n_1.localize)('worldmap.openfiletype.' + type, type);
            if (!((_b = vscode.workspace.workspaceFolders) === null || _b === void 0 ? void 0 : _b.length)) {
                yield vscode.window.showErrorMessage((0, i18n_1.localize)('worldmap.mustopenafolder', 'Must open a folder before opening {0} file.', typeName));
                return;
            }
            let targetFolderUri = vscode.workspace.workspaceFolders[0].uri;
            if (vscode.workspace.workspaceFolders.length >= 1) {
                const folder = yield vscode.window.showWorkspaceFolderPick({ placeHolder: (0, i18n_1.localize)('worldmap.selectafolder', 'Select a folder to copy {0} file', typeName) });
                if (!folder) {
                    return;
                }
                targetFolderUri = folder.uri;
            }
            try {
                const [buffer] = yield (0, fileloader_1.readFileFromModOrHOI4)(file);
                const targetPath = vscode.Uri.joinPath(targetFolderUri, file);
                yield (0, vsccommon_1.mkdirs)((0, vsccommon_1.dirUri)(targetPath));
                yield (0, vsccommon_1.writeFile)(targetPath, buffer);
                const document = yield vscode.workspace.openTextDocument(targetPath);
                yield vscode.window.showTextDocument(document, {
                    selection: start !== undefined && end !== undefined ? new vscode.Range(document.positionAt(start), document.positionAt(end)) : undefined,
                });
            }
            catch (e) {
                yield vscode.window.showErrorMessage((0, i18n_1.localize)('worldmap.failedtoopenstate', 'Failed to open {0} file: {1}.', typeName, (0, common_1.forceError)(e).toString()));
            }
        });
    }
    sendDifferences(cachedWorldMap, worldMap) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.progressReporter((0, i18n_1.localize)('worldmap.progress.comparing', 'Comparing changes...'));
            const changeMessages = [];
            if (['width', 'height', 'provincesCount', 'statesCount', 'countriesCount', 'strategicRegionsCount', 'supplyAreasCount',
                'railwaysCount', 'supplyNodesCount',
                'badProvincesCount', 'badStatesCount', 'badStrategicRegionsCount', 'badSupplyAreasCount']
                .some(k => !(0, lodash_1.isEqual)(cachedWorldMap[k], worldMap[k]))) {
                return false;
            }
            if (!(0, lodash_1.isEqual)(cachedWorldMap.warnings, worldMap.warnings)) {
                changeMessages.push({ command: 'warnings', data: JSON.stringify(worldMap.warnings), start: 0, end: 0 });
            }
            if (!(0, lodash_1.isEqual)(cachedWorldMap.continents, worldMap.continents)) {
                changeMessages.push({ command: 'continents', data: JSON.stringify(worldMap.continents), start: 0, end: 0 });
            }
            if (!(0, lodash_1.isEqual)(cachedWorldMap.terrains, worldMap.terrains)) {
                changeMessages.push({ command: 'terrains', data: JSON.stringify(worldMap.terrains), start: 0, end: 0 });
            }
            if (!(0, lodash_1.isEqual)(cachedWorldMap.resources, worldMap.resources)) {
                changeMessages.push({ command: 'resources', data: JSON.stringify(worldMap.resources), start: 0, end: 0 });
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.provinces, cachedWorldMap.provinces, 'provinces', worldMap.badProvincesCount, worldMap.provincesCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.states, cachedWorldMap.states, 'states', worldMap.badStatesCount, worldMap.statesCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.countries, cachedWorldMap.countries, 'countries', 0, worldMap.countriesCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.strategicRegions, cachedWorldMap.strategicRegions, 'strategicregions', worldMap.badStrategicRegionsCount, worldMap.strategicRegionsCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.supplyAreas, cachedWorldMap.supplyAreas, 'supplyareas', worldMap.badSupplyAreasCount, worldMap.supplyAreasCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.railways, cachedWorldMap.railways, 'railways', 0, worldMap.railwaysCount)) {
                return false;
            }
            if (!this.fillMessageForItem(changeMessages, worldMap.supplyNodes, cachedWorldMap.supplyNodes, 'supplynodes', 0, worldMap.supplyNodesCount)) {
                return false;
            }
            yield this.progressReporter((0, i18n_1.localize)('worldmap.progress.applying', 'Applying changes...'));
            for (const message of changeMessages) {
                yield this.postMessageToWebview(message);
            }
            yield this.progressReporter('');
            return true;
        });
    }
    fillMessageForItem(changeMessages, list, cachedList, command, listStart, listEnd) {
        const changeMessagesCountLimit = 30;
        const messageCountLimit = 300;
        let lastDifferenceStart = undefined;
        for (let i = listStart; i <= listEnd; i++) {
            if (i === listEnd || (0, lodash_1.isEqual)(list[i], cachedList[i])) {
                if (lastDifferenceStart !== undefined) {
                    changeMessages.push({
                        command,
                        data: JSON.stringify((0, common_1.slice)(list, lastDifferenceStart, i)),
                        start: lastDifferenceStart,
                        end: i,
                    });
                    if (changeMessages.length > changeMessagesCountLimit) {
                        return false;
                    }
                    lastDifferenceStart = undefined;
                }
            }
            else {
                if (lastDifferenceStart === undefined) {
                    lastDifferenceStart = i;
                }
                else if (i - lastDifferenceStart >= messageCountLimit) {
                    changeMessages.push({
                        command,
                        data: JSON.stringify((0, common_1.slice)(list, lastDifferenceStart, i)),
                        start: lastDifferenceStart,
                        end: i,
                    });
                    if (changeMessages.length > changeMessagesCountLimit) {
                        return false;
                    }
                    lastDifferenceStart = i;
                }
            }
        }
        return true;
    }
    postMessageToWebview(message) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.panel) {
                return false;
            }
            return yield this.panel.webview.postMessage(message);
        });
    }
    requestExportMap() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const uri = yield vscode.window.showSaveDialog({ filters: { [(0, i18n_1.localize)('pngfile', 'PNG file')]: ['png'] } });
            this.lastRequestedExportUri = uri;
            if (!uri) {
                return;
            }
            yield this.postMessageToWebview({ command: 'requestexportmap' });
        });
    }
    exportMap(dataUrl) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const uri = this.lastRequestedExportUri;
            if (!uri) {
                return;
            }
            const prefix = 'data:image/png;base64,';
            if (!dataUrl || !dataUrl.startsWith(prefix)) {
                vscode.window.showErrorMessage((0, i18n_1.localize)('worldmap.export.error.imgformat', 'Can\'t export world map: Image is not in correct format.'));
                return;
            }
            try {
                const base64 = dataUrl.substring(prefix.length);
                const buffer = Buffer.from(base64, 'base64');
                yield (0, vsccommon_1.writeFile)(uri, buffer);
                vscode.window.showInformationMessage((0, i18n_1.localize)('worldmap.export.success', 'Successfully exported world map.'));
            }
            catch (e) {
                (0, debug_1.error)(e);
                vscode.window.showErrorMessage((0, i18n_1.localize)('worldmap.export.error', 'Can\'t export world map: {0}.', e));
            }
        });
    }
}
exports.WorldMap = WorldMap;
//# sourceMappingURL=worldmap.js.map