"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalsOverlaysGfxFile = exports.nationalFocusViewGfxFile = exports.focusTitlebarStylesFile = void 0;
exports.loadFocusTitlebarStyles = loadFocusTitlebarStyles;
exports.getFocusTitlebarImage = getFocusTitlebarImage;
exports.getFocusOverlayImage = getFocusOverlayImage;
const hoiparser_1 = require("../../hoiformat/hoiparser");
const schema_1 = require("../../hoiformat/schema");
const imagecache_1 = require("../../util/image/imagecache");
const i18n_1 = require("../../util/i18n");
const fileloader_1 = require("../../util/fileloader");
exports.focusTitlebarStylesFile = 'common/national_focus/00_titlebar_styles.txt';
exports.nationalFocusViewGfxFile = 'interface/nationalfocusview.gfx';
exports.goalsOverlaysGfxFile = 'interface/goals_overlays.gfx';
const titlebarStyleSchema = {
    name: "string",
    available: "string",
};
const titlebarStyleFileSchema = {
    style: {
        _innerType: titlebarStyleSchema,
        _type: 'array',
    },
};
async function loadFocusTitlebarStyles() {
    try {
        const [buffer, realPath] = await (0, fileloader_1.readFileFromModOrHOI4)(exports.focusTitlebarStylesFile);
        const node = (0, hoiparser_1.parseHoi4File)(buffer.toString(), (0, i18n_1.localize)('infile', 'In file {0}:\n', realPath));
        const file = (0, schema_1.convertNodeToJson)(node, titlebarStyleFileSchema);
        const result = {};
        for (const style of file.style) {
            if (style?.name && style.available) {
                result[style.name] = style.available;
            }
        }
        return result;
    }
    catch {
        return {};
    }
}
async function getFocusTitlebarImage(textIcon, titlebarStyles) {
    if (!textIcon) {
        return undefined;
    }
    const gfxName = titlebarStyles[textIcon];
    if (!gfxName) {
        return undefined;
    }
    const sprite = await (0, imagecache_1.getSpriteByGfxName)(gfxName, exports.nationalFocusViewGfxFile);
    return sprite?.image;
}
async function getFocusOverlayImage(overlay) {
    if (!overlay) {
        return undefined;
    }
    const sprite = await (0, imagecache_1.getSpriteByGfxName)(overlay, exports.goalsOverlaysGfxFile);
    return sprite?.image;
}
//# sourceMappingURL=titlebar.js.map