"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventPreviewDef = void 0;
const tslib_1 = require("tslib");
const vscode = require("vscode");
const contentbuilder_1 = require("./contentbuilder");
const nodecommon_1 = require("../../util/nodecommon");
const previewbase_1 = require("../previewbase");
const loader_1 = require("./loader");
const vsccommon_1 = require("../../util/vsccommon");
const featureflags_1 = require("../../util/featureflags");
const constants_1 = require("../../constants");
function canPreviewEvent(document) {
    var _a;
    if (!featureflags_1.eventTreePreview) {
        return undefined;
    }
    const uri = document.uri;
    if ((0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['events', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }
    const text = document.getText();
    return (_a = /(country_event|news_event|unit_leader_event|state_event|operative_leader_event)\s*=\s*{/.exec(text)) === null || _a === void 0 ? void 0 : _a.index;
}
class EventPreview extends previewbase_1.PreviewBase {
    constructor(uri, panel) {
        super(uri, panel);
        this.eventsLoader = new loader_1.EventsLoader((0, vsccommon_1.getRelativePathInWorkspace)(this.uri), () => { var _a; return Promise.resolve((_a = this.content) !== null && _a !== void 0 ? _a : ''); });
        this.eventsLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${constants_1.ConfigurationKey}.previewLocalisation`)) {
                this.reload();
            }
        });
    }
    getContent(document) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.content = document.getText();
            const result = yield (0, contentbuilder_1.renderEventFile)(this.eventsLoader, document.uri, this.panel.webview);
            this.content = undefined;
            return result;
        });
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