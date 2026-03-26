"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGridBox = void 0;
const tslib_1 = require("tslib");
const gridboxcommon_1 = require("./gridboxcommon");
const nodecommon_1 = require("./nodecommon");
tslib_1.__exportStar(require("./gridboxcommon"), exports);
function renderGridBox(gridBox, parentInfo, options) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        return yield (0, gridboxcommon_1.renderGridBoxCommon)(gridBox, parentInfo, options, (bg, p) => (0, nodecommon_1.renderBackground)(bg, p, options));
    });
}
exports.renderGridBox = renderGridBox;
//# sourceMappingURL=gridbox.js.map