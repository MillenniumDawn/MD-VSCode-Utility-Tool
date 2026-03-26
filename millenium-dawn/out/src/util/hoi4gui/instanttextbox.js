"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderInstantTextBox = void 0;
const tslib_1 = require("tslib");
const common_1 = require("./common");
const html_1 = require("../html");
const localisationIndex_1 = require("../localisationIndex");
const featureflags_1 = require("../featureflags");
function renderInstantTextBox(textbox, parentInfo, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [x, y, width, height] = (0, common_1.calculateBBox)(Object.assign(Object.assign({}, textbox), { size: { width: textbox.maxwidth, height: textbox.maxheight } }), parentInfo);
        const borderX = (0, common_1.normalizeNumberLike)((_a = textbox.bordersize) === null || _a === void 0 ? void 0 : _a.x, width);
        const borderY = (0, common_1.normalizeNumberLike)((_b = textbox.bordersize) === null || _b === void 0 ? void 0 : _b.y, height);
        const format = (_c = textbox.format) === null || _c === void 0 ? void 0 : _c._name.replace('centre', 'center');
        const font = (_d = textbox.font) !== null && _d !== void 0 ? _d : '';
        const fontMatch = /\d+/.exec(font.replace('hoi4', ''));
        const fontSize = Math.ceil(parseInt((_e = fontMatch === null || fontMatch === void 0 ? void 0 : fontMatch.find(() => true)) !== null && _e !== void 0 ? _e : '16') * 0.7);
        return `<div
    ${options.id ? `id="${options.id}"` : ''}
    start="${(_f = textbox._token) === null || _f === void 0 ? void 0 : _f.start}"
    end="${(_g = textbox._token) === null || _g === void 0 ? void 0 : _g.end}"
    class="
        ${(options === null || options === void 0 ? void 0 : options.classNames) ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.style('borderBox', () => `box-sizing: border-box;`)}
        ${options.styleTable.oneTimeStyle('instanttextbox', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${width}px;
            height: ${height}px;
            font-size: ${fontSize}px;
            text-align: ${format};
            padding: ${borderY}px ${borderX}px;
            ${textbox.vertical_alignment === 'center' ? `vertical-align: middle; line-height: ${height}px;` : ''}
        `)}
        ${options.styleTable.style('instanttextbox-common', () => `
            color: white;
            text-shadow: 0 0 3px black, 0px 0px 5px black;
        `)}
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
    ">
        ${(0, html_1.htmlEscape)(featureflags_1.localisationIndex ? ((_h = yield (0, localisationIndex_1.getLocalisedTextQuick)(textbox.text)) !== null && _h !== void 0 ? _h : ' ') : ((_j = textbox.text) !== null && _j !== void 0 ? _j : ''))}
    </div>`;
    });
}
exports.renderInstantTextBox = renderInstantTextBox;
//# sourceMappingURL=instanttextbox.js.map