"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFocusIcon = exports.renderFocusTreeFile = void 0;
const tslib_1 = require("tslib");
const imagecache_1 = require("../../util/image/imagecache");
const i18n_1 = require("../../util/i18n");
const common_1 = require("../../util/common");
const schema_1 = require("../../hoiformat/schema");
const html_1 = require("../../util/html");
const loader_1 = require("../../util/loader/loader");
const debug_1 = require("../../util/debug");
const styletable_1 = require("../../util/styletable");
const featureflags_1 = require("../../util/featureflags");
const lodash_1 = require("lodash");
const localisationIndex_1 = require("../../util/localisationIndex");
const featureflags_2 = require("../../util/featureflags");
const titlebar_1 = require("./titlebar");
const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';
function renderFocusTreeFile(loader, uri, webview) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
        try {
            const session = new loader_1.LoaderSession(false);
            const loadResult = yield loader.load(session);
            const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
            (0, debug_1.debug)('Loader session focus tree', loadedLoaders);
            const focustrees = loadResult.result.focusTrees;
            if (focustrees.length === 0) {
                const baseContent = (0, i18n_1.localize)('focustree.nofocustree', 'No focus tree.');
                return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
            }
            const styleTable = new styletable_1.StyleTable();
            const jsCodes = [];
            const styleNonce = (0, common_1.randomString)(32);
            const baseContent = yield renderFocusTrees(focustrees, styleTable, loadResult.result.gfxFiles, jsCodes, styleNonce, loader.file);
            jsCodes.push((0, i18n_1.i18nTableAsScript)());
            return (0, html_1.html)(webview, baseContent, [
                setPreviewFileUriScript,
                ...jsCodes.map(c => ({ content: c })),
                'common.js',
                'focustree.js',
            ], [
                'codicon.css',
                'common.css',
                styleTable,
                { nonce: styleNonce },
            ]);
        }
        catch (e) {
            const baseContent = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
    });
}
exports.renderFocusTreeFile = renderFocusTreeFile;
const leftPaddingBase = 50;
const topPaddingBase = 50;
const xGridSize = 96;
const yGridSize = 130;
function renderFocusTrees(focusTrees, styleTable, gfxFiles, jsCodes, styleNonce, file) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const leftPadding = leftPaddingBase;
        const topPadding = topPaddingBase;
        const gridBox = {
            position: { x: (0, schema_1.toNumberLike)(leftPadding), y: (0, schema_1.toNumberLike)(topPadding) },
            format: (0, schema_1.toStringAsSymbolIgnoreCase)('up'),
            size: { width: (0, schema_1.toNumberLike)(xGridSize), height: undefined },
            slotsize: { width: (0, schema_1.toNumberLike)(xGridSize), height: (0, schema_1.toNumberLike)(yGridSize) },
        };
        const titlebarStyles = yield (0, titlebar_1.loadFocusTitlebarStyles)();
        const renderedFocus = {};
        yield Promise.all((0, lodash_1.flatMap)(focusTrees, tree => Object.values(tree.focuses)).map((focus) => tslib_1.__awaiter(this, void 0, void 0, function* () { return renderedFocus[focus.id] = (yield renderFocus(focus, styleTable, gfxFiles, file, titlebarStyles)).replace(/\s\s+/g, ' '); })));
        jsCodes.push('window.focusTrees = ' + JSON.stringify(focusTrees));
        jsCodes.push('window.renderedFocus = ' + JSON.stringify(renderedFocus));
        jsCodes.push('window.gridBox = ' + JSON.stringify(gridBox));
        jsCodes.push('window.styleNonce = ' + JSON.stringify(styleNonce));
        jsCodes.push('window.useConditionInFocus = ' + featureflags_1.useConditionInFocus);
        jsCodes.push('window.xGridSize = ' + xGridSize);
        const continuousFocusContent = `<div id="continuousFocuses" class="${styleTable.oneTimeStyle('continuousFocuses', () => `
            position: absolute;
            width: 770px;
            height: 380px;
            margin: 20px;
            background: rgba(128, 128, 128, 0.2);
            text-align: center;
            pointer-events: none;
        `)}">Continuous focuses</div>`;
        return (`<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` +
            `<div id="focustreecontent" class="${styleTable.oneTimeStyle('focustreecontent', () => `top:40px;left:-20px;position:relative`)}">
            <div id="focustreeplaceholder"></div>
            ${continuousFocusContent}
        </div>` +
            renderWarningContainer(styleTable) +
            renderToolBar(focusTrees, styleTable));
    });
}
function renderWarningContainer(styleTable) {
    styleTable.style('warnings', () => 'outline: none;', ':focus');
    return `
    <div id="warnings-container" class="${styleTable.style('warnings-container', () => `
        height: 100vh;
        width: 100vw;
        position: fixed;
        top: 0;
        left: 0;
        padding-top: 40px;
        background: var(--vscode-editor-background);
        box-sizing: border-box;
        display: none;
    `)}">
        <textarea id="warnings" readonly wrap="off" class="${styleTable.style('warnings', () => `
            height: 100%;
            width: 100%;
            font-family: 'Consolas', monospace;
            resize: none;
            background: var(--vscode-editor-background);
            padding: 10px;
            border-top: none;
            border-left: none;
            border-bottom: none;
            box-sizing: border-box;
        `)}"></textarea>
    </div>`;
}
function renderToolBar(focusTrees, styleTable) {
    const focuses = focusTrees.length <= 1 ? '' : `
        <label for="focuses" class="${styleTable.style('focusesLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('focustree.focustree', 'Focus tree: ')}</label>
        <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
            <select id="focuses" class="select multiple-select" tabindex="0" role="combobox">
                ${focusTrees.map((focus, i) => `<option value="${i}">${focus.id}</option>`).join('')}
            </select>
        </div>`;
    const searchbox = `    
        <label for="searchbox" class="${styleTable.style('searchboxLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('focustree.search', 'Search: ')}</label>
        <input
            class="${styleTable.style('searchbox', () => `margin-right:10px`)}"
            id="searchbox"
            type="text"
        />`;
    const customTitlebars = `
        <label for="show-custom-titlebars">${(0, i18n_1.localize)('TODO', 'Custom titlebars')}</label>
        <input
            id="show-custom-titlebars"
            type="checkbox"
        />`;
    const allowbranch = `
        <div id="allowbranch-container">
            <label for="allowbranch" class="${styleTable.style('allowbranchLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('focustree.allowbranch', 'Allow branch: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="allowbranch" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    const conditions = `
        <div id="condition-container">
            <label for="conditions" class="${styleTable.style('conditionsLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('focustree.conditions', 'Conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox" class="${styleTable.style('conditionsLabel', () => `max-width:400px`)}">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    const warningsButton = focusTrees.every(ft => ft.warnings.length === 0) ? '' : `
        <button id="show-warnings" title="${(0, i18n_1.localize)('focustree.warnings', 'Toggle warnings')}">
            <i class="codicon codicon-warning"></i>
        </button>`;
    return `<div class="toolbar-outer ${styleTable.style('toolbar-height', () => `box-sizing: border-box; height: 40px;`)}">
        <div class="toolbar">
            ${focuses}
            ${searchbox}
            ${customTitlebars}
            ${featureflags_1.useConditionInFocus ? conditions : allowbranch}
            ${warningsButton}
        </div>
    </div>`;
}
function renderFocus(focus, styleTable, gfxFiles, file, titlebarStyles) {
    var _a, _b, _c;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        for (const focusIcon of focus.icon) {
            const iconName = focusIcon.icon;
            const iconObject = iconName ? yield getFocusIcon(iconName, gfxFiles) : null;
            styleTable.style('focus-icon-' + (0, styletable_1.normalizeForStyle)(iconName !== null && iconName !== void 0 ? iconName : '-empty'), () => `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width : 0}px;`);
        }
        styleTable.style('focus-icon-' + (0, styletable_1.normalizeForStyle)('-empty'), () => 'background: grey;');
        const titlebarObject = yield (0, titlebar_1.getFocusTitlebarImage)(focus.textIcon, titlebarStyles);
        const titlebarClass = 'focus-titlebar-' + (0, styletable_1.normalizeForStyle)((_a = focus.textIcon) !== null && _a !== void 0 ? _a : '-empty');
        styleTable.style(titlebarClass, () => titlebarObject ? `
            background-image: url(${titlebarObject.uri});
            width: ${titlebarObject.width}px;
            height: ${titlebarObject.height}px;
            background-size: ${titlebarObject.width}px ${titlebarObject.height}px;
        ` : `
            display: none;
        `);
        let textContent = focus.id;
        if (featureflags_2.localisationIndex) {
            let localizedText = yield (0, localisationIndex_1.getLocalisedTextQuick)(focus.id);
            if (localizedText === focus.id || !localizedText) {
                if (focus.text) {
                    localizedText = yield (0, localisationIndex_1.getLocalisedTextQuick)(focus.text);
                    if (localizedText !== focus.text && localizedText != null) {
                        textContent += `<br/>${localizedText}`;
                    }
                }
            }
            else {
                textContent += `<br/>${localizedText}`;
            }
        }
        return `<div
    class="
        navigator
        {{iconClass}}
        ${styleTable.style('focus-common', () => `
            position: relative;
            background-position-x: center;
            background-position-y: calc(50% - 18px);
            background-repeat: no-repeat;
            width: 100%;
            height: 100%;
            text-align: center;
            cursor: pointer;
        `)}
    "
    start="${(_b = focus.token) === null || _b === void 0 ? void 0 : _b.start}"
    end="${(_c = focus.token) === null || _c === void 0 ? void 0 : _c.end}"
    ${file === focus.file ? '' : `file="${focus.file}"`}
    title="${focus.id}\n({{position}})">
        <div
        class="focus-titlebar-layer ${titlebarClass} ${styleTable.style('focus-titlebar-layer', () => `
            position: absolute;
            left: 50%;
            top: 61px;
            transform: translateX(-50%);
            background-repeat: no-repeat;
            pointer-events: none;
            z-index: 0;
        `)}"
        data-has-custom-titlebar="${titlebarObject ? 'true' : 'false'}"></div>
        <div class="focus-checkbox ${styleTable.style('focus-checkbox', () => `position: absolute; top: 1px;`)}">
            <input id="checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}" type="checkbox"/>
        </div>
        <span
        class="${styleTable.style('focus-span', () => `
            position: relative;
            z-index: 1;
            margin: 10px -400px;
            margin-top: 85px;
            text-align: center;
            display: inline-block;
        `)}">
        ${textContent}
        </span>
    </div>`;
    });
}
function getFocusIcon(name, gfxFiles) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const sprite = yield (0, imagecache_1.getSpriteByGfxName)(name, gfxFiles);
        if (sprite !== undefined) {
            return sprite.image;
        }
        return yield (0, imagecache_1.getImageByPath)(defaultFocusIcon);
    });
}
exports.getFocusIcon = getFocusIcon;
//# sourceMappingURL=contentbuilder.js.map