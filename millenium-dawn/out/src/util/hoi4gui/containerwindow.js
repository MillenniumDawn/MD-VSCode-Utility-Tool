"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onRenderChildOrDefault = exports.renderContainerWindowChildren = exports.renderContainerWindow = void 0;
const tslib_1 = require("tslib");
const common_1 = require("./common");
const icon_1 = require("./icon");
const instanttextbox_1 = require("./instanttextbox");
const gridbox_1 = require("./gridbox");
const nodecommon_1 = require("./nodecommon");
const button_1 = require("./button");
function renderContainerWindow(containerWindow, parentInfo, options) {
    var _a, _b;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [x, y, width, height, orientation] = (0, common_1.calculateBBox)(containerWindow, parentInfo);
        const size = { width, height };
        const margin = (0, common_1.normalizeMargin)(containerWindow.margin, size);
        const myInfo = {
            size: {
                width: size.width - margin[1] - margin[3],
                height: size.height - margin[0] - margin[2],
            },
            orientation,
        };
        const background = yield (0, nodecommon_1.renderBackground)(containerWindow.background, { size, orientation }, options);
        const children = yield renderContainerWindowChildren(containerWindow, myInfo, Object.assign(Object.assign({}, options), { ignorePosition: undefined }));
        return `<div
    ${options.id ? `id="${options.id}"` : ''}
    start="${(_a = containerWindow._token) === null || _a === void 0 ? void 0 : _a.start}"
    end="${(_b = containerWindow._token) === null || _b === void 0 ? void 0 : _b.end}"
    class="
        ${(options === null || options === void 0 ? void 0 : options.classNames) ? options.classNames : ''}
        ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
        ${options.styleTable.style('borderBox', () => `box-sizing: border-box;`)}
        ${options.styleTable.oneTimeStyle('containerwindow', () => `
            left: ${options.ignorePosition ? 0 : x}px;
            top: ${options.ignorePosition ? 0 : y}px;
            width: ${options.noSize ? 0 : width}px;
            height: ${options.noSize ? 0 : height}px;
        `)}
        ${options.enableNavigator ? 'navigator navigator-highlight' : ''}
    ">
        ${background}
        <div class="
            ${options.styleTable.style('positionAbsolute', () => `position: absolute;`)}
            ${options.styleTable.oneTimeStyle('containerwindowChildren', () => `
                left: ${margin[3]}px;
                top: ${margin[0]}px;
            `)}
        ">
            ${children}
        </div>
    </div>`;
    });
}
exports.renderContainerWindow = renderContainerWindow;
function renderContainerWindowChildren(containerWindow, myInfo, options) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const containerWindowChildren = [...containerWindow.containerwindowtype, ...containerWindow.windowtype]
            .map(c => onRenderChildOrDefault(options.onRenderChild, 'containerwindow', c, myInfo, c1 => renderContainerWindow(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
        const gridboxChildren = containerWindow.gridboxtype
            .map(c => onRenderChildOrDefault(options.onRenderChild, 'gridbox', c, myInfo, c1 => (0, gridbox_1.renderGridBox)(c1, myInfo, (0, common_1.removeHtmlOptions)(Object.assign(Object.assign({}, options), { items: {} })))));
        const iconChildren = containerWindow.icontype
            .map(c => onRenderChildOrDefault(options.onRenderChild, 'icon', c, myInfo, c1 => (0, icon_1.renderIcon)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
        const instantTextBoxChildren = [...containerWindow.instanttextboxtype, ...containerWindow.textboxtype]
            .map(c => onRenderChildOrDefault(options.onRenderChild, 'instanttextbox', c, myInfo, c1 => (0, instanttextbox_1.renderInstantTextBox)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
        const buttonChildren = [...containerWindow.buttontype, ...containerWindow.checkboxtype, ...containerWindow.guibuttontype]
            .map(c => onRenderChildOrDefault(options.onRenderChild, 'button', c, myInfo, c1 => (0, button_1.renderButton)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
        const result = (yield Promise.all([
            ...containerWindowChildren,
            ...gridboxChildren,
            ...iconChildren,
            ...instantTextBoxChildren,
            ...buttonChildren,
        ]));
        result.sort((a, b) => a[0] - b[0]);
        return result.map(v => v[1]).join('');
    });
}
exports.renderContainerWindowChildren = renderContainerWindowChildren;
function onRenderChildOrDefault(onRenderChild, type, child, parentInfo, defaultRenderer) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let result = undefined;
        if (onRenderChild) {
            result = yield onRenderChild(type, child, parentInfo);
        }
        return [
            child._index || 0,
            result !== undefined ? result : yield defaultRenderer(child),
        ];
    });
}
exports.onRenderChildOrDefault = onRenderChildOrDefault;
//# sourceMappingURL=containerwindow.js.map