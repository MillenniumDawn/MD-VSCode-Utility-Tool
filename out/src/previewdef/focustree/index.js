"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusTreePreviewDef = void 0;
const contentbuilder_1 = require("./contentbuilder");
const nodecommon_1 = require("../../util/nodecommon");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
function canPreviewFocusTree(document) {
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['common', 'national_focus', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    return undefined;
}
function toolbarFlagsEqual(a, b) {
    if (a === undefined || b === undefined)
        return a === b;
    return a.hasCustomTitlebar === b.hasCustomTitlebar &&
        a.hasFocusOverlay === b.hasFocusOverlay &&
        a.hasInlayWindows === b.hasInlayWindows;
}
class FocusTreePreview extends previewbase_1.PreviewBase {
    focusTreeLoader;
    content;
    lastCssFingerprint = undefined;
    lastToolbarFlags = undefined;
    constructor(uri, panel) {
        super(uri, panel);
        this.focusTreeLoader = new loader_1.FocusTreeLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => Promise.resolve(this.content ?? ''));
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    async getContent(document) {
        this.content = document.getText();
        // Build payload first while content is set; second loader.load() inside renderFocusTreeFile
        // returns from cache (shouldReload = false, hash matches), so this is cheap.
        const payload = await (0, contentbuilder_1.buildFocusTreePayload)(this.focusTreeLoader);
        if (payload) {
            this.lastCssFingerprint = payload.cssFingerprint;
            this.lastToolbarFlags = payload.toolbarFlags;
        }
        else {
            this.lastCssFingerprint = undefined;
            this.lastToolbarFlags = undefined;
        }
        const result = await (0, contentbuilder_1.renderFocusTreeFile)(this.focusTreeLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
    async sendPartialUpdate(document) {
        this.content = document.getText();
        let payload = null;
        try {
            payload = await (0, contentbuilder_1.buildFocusTreePayload)(this.focusTreeLoader);
        }
        finally {
            this.content = undefined;
        }
        if (payload === null ||
            payload.cssFingerprint !== this.lastCssFingerprint ||
            !toolbarFlagsEqual(payload.toolbarFlags, this.lastToolbarFlags)) {
            // Fall back to full HTML reload
            this.panelInitialized = false;
            await this.onDocumentChange(document);
            return;
        }
        this.lastCssFingerprint = payload.cssFingerprint;
        this.lastToolbarFlags = payload.toolbarFlags;
        const updateMsg = {
            type: 'update',
            focusTrees: payload.focusTrees,
            renderedFocus: payload.renderedFocus,
            renderedInlayWindows: payload.renderedInlayWindows,
            gridBox: payload.gridBox,
            useConditionInFocus: payload.useConditionInFocus,
            xGridSize: payload.xGridSize,
        };
        this.panel.webview.postMessage(updateMsg);
    }
}
exports.focusTreePreviewDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
//# sourceMappingURL=index.js.map