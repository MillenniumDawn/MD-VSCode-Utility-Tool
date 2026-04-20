"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderContainerWindow = renderContainerWindow;
exports.renderContainerWindowChildren = renderContainerWindowChildren;
exports.onRenderChildOrDefault = onRenderChildOrDefault;
const common_1 = require("./common");
const icon_1 = require("./icon");
const instanttextbox_1 = require("./instanttextbox");
const gridbox_1 = require("./gridbox");
const nodecommon_1 = require("./nodecommon");
const button_1 = require("./button");
async function renderContainerWindow(containerWindow, parentInfo, options) {
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
    const background = await (0, nodecommon_1.renderBackground)(containerWindow.background, { size, orientation }, options);
    const children = await renderContainerWindowChildren(containerWindow, myInfo, { ...options, ignorePosition: undefined });
    return `<div
    ${options.id ? `id="${options.id}"` : ''}
    start="${containerWindow._token?.start}"
    end="${containerWindow._token?.end}"
    class="
        ${options?.classNames ? options.classNames : ''}
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
}
async function renderContainerWindowChildren(containerWindow, myInfo, options) {
    const containerWindowChildren = [...containerWindow.containerwindowtype, ...containerWindow.windowtype]
        .map(c => onRenderChildOrDefault(options.onRenderChild, 'containerwindow', c, myInfo, c1 => renderContainerWindow(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
    const gridboxChildren = containerWindow.gridboxtype
        .map(c => onRenderChildOrDefault(options.onRenderChild, 'gridbox', c, myInfo, c1 => (0, gridbox_1.renderGridBox)(c1, myInfo, (0, common_1.removeHtmlOptions)({ ...options, items: {} }))));
    const iconChildren = containerWindow.icontype
        .map(c => onRenderChildOrDefault(options.onRenderChild, 'icon', c, myInfo, c1 => (0, icon_1.renderIcon)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
    const instantTextBoxChildren = [...containerWindow.instanttextboxtype, ...containerWindow.textboxtype]
        .map(c => onRenderChildOrDefault(options.onRenderChild, 'instanttextbox', c, myInfo, c1 => (0, instanttextbox_1.renderInstantTextBox)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
    const buttonChildren = [...containerWindow.buttontype, ...containerWindow.checkboxtype, ...containerWindow.guibuttontype]
        .map(c => onRenderChildOrDefault(options.onRenderChild, 'button', c, myInfo, c1 => (0, button_1.renderButton)(c1, myInfo, (0, common_1.removeHtmlOptions)(options))));
    const result = (await Promise.all([
        ...containerWindowChildren,
        ...gridboxChildren,
        ...iconChildren,
        ...instantTextBoxChildren,
        ...buttonChildren,
    ]));
    result.sort((a, b) => a[0] - b[0]);
    return result.map(v => v[1]).join('');
}
async function onRenderChildOrDefault(onRenderChild, type, child, parentInfo, defaultRenderer) {
    let result = undefined;
    if (onRenderChild) {
        result = await onRenderChild(type, child, parentInfo);
    }
    return [
        child._index || 0,
        result !== undefined ? result : await defaultRenderer(child),
    ];
}
//# sourceMappingURL=containerwindow.js.map