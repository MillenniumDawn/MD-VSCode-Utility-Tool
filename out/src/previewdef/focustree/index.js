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
class FocusTreePreview extends previewbase_1.PreviewBase {
    focusTreeLoader;
    content;
    constructor(uri, panel) {
        super(uri, panel);
        this.focusTreeLoader = new loader_1.FocusTreeLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => Promise.resolve(this.content ?? ''));
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    async getContent(document) {
        this.content = document.getText();
        const result = await (0, contentbuilder_1.renderFocusTreeFile)(this.focusTreeLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
}
exports.focusTreePreviewDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
//# sourceMappingURL=index.js.map