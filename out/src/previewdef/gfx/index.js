"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gfxPreviewDef = void 0;
const contentbuilder_1 = require("./contentbuilder");
const previewbase_1 = require("../previewbase");
function canPreviewGfx(document) {
    const uri = document.uri;
    return uri.path.toLowerCase().endsWith('.gfx') ? 0 : undefined;
}
class GfxPreview extends previewbase_1.PreviewBase {
    getContent(document) {
        return (0, contentbuilder_1.renderGfxFile)(document.getText(), document.uri, this.panel.webview);
    }
}
exports.gfxPreviewDef = {
    type: 'gfx',
    canPreview: canPreviewGfx,
    previewContructor: GfxPreview,
};
//# sourceMappingURL=index.js.map