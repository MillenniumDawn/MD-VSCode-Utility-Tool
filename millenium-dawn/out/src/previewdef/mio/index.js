"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mioPreviewDef = void 0;
const tslib_1 = require("tslib");
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
    constructor(uri, panel) {
        super(uri, panel);
        this.mioFileLoader = new loader_1.MioLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => { var _a; return Promise.resolve((_a = this.content) !== null && _a !== void 0 ? _a : ''); });
        this.mioFileLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    getContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.content = document.getText();
            const result = yield (0, contentbuilder_1.renderMioFile)(this.mioFileLoader, document.uri, this.panel.webview);
            this.content = undefined;
            return result;
        });
    }
}
exports.mioPreviewDef = {
    type: 'mio',
    canPreview: canPreviewMio,
    previewContructor: MioPreview,
};
//# sourceMappingURL=index.js.map