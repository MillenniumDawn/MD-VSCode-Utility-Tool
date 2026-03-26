"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guiPreviewDef = void 0;
const tslib_1 = require("tslib");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
const contentbuilder_1 = require("./contentbuilder");
function canPreviewGui(document) {
    const uri = document.uri;
    return uri.path.toLowerCase().endsWith('.gui') ? 0 : undefined;
}
class GuiPreview extends previewbase_1.PreviewBase {
    constructor(uri, panel) {
        super(uri, panel);
        this.guiFileLoader = new loader_1.GuiFileLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => { var _a; return Promise.resolve((_a = this.content) !== null && _a !== void 0 ? _a : ''); });
        this.guiFileLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }
    getContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.content = document.getText();
            const result = yield (0, contentbuilder_1.renderGuiFile)(this.guiFileLoader, document.uri, this.panel.webview);
            this.content = undefined;
            return result;
        });
    }
}
exports.guiPreviewDef = {
    type: 'gui',
    canPreview: canPreviewGui,
    previewContructor: GuiPreview,
};
//# sourceMappingURL=index.js.map