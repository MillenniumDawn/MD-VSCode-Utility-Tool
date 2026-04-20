"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worldMapPreviewDef = exports.worldMap = void 0;
const nodecommon_1 = require("../../util/nodecommon");
const worldmapcontainer_1 = require("./worldmapcontainer");
exports.worldMap = new worldmapcontainer_1.WorldMapContainer();
function canPreviewWorldmap(document) {
    const uri = document.uri;
    return (0, nodecommon_1.matchPathEnd)(uri.toString().toLowerCase(), ['map', 'default.map']) ? 0 : undefined;
}
function onPreviewWorldmap(document) {
    return exports.worldMap.openPreview();
}
exports.worldMapPreviewDef = {
    type: 'worldmap',
    canPreview: canPreviewWorldmap,
    onPreview: onPreviewWorldmap,
};
//# sourceMappingURL=index.js.map