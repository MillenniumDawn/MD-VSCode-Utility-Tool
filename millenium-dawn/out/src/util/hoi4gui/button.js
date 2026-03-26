"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderButton = void 0;
const tslib_1 = require("tslib");
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("./common");
const nodecommon_1 = require("./nodecommon");
const instanttextbox_1 = require("./instanttextbox");
function renderButton(button, parentInfo, options) {
    var _a, _b, _c, _d, _e, _f;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const spriteType = (_a = button.spritetype) !== null && _a !== void 0 ? _a : button.quadtexturesprite;
        const image = options.getSprite && spriteType ? yield options.getSprite(spriteType, 'icon', button.name) : undefined;
        if (image === undefined) {
            return '';
        }
        let [x, y] = (0, common_1.calculateBBox)(button, parentInfo);
        if (button.centerposition) {
            x -= image.width / 2;
            y -= image.height / 2;
        }
        const scale = (_b = button.scale) !== null && _b !== void 0 ? _b : 1;
        return `<div
    start="${(_c = button._token) === null || _c === void 0 ? void 0 : _c.start}"
    end="${(_d = button._token) === null || _d === void 0 ? void 0 : _d.end}"
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
        ${(0, nodecommon_1.renderSprite)({ x: 0, y: 0 }, image, image, (_e = button.frame) !== null && _e !== void 0 ? _e : 0, scale, options)} 
        ${yield (0, instanttextbox_1.renderInstantTextBox)(Object.assign(Object.assign({}, button), { position: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) }, bordersize: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) }, maxheight: (0, schema_1.toNumberLike)(image.height * scale), maxwidth: (0, schema_1.toNumberLike)(image.width * scale), font: button.buttonfont, text: (_f = button.buttontext) !== null && _f !== void 0 ? _f : button.text, format: (0, schema_1.toStringAsSymbolIgnoreCase)('center'), vertical_alignment: 'center', orientation: (0, schema_1.toStringAsSymbolIgnoreCase)('upper_left') }), parentInfo, Object.assign(Object.assign({}, options), { enableNavigator: undefined }))}
    </div>`;
    });
}
exports.renderButton = renderButton;
//# sourceMappingURL=button.js.map