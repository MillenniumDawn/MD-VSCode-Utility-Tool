"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderButton = renderButton;
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
const instanttextbox_1 = require("./instanttextbox");
async function renderButton(button, parentInfo, options) {
    const spriteType = button.spritetype ?? button.quadtexturesprite;
    const image = options.getSprite && spriteType ? await options.getSprite(spriteType, 'icon', button.name) : undefined;
    if (image === undefined) {
        return '';
    }
    let [x, y] = (0, common_1.calculateBBox)(button, parentInfo);
    if (button.centerposition) {
        x -= image.width / 2;
        y -= image.height / 2;
    }
    const scale = button.scale ?? 1;
    return `<div
    start="${button._token?.start}"
    end="${button._token?.end}"
    class="
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.oneTimeStyle('button', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${image.width * scale}px;
            height: ${image.height * scale}px;
        `)}
    ">
        ${(0, nodecommon_1.renderSprite)({ x: 0, y: 0 }, image, image, button.frame ?? 0, scale, options)} 
        ${await (0, instanttextbox_1.renderInstantTextBox)({
        ...button,
        position: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) },
        bordersize: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) },
        maxheight: (0, schema_1.toNumberLike)(image.height * scale),
        maxwidth: (0, schema_1.toNumberLike)(image.width * scale),
        font: button.buttonfont,
        text: button.buttontext ?? button.text,
        format: (0, schema_1.toStringAsSymbolIgnoreCase)('center'),
        vertical_alignment: 'center',
        orientation: (0, schema_1.toStringAsSymbolIgnoreCase)('upper_left')
    }, parentInfo, { ...options, enableNavigator: undefined })}
    </div>`;
}
//# sourceMappingURL=button.js.map