"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventPreviewDef = void 0;
const tslib_1 = require("tslib");
const vscode = tslib_1.__importStar(require("vscode"));
const contentbuilder_1 = require("./contentbuilder");
const nodecommon_1 = require("../../util/nodecommon");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
const featureflags_1 = require("../../util/featureflags");
const constants_1 = require("../../constants");
function canPreviewEvent(document) {
    if (!featureflags_1.eventTreePreview) {
        return undefined;
    }
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['events', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    const text = document.getText();
    return /(country_event|news_event|unit_leader_event|state_event|operative_leader_event)\s*=\s*{/.exec(text)?.index;
}
class EventPreview extends previewbase_1.PreviewBase {
    eventsLoader;
    content;
    configurationHandler;
    constructor(uri, panel) {
        super(uri, panel);
        this.eventsLoader = new loader_1.EventsLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => Promise.resolve(this.content ?? ''));
        this.eventsLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${constants_1.ConfigurationKey}.previewLocalisation`)) {
                this.reload();
            }
        });
    }
    async getContent(document) {
        this.content = document.getText();
        const result = await (0, contentbuilder_1.renderEventFile)(this.eventsLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
    }
    dispose() {
        super.dispose();
        this.configurationHandler.dispose();
    }
}
exports.eventPreviewDef = {
    type: 'event',
    canPreview: canPreviewEvent,
    previewContructor: EventPreview,
};
//# sourceMappingURL=index.js.map