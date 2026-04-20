"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.technologyPreviewDef = void 0;
const contentbuilder_1 = require("./contentbuilder");
const nodecommon_1 = require("../../util/nodecommon");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
function canPreviewTechnology(document) {
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['common', 'technologies', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    const text = document.getText();
    return /(technologies)\s*=\s*{/.exec(text)?.index;
}
class TechnologyTreePreview extends previewbase_1.PreviewBase {
    technologyTreeLoader;
    content;
    constructor(uri, panel) {
        super(uri, panel);
        this.technologyTreeLoader = new loader_1.TechnologyTreeLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => Promise.resolve(this.content ?? ''));
        this.technologyTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    async getContent(document) {
        this.content = document.getText();
        const result = await (0, contentbuilder_1.renderTechnologyFile)(this.technologyTreeLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
}
exports.technologyPreviewDef = {
    type: 'technology',
    canPreview: canPreviewTechnology,
    previewContructor: TechnologyTreePreview,
};
//# sourceMappingURL=index.js.map