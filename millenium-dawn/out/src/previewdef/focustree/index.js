"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusTreePreviewDef = void 0;
const tslib_1 = require("tslib");
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
    constructor(uri, panel) {
        super(uri, panel);
        this.focusTreeLoader = new loader_1.FocusTreeLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => { var _a; return Promise.resolve((_a = this.content) !== null && _a !== void 0 ? _a : ''); });
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    getContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.content = document.getText();
            const result = yield (0, contentbuilder_1.renderFocusTreeFile)(this.focusTreeLoader, document.uri, this.panel.webview);
            this.content = undefined;
            return result;
        });
    }
}
exports.focusTreePreviewDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
//# sourceMappingURL=index.js.map