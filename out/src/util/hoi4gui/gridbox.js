"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGridBox = renderGridBox;
const tslib_1 = require("tslib");
const gridboxcommon_1 = require("./gridboxcommon");
const nodecommon_1 = require("./nodecommon");
tslib_1.__exportStar(require("./gridboxcommon"), exports);
async function renderGridBox(gridBox, parentInfo, options) {
    return await (0, gridboxcommon_1.renderGridBoxCommon)(gridBox, parentInfo, options, (bg, p) => (0, nodecommon_1.renderBackground)(bg, p, options));
}
//# sourceMappingURL=gridbox.js.map