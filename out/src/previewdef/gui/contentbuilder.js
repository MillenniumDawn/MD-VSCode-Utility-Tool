"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGuiFile = renderGuiFile;
const lodash_1 = require("lodash");
const schema_1 = require("../../hoiformat/schema");
const common_1 = require("../../util/common");
const debug_1 = require("../../util/debug");
const common_2 = require("../../util/hoi4gui/common");
const containerwindow_1 = require("../../util/hoi4gui/containerwindow");
const html_1 = require("../../util/html");
const i18n_1 = require("../../util/i18n");
const imagecache_1 = require("../../util/image/imagecache");
const loader_1 = require("../../util/loader/loader");
const styletable_1 = require("../../util/styletable");
async function renderGuiFile(loader, uri, webview) {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
    try {
        const session = new loader_1.LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
        (0, debug_1.debug)('Loader session gui', loadedLoaders);
        const guiFiles = loadResult.result.guiFiles;
        const containerWindows = (0, lodash_1.chain)(guiFiles).flatMap(g => g.data.guitypes).flatMap(gt => [...gt.containerwindowtype, ...gt.windowtype]).value();
        if (containerWindows.length === 0) {
            const baseContent = (0, i18n_1.localize)('guipreview.nocontainerwindows', 'No containerwindowtype in gui file.');
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
        const styleTable = new styletable_1.StyleTable();
        const baseContent = await renderGuiContainerWindows(containerWindows, styleTable, loadResult.result);
        return (0, html_1.html)(webview, baseContent, [
            setPreviewFileUriScript,
            { content: 'window.containerWindowToggles = ' + JSON.stringify(makeToggleContainerWindowCheckboxes(containerWindows, styleTable)) + ';' },
            'common.js',
            'guipreview.js',
        ], [
            'common.css',
            'codicon.css',
            styleTable,
        ]);
    }
    catch (e) {
        const baseContent = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
        return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
    }
}
async function renderGuiContainerWindows(containerWindows, styleTable, loadResult) {
    const gfxFiles = loadResult.gfxFiles;
    const renderedWindows = (await Promise.all(containerWindows.map(cw => renderSingleContainerWindow(cw, styleTable, gfxFiles)))).join('');
    return `
    ${renderTopBar(containerWindows.map(cw => cw.name).filter((name) => name !== undefined), styleTable)}
    <div
    id="dragger"
    class="${styleTable.oneTimeStyle('dragger', () => `
        width: 100vw;
        height: 100vh;
        position: fixed;
        left:0;
        top:0;
        background: var(--vscode-editor-background);
    `)}">
    </div>
    <div
    id="mainContent"
    class="${styleTable.oneTimeStyle('mainContent', () => `
        position: absolute;
        left: 0;
        top: 0;
        margin-top: 40px;
    `)}">
        ${renderedWindows}
    </div>`;
}
function renderTopBar(folders, styleTable) {
    return `<div
    class="${styleTable.oneTimeStyle('folderSelectorBar', () => `
        position: fixed;
        padding-top: 9px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        z-index: 10;
    `)}">
        <label for="folderSelector" class="${styleTable.oneTimeStyle('folderSelectorLabel', () => `margin-right:5px`)}">
            ${(0, i18n_1.localize)('guipreview.containerWindow', 'Container Window: ')}
        </label>
        <div class="select-container">
            <select
                id="folderSelector"
                type="text"
                class="${styleTable.oneTimeStyle('folderSelector', () => `min-width:200px`)}"
            >
                ${folders.map(folder => `<option value="containerwindow_${folder}">${folder}</option>`)}
            </select>
        </div>
        <button id="refresh" title="${(0, i18n_1.localize)('common.topbar.refresh.title', 'Refresh')}">
            <i class="codicon codicon-refresh"></i>
        </button>
        <button id="toggleVisibility" title="${(0, i18n_1.localize)('guipreview.topbar.toggleVisibility.title', 'Show or Hide Container Windows')}">
            <i class="codicon codicon-eye"></i>
        </button>
    </div>
    <div
    id="toggleVisibilityContent"
    class="${styleTable.oneTimeStyle('toggleVisibilityContent', () => `
        position: fixed;
        margin-top: 10px;
        width: 100%;
        height: 200px;
        top: 30px;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        z-index: 10;
        overflow: auto;
        display: none;
    `)}">
        <div id="toggleVisibilityContentInner" class="${styleTable.oneTimeStyle('toggleVisibilityContentInner', () => `
            padding-left: 20px;
        `)}">
        </div>
    </div>`;
}
async function renderSingleContainerWindow(containerWindow, styleTable, gfxFiles) {
    let children;
    const commonOptions = {
        getSprite: defaultGetSprite(gfxFiles),
        styleTable,
    };
    const size = { width: 1920, height: 1080 };
    const width = (0, common_2.getWidth)(containerWindow.size);
    const height = (0, common_2.getHeight)(containerWindow.size);
    if (!width?._unit && width?._value !== undefined) {
        size.width = width._value;
    }
    if (!height?._unit && height?._value !== undefined) {
        size.height = height._value;
    }
    const position = containerWindow.position ? { ...containerWindow.position } : { x: undefined, y: undefined };
    if (position.x?._value !== undefined && position.x?._value < 0) {
        position.x = { ...position.x, _value: 0 };
    }
    if (position.y?._value !== undefined && position.y?._value < 0) {
        position.y = { ...position.y, _value: 0 };
    }
    const onRenderChild = async (type, child, parentInfo) => {
        if (type === 'containerwindow') {
            const childContainerWindow = child;
            return await (0, containerwindow_1.renderContainerWindow)(childContainerWindow, parentInfo, {
                ...commonOptions,
                classNames: 'childcontainerwindow_' + (0, styletable_1.normalizeForStyle)(childContainerWindow.name ?? ''),
                enableNavigator: true,
                onRenderChild,
            });
        }
    };
    children = await (0, containerwindow_1.renderContainerWindow)({
        ...containerWindow,
        position: position,
        orientation: (0, schema_1.toStringAsSymbolIgnoreCase)('upper_left'),
        origo: (0, schema_1.toStringAsSymbolIgnoreCase)('upper_left'),
    }, {
        size,
        orientation: 'upper_left',
    }, {
        ...commonOptions,
        ignorePosition: false,
        enableNavigator: true,
        onRenderChild,
    });
    return `<div
        id="containerwindow_${containerWindow.name}"
        class="
            containerwindow
            containerwindow_${(0, styletable_1.normalizeForStyle)(containerWindow.name ?? '')}
            ${styleTable.style('displayNone', () => `display:none;`)}"
    >
        ${children}
    </div>`;
}
function makeToggleContainerWindowCheckboxes(containerWindows, styleTable) {
    return (0, common_1.arrayToMap)(containerWindows.map(cw => {
        return { name: cw.name ?? '', content: makeToggleContainerWindowCheckboxesRecursively(cw, styleTable, '', 0) };
    }), 'name');
}
function makeToggleContainerWindowCheckboxesRecursively(containerWindow, styleTable, prefix, level) {
    const childWindows = [...containerWindow.containerwindowtype, ...containerWindow.windowtype];
    childWindows.sort((a, b) => (a._index ?? 0) - (b._index ?? 0));
    return childWindows.map(cw => {
        const normalizedName = (0, styletable_1.normalizeForStyle)(cw.name ?? '');
        return `<div class="${styleTable.oneTimeStyle('level-' + level, () => 'padding-left: ' + (level * 20) + 'px;')}">
            <input
                type="checkbox"
                id="toggleContainerWindow_${prefix}${normalizedName}"
                containerWindowName="${cw.name}"
                checked="checked"
                class="toggleContainerWindowCheckbox"
            />
        </div>` + makeToggleContainerWindowCheckboxesRecursively(cw, styleTable, prefix + normalizedName + '_', level + 1);
    }).join('');
}
function defaultGetSprite(gfxFiles) {
    return (sprite) => {
        return (0, imagecache_1.getSpriteByGfxName)(sprite, gfxFiles);
    };
}
//# sourceMappingURL=contentbuilder.js.map