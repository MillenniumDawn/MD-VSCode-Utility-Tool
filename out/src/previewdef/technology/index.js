"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.technologyPreviewDef = void 0;
const tslib_1 = require("tslib");
const contentbuilder_1 = require("./contentbuilder");
const nodecommon_1 = require("../../util/nodecommon");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
function canPreviewTechnology(document) {
    var _a;
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['common', 'technologies', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    const text = document.getText();
    return (_a = /(technologies)\s*=\s*{/.exec(text)) === null || _a === void 0 ? void 0 : _a.index;
}
class TechnologyTreePreview extends previewbase_1.PreviewBase {
    constructor(uri, panel) {
        super(uri, panel);
        this.technologyTreeLoader = new loader_1.TechnologyTreeLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => { var _a; return Promise.resolve((_a = this.content) !== null && _a !== void 0 ? _a : ''); });
        this.technologyTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    getContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.content = document.getText();
            const result = yield (0, contentbuilder_1.renderTechnologyFile)(this.technologyTreeLoader, document.uri, this.panel.webview);
            this.content = undefined;
            return result;
        });
    }
}
exports.technologyPreviewDef = {
    type: 'technology',
    canPreview: canPreviewTechnology,
    previewContructor: TechnologyTreePreview,
};
//# sourceMappingURL=index.js.map