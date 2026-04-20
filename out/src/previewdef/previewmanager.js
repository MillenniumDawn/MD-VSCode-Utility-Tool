"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewManager = exports.PreviewManager = void 0;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const focustree_1 = require("./focustree");
const i18n_1 = require("../util/i18n");
const gfx_1 = require("./gfx");
const constants_1 = require("../constants");
const technology_1 = require("./technology");
const nodecommon_1 = require("../util/nodecommon");
const common_1 = require("../util/common");
const debug_1 = require("../util/debug");
const context_1 = require("../context");
const vsccommon_1 = require("../util/vsccommon");
const worldmap_1 = require("./worldmap");
const event_1 = require("./event");
const lodash_1 = require("lodash");
const telemetry_1 = require("../util/telemetry");
const gui_1 = require("./gui");
const mio_1 = require("./mio");
class PreviewManager {
    _previews = {};
    _previewProviders = [
        focustree_1.focusTreePreviewDef,
        gfx_1.gfxPreviewDef,
        technology_1.technologyPreviewDef,
        worldmap_1.worldMapPreviewDef,
        event_1.eventPreviewDef,
        gui_1.guiPreviewDef,
        mio_1.mioPreviewDef,
    ];
    _previewProvidersMap = (0, common_1.arrayToMap)(this._previewProviders, 'type');
    _updateSubscriptions = new Map();
    register() {
        const disposables = [];
        disposables.push(vscode.commands.registerCommand(constants_1.Commands.Preview, this.showPreview, this));
        disposables.push(vscode.workspace.onDidCloseTextDocument(this.onCloseTextDocument, this));
        disposables.push(vscode.workspace.onDidChangeTextDocument(this.onChangeTextDocument, this));
        disposables.push(vscode.window.onDidChangeActiveTextEditor(this.updateHoi4PreviewContextValue, this));
        disposables.push(vscode.window.registerWebviewPanelSerializer(constants_1.WebviewType.Preview, this));
        // Trigger context value setting
        this.updateHoi4PreviewContextValue(vscode.window.activeTextEditor);
        return vscode.Disposable.from(...disposables);
    }
    async deserializeWebviewPanel(panel, state) {
        const uriStr = state?.uri;
        if (!uriStr) {
            panel.dispose();
            (0, debug_1.debug)(`dispose panel ??? because uri not exist`);
            return;
        }
        try {
            const uri = vscode.Uri.parse(uriStr, true);
            await vscode.workspace.openTextDocument(uri);
            await this.showPreviewImpl(uri, panel);
        }
        catch (e) {
            (0, debug_1.error)(e);
            panel.dispose();
            (0, debug_1.debug)(`dispose panel ${uriStr} because reopen error`);
        }
    }
    showPreview(uri) {
        return this.showPreviewImpl(uri);
    }
    onCloseTextDocument(document) {
        if (!vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === document.uri.toString())) {
            const key = document.uri.toString();
            this._previews[key]?.panel.dispose();
            (0, debug_1.debug)(`dispose panel ${key} because text document closed`);
        }
        this.updatePreviewItemsInSubscription(document.uri);
    }
    onChangeTextDocument(e) {
        const document = e.document;
        const key = document.uri.toString();
        const preview = this._previews[key];
        if (preview !== undefined) {
            this.updatePreviewItem(preview, document);
        }
        this.updatePreviewItemsInSubscription(document.uri);
    }
    updateHoi4PreviewContextValue(textEditor) {
        let shouldShowPreviewButton = false;
        let hoi4PreviewType = '';
        if (textEditor) {
            const provider = this.findPreviewProvider(textEditor.document);
            if (provider) {
                shouldShowPreviewButton = true;
                hoi4PreviewType = provider.type;
            }
        }
        (0, context_1.setVscodeContext)(constants_1.ContextName.ShouldShowHoi4Preview, shouldShowPreviewButton);
        (0, context_1.setVscodeContext)(constants_1.ContextName.ShouldHideHoi4Preview, !shouldShowPreviewButton);
        (0, context_1.setVscodeContext)(constants_1.ContextName.Hoi4PreviewType, hoi4PreviewType);
    }
    async showPreviewImpl(requestUri, panel) {
        let document;
        if (requestUri === undefined) {
            document = vscode.window.activeTextEditor?.document;
        }
        else {
            document = (0, vsccommon_1.getDocumentByUri)(requestUri);
        }
        if (document === undefined) {
            if (requestUri === undefined) {
                vscode.window.showErrorMessage((0, i18n_1.localize)('preview.noactivedoc', "No active document."));
            }
            else {
                vscode.window.showErrorMessage((0, i18n_1.localize)('preview.cantfinddoc', "Can't find opened document {0}.", requestUri?.toString()));
            }
            panel?.dispose();
            (0, debug_1.debug)(`dispose panel ${requestUri} because document not opened`);
            return;
        }
        const uri = document.uri;
        const key = uri.toString();
        if (key in this._previews) {
            this._previews[key].panel.reveal();
            panel?.dispose();
            (0, debug_1.debug)(`dispose panel ${uri} because preview already open`);
            return;
        }
        const previewProvider = this.findPreviewProvider(document);
        if (!previewProvider) {
            vscode.window.showInformationMessage((0, i18n_1.localize)('preview.cantpreviewfile', "Can't preview this file.\nValid types: {0}.", Object.keys(this._previewProvidersMap).join(', ')));
            panel?.dispose();
            (0, debug_1.debug)(`dispose panel ${uri} because no preview provider`);
            this.updateHoi4PreviewContextValue(undefined);
            return;
        }
        if ('onPreview' in previewProvider) {
            return previewProvider.onPreview(document);
        }
        if (!panel) {
            (0, telemetry_1.sendEvent)('preview.show.' + previewProvider.type);
        }
        const filename = (0, vsccommon_1.basename)(uri);
        panel = panel ?? vscode.window.createWebviewPanel(constants_1.WebviewType.Preview, (0, i18n_1.localize)('preview.viewtitle', "HOI4: {0}", filename), vscode.ViewColumn.Beside, {
            enableScripts: true
        });
        if (context_1.contextContainer.current) {
            panel.iconPath = {
                light: vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/preview-right-light.svg'),
                dark: vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/preview-right-dark.svg'),
            };
        }
        const previewItem = new previewProvider.previewContructor(uri, panel);
        this._previews[key] = previewItem;
        previewItem.onDispose(() => {
            const preview = this._previews[key];
            if (preview) {
                this.removePreviewFromSubscription(preview);
                delete this._previews[key];
            }
        });
        previewItem.onDependencyChanged((newDep) => {
            this.removePreviewFromSubscription(previewItem);
            this.addPreviewToSubscription(previewItem, newDep);
        });
        previewItem.initializePanelContent(document);
    }
    findPreviewProvider(document) {
        return (0, lodash_1.chain)(this._previewProviders)
            .map(p => ({ provider: p, priority: p.canPreview(document) }))
            .filter((value) => value.priority !== undefined)
            .minBy(value => value.priority)
            .value()?.provider;
    }
    addPreviewToSubscription(previewItem, dependency) {
        const matchStrings = Object.values(dependency)
            .map(d => d.split('/').filter(v => v));
        for (const matchString of matchStrings) {
            const subscriptions = this._updateSubscriptions.get(matchString);
            if (subscriptions) {
                subscriptions.push(previewItem);
            }
            else {
                this._updateSubscriptions.set(matchString, [previewItem]);
            }
        }
    }
    removePreviewFromSubscription(previewItem) {
        for (const [matchString, subscriptions] of this._updateSubscriptions.entries()) {
            if (subscriptions.includes(previewItem)) {
                const newSubscriptions = subscriptions.filter(v => v !== previewItem);
                if (newSubscriptions.length === 0) {
                    this._updateSubscriptions.delete(matchString);
                }
                else {
                    this._updateSubscriptions.set(matchString, newSubscriptions);
                }
            }
        }
    }
    getPreviewItemsNeedsUpdate(uri) {
        const result = [];
        for (const [matchString, previewItems] of this._updateSubscriptions.entries()) {
            if ((0, nodecommon_1.matchPathEnd)(uri, matchString)) {
                result.push(...previewItems);
            }
        }
        return result;
    }
    updatePreviewItemsInSubscription = (0, common_1.debounceByInput)((uri) => {
        for (const otherPreview of this.getPreviewItemsNeedsUpdate(uri.toString())) {
            if (uri.toString() === otherPreview.uri.toString()) {
                continue;
            }
            const otherDocument = (0, vsccommon_1.getDocumentByUri)(otherPreview.uri);
            if (otherDocument) {
                otherPreview.onDocumentChange(otherDocument);
            }
        }
    }, uri => uri.toString(), 1000, { trailing: true });
    updatePreviewItem = (0, common_1.debounceByInput)((previewItem, document) => {
        if (!previewItem.isDisposed) {
            previewItem.onDocumentChange(document);
        }
    }, (preview) => preview.uri.toString(), 1000, { trailing: true });
}
exports.PreviewManager = PreviewManager;
exports.previewManager = new PreviewManager();
//# sourceMappingURL=previewmanager.js.map