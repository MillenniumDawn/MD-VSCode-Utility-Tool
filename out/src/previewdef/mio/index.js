"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mioPreviewDef = void 0;
const previewbase_1 = require("../previewbase");
const vsccommon_1 = require("../../util/vsccommon");
const nodecommon_1 = require("../../util/nodecommon");
const loader_1 = require("./loader");
const contentbuilder_1 = require("./contentbuilder");
function canPreviewMio(document) {
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['common', 'military_industrial_organization', 'organizations', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    return undefined;
}
class MioPreview extends previewbase_1.PreviewBase {
    mioFileLoader;
    content;
    constructor(uri, panel) {
        super(uri, panel);
        this.mioFileLoader = new loader_1.MioLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => Promise.resolve(this.content ?? ''));
        this.mioFileLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    async getContent(document) {
        this.content = document.getText();
        const result = await (0, contentbuilder_1.renderMioFile)(this.mioFileLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
}
exports.mioPreviewDef = {
    type: 'mio',
    canPreview: canPreviewMio,
    previewContructor: MioPreview,
};
//# sourceMappingURL=index.js.map