"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldMapContainer = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const constants_1 = require("../../constants");
const worldmap_1 = require("./worldmap");
const context_1 = require("../../context");
const i18n_1 = require("../../util/i18n");
const telemetry_1 = require("../../util/telemetry");
class WorldMapContainer {
    constructor() {
        this.worldMap = undefined;
    }
    register() {
        const disposables = [];
        disposables.push(vscode.commands.registerCommand(constants_1.Commands.PreviewWorld, this.openPreview, this));
        disposables.push(vscode.window.registerWebviewPanelSerializer(constants_1.WebviewType.PreviewWorldMap, this));
        disposables.push(vscode.workspace.onDidCloseTextDocument(this.onCloseTextDocument, this));
        disposables.push(vscode.workspace.onDidChangeTextDocument(this.onChangeTextDocument, this));
        return vscode.Disposable.from(...disposables);
    }
    openPreview() {
        (0, telemetry_1.sendEvent)('preview.show.worldmap');
        return this.openWorldMapView();
    }
    deserializeWebviewPanel(webviewPanel, state) {
        return this.openWorldMapView(webviewPanel);
    }
    openWorldMapView(panel) {
        var _a;
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.worldMap) {
                (_a = this.worldMap.panel) === null || _a === void 0 ? void 0 : _a.reveal();
                panel === null || panel === void 0 ? void 0 : panel.dispose();
                return;
            }
            panel = panel !== null && panel !== void 0 ? panel : vscode.window.createWebviewPanel(constants_1.WebviewType.PreviewWorldMap, (0, i18n_1.localize)('worldmap.preview.title', 'Preview World Map'), vscode.ViewColumn.Active, {
                enableScripts: true,
                retainContextWhenHidden: true,
            });
            panel.onDidDispose(() => {
                var _a, _b;
                if (((_a = this.worldMap) === null || _a === void 0 ? void 0 : _a.panel) === panel) {
                    (_b = this.worldMap) === null || _b === void 0 ? void 0 : _b.dispose();
                    this.worldMap = undefined;
                }
            });
            if (context_1.contextContainer.current) {
                panel.iconPath = {
                    light: vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/preview-right-light.svg'),
                    dark: vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/preview-right-dark.svg'),
                };
            }
            this.worldMap = new worldmap_1.WorldMap(panel);
            this.worldMap.initialize();
        });
    }
    onChangeTextDocument(e) {
        var _a;
        (_a = this.worldMap) === null || _a === void 0 ? void 0 : _a.onDocumentChange(e.document.uri);
    }
    onCloseTextDocument(document) {
        var _a;
        (_a = this.worldMap) === null || _a === void 0 ? void 0 : _a.onDocumentChange(document.uri);
    }
}
exports.WorldMapContainer = WorldMapContainer;
//# sourceMappingURL=worldmapcontainer.js.map