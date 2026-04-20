"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TGAViewProvider = exports.DDSViewProvider = void 0;
const converter_1 = require("./util/image/converter");
const pngjs_1 = require("pngjs");
const i18n_1 = require("./util/i18n");
const dds_1 = require("./util/image/dds");
const html_1 = require("./util/html");
const styletable_1 = require("./util/styletable");
const telemetry_1 = require("./util/telemetry");
const common_1 = require("./util/common");
const vsccommon_1 = require("./util/vsccommon");
class CommonViewProvider {
    async openCustomDocument(uri) {
        // Don't try opening it as text
        return { uri, dispose: () => { } };
    }
    async resolveCustomEditor(document, webviewPanel, token) {
        try {
            this.onOpen();
            const buffer = await Promise.race([
                (0, vsccommon_1.readFile)(document.uri),
                new Promise(resolve => token.onCancellationRequested(_ => resolve(null))),
            ]);
            if (buffer === null) {
                return;
            }
            const png = this.getPng(Buffer.from(buffer));
            const pngBuffer = pngjs_1.PNG.sync.write(png);
            const styleTable = new styletable_1.StyleTable();
            webviewPanel.webview.html = (0, html_1.html)(webviewPanel.webview, `<div class="${styleTable.oneTimeStyle('imagePreview', () => `width:${png.width}px;height:${png.height}px;`)}">
                    <img src="data:image/png;base64,${pngBuffer.toString('base64')}"/>
                </div>`, [], [styleTable]);
        }
        catch (e) {
            webviewPanel.webview.html = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
        }
    }
}
class DDSViewProvider extends CommonViewProvider {
    onOpen() {
        (0, telemetry_1.sendEvent)('preview.dds');
    }
    getPng(buffer) {
        const dds = dds_1.DDS.parse(buffer.buffer, buffer.byteOffset);
        return (0, converter_1.ddsToPng)(dds);
    }
}
exports.DDSViewProvider = DDSViewProvider;
class TGAViewProvider extends CommonViewProvider {
    onOpen() {
        (0, telemetry_1.sendEvent)('preview.tga');
    }
    getPng(buffer) {
        return (0, converter_1.tgaToPng)(buffer);
    }
}
exports.TGAViewProvider = TGAViewProvider;
//# sourceMappingURL=ddsviewprovider.js.map