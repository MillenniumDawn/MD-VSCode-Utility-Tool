"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderIcon = renderIcon;
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
async function renderIcon(icon, parentInfo, options) {
    const spriteType = icon.spritetype ?? icon.quadtexturesprite;
    const image = options.getSprite && spriteType ? await options.getSprite(spriteType, 'icon', icon.name) : undefined;
    if (image === undefined) {
        return '';
    }
    let [x, y] = (0, common_1.calculateBBox)(icon, parentInfo);
    if (icon.centerposition) {
        x -= image.width / 2;
        y -= image.height / 2;
    }
    const scale = icon.scale ?? 1;
    return `<div
    start="${icon._token?.start}"
    end="${icon._token?.end}"
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
        ${(0, nodecommon_1.renderSprite)({ x: 0, y: 0 }, image, image, icon.frame ?? 0, scale, options)}
    </div>`;
}
//# sourceMappingURL=icon.js.map