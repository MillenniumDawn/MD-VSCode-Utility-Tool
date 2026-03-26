"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderIcon = void 0;
const tslib_1 = require("tslib");
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
function renderIcon(icon, parentInfo, options) {
    var _a, _b, _c, _d, _e;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const spriteType = (_a = icon.spritetype) !== null && _a !== void 0 ? _a : icon.quadtexturesprite;
        const image = options.getSprite && spriteType ? yield options.getSprite(spriteType, 'icon', icon.name) : undefined;
        if (image === undefined) {
            return '';
        }
        let [x, y] = (0, common_1.calculateBBox)(icon, parentInfo);
        if (icon.centerposition) {
            x -= image.width / 2;
            y -= image.height / 2;
        }
        const scale = (_b = icon.scale) !== null && _b !== void 0 ? _b : 1;
        return `<div
    start="${(_c = icon._token) === null || _c === void 0 ? void 0 : _c.start}"
    end="${(_d = icon._token) === null || _d === void 0 ? void 0 : _d.end}"
    class="
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('icon', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${image.width * scale}px;
            height: ${image.height * scale}px;
        `)}
    ">
        ${(0, nodecommon_1.renderSprite)({ x: 0, y: 0 }, image, image, (_e = icon.frame) !== null && _e !== void 0 ? _e : 0, scale, options)}
    </div>`;
    });
}
exports.renderIcon = renderIcon;
//# sourceMappingURL=icon.js.map