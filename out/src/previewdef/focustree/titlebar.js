"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFocusTitlebarImage = exports.loadFocusTitlebarStyles = exports.nationalFocusViewGfxFile = exports.focusTitlebarStylesFile = void 0;
const tslib_1 = require("tslib");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const schema_1 = require("../../hoiformat/schema");
const imagecache_1 = require("../../util/image/imagecache");
const i18n_1 = require("../../util/i18n");
const fileloader_1 = require("../../util/fileloader");
exports.focusTitlebarStylesFile = 'common/national_focus/00_titlebar_styles.txt';
exports.nationalFocusViewGfxFile = 'interface/nationalfocusview.gfx';
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
function loadFocusTitlebarStyles() {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            const [buffer, realPath] = yield (0, fileloader_1.readFileFromModOrHOI4)(exports.focusTitlebarStylesFile);
            const node = (0, hoiparser_1.parseHoi4File)(buffer.toString(), (0, i18n_1.localize)('infile', 'In file {0}:\n', realPath));
            const file = (0, schema_1.convertNodeToJson)(node, titlebarStyleFileSchema);
            const result = {};
            for (const style of file.style) {
                if ((style === null || style === void 0 ? void 0 : style.name) && style.available) {
                    result[style.name] = style.available;
                }
            }
            return result;
        }
        catch (_a) {
            return {};
        }
    });
}
exports.loadFocusTitlebarStyles = loadFocusTitlebarStyles;
function getFocusTitlebarImage(textIcon, titlebarStyles) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!textIcon) {
            return undefined;
        }
        const gfxName = titlebarStyles[textIcon];
        if (!gfxName) {
            return undefined;
        }
        const sprite = yield (0, imagecache_1.getSpriteByGfxName)(gfxName, exports.nationalFocusViewGfxFile);
        return sprite === null || sprite === void 0 ? void 0 : sprite.image;
    });
}
exports.getFocusTitlebarImage = getFocusTitlebarImage;
//# sourceMappingURL=titlebar.js.map