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
const containerwindow_1 = require("../../util/hoi4gui/containerwindow");
const common_2 = require("../../util/hoi4gui/common");
const instanttextbox_1 = require("../../util/hoi4gui/instanttextbox");
const nodecommon_1 = require("../../util/hoi4gui/nodecommon");
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
        const renderedInlayWindows = {};
        yield Promise.all((0, lodash_1.flatMap)(focusTrees, tree => Object.values(tree.focuses)).map((focus) => tslib_1.__awaiter(this, void 0, void 0, function* () { return renderedFocus[focus.id] = (yield renderFocus(focus, styleTable, gfxFiles, file, titlebarStyles)).replace(/\s\s+/g, ' '); })));
        yield prepareInlayGfxStyles(focusTrees, styleTable);
        yield Promise.all((0, lodash_1.flatMap)(focusTrees, tree => tree.inlayWindows).map((inlay) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            renderedInlayWindows[inlay.id] = (yield renderInlayWindow(inlay, styleTable, gfxFiles)).replace(/\s\s+/g, ' ');
        })));
        jsCodes.push('window.focusTrees = ' + JSON.stringify(focusTrees));
        jsCodes.push('window.renderedFocus = ' + JSON.stringify(renderedFocus));
        jsCodes.push('window.renderedInlayWindows = ' + JSON.stringify(renderedInlayWindows));
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
            <div id="inlaywindowplaceholder"></div>
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
        <div class="${styleTable.style('customTitlebarsContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-custom-titlebars">${(0, i18n_1.localize)('TODO', 'Custom titlebars')}</label>
            <input
                id="show-custom-titlebars"
                type="checkbox"
            />
        </div>`;
    const focusOverlays = `
        <div class="${styleTable.style('focusOverlaysContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-focus-overlays">${(0, i18n_1.localize)('TODO', 'Focus overlays')}</label>
            <input
                id="show-focus-overlays"
                type="checkbox"
            />
        </div>`;
    const inlayWindowsToggle = `
        <div id="show-inlay-windows-container" class="${styleTable.style('inlayWindowsContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-inlay-windows">${(0, i18n_1.localize)('TODO', 'Inlay windows')}</label>
            <input
                id="show-inlay-windows"
                type="checkbox"
            />
        </div>`;
    const inlayWindows = `
        <div id="inlay-window-container">
            <label for="inlay-windows" class="${styleTable.style('inlayWindowsLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('TODO', 'Inlay window: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <select id="inlay-windows" class="select multiple-select" tabindex="0" role="combobox"></select>
            </div>
        </div>`;
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
            <label for="conditions" class="${styleTable.style('conditionsLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('TODO', 'Focus conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox" class="${styleTable.style('conditionsLabel', () => `max-width:400px`)}">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    const inlayConditions = `
        <div id="inlay-condition-container">
            <label for="inlay-conditions" class="${styleTable.style('inlayConditionsLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('TODO', 'Inlay conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="inlay-conditions" class="select multiple-select" tabindex="0" role="combobox">
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
            ${focusOverlays}
            ${inlayWindowsToggle}
            ${inlayWindows}
            ${featureflags_1.useConditionInFocus ? conditions + inlayConditions : allowbranch}
            ${warningsButton}
        </div>
    </div>`;
}
function getInlayGfxStyleKey(gfxName, gfxFile) {
    return 'inlay-gfx-' + (0, styletable_1.normalizeForStyle)((gfxFile !== null && gfxFile !== void 0 ? gfxFile : 'missing') + '-' + gfxName);
}
function prepareInlayGfxStyles(focusTrees, styleTable) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const processed = new Set();
        for (const focusTree of focusTrees) {
            for (const inlay of focusTree.inlayWindows) {
                for (const slot of inlay.scriptedImages) {
                    for (const option of slot.gfxOptions) {
                        const key = getInlayGfxStyleKey(option.gfxName, option.gfxFile);
                        if (processed.has(key)) {
                            continue;
                        }
                        processed.add(key);
                        if (!option.gfxFile) {
                            styleTable.style(key, () => `
                            width: 96px;
                            height: 96px;
                            background: rgba(127, 127, 127, 0.35);
                            border: 1px dashed var(--vscode-panel-border);
                        `);
                            continue;
                        }
                        const sprite = yield (0, imagecache_1.getSpriteByGfxName)(option.gfxName, option.gfxFile);
                        const frame = sprite === null || sprite === void 0 ? void 0 : sprite.frames[0];
                        if (!frame) {
                            styleTable.style(key, () => `
                            width: 96px;
                            height: 96px;
                            background: rgba(127, 127, 127, 0.35);
                            border: 1px dashed var(--vscode-panel-border);
                        `);
                            continue;
                        }
                        styleTable.style(key, () => `
                        width: ${Math.min(frame.width, 144)}px;
                        height: ${Math.min(frame.height, 144)}px;
                        background-image: url(${frame.uri});
                        background-repeat: no-repeat;
                        background-position: center;
                        background-size: contain;
                    `);
                    }
                }
            }
        }
    });
}
function renderInlayWindow(inlay, styleTable, gfxFiles) {
    var _a, _b;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!inlay.guiWindow) {
            return '';
        }
        const parentInfo = {
            size: {
                width: 1920,
                height: 1080,
            },
            orientation: 'upper_left',
        };
        const content = yield (0, containerwindow_1.renderContainerWindow)(Object.assign(Object.assign({}, inlay.guiWindow), { position: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) } }), parentInfo, {
            styleTable,
            enableNavigator: true,
            classNames: 'focus-inlay-window navigator',
            getSprite: (sprite) => (0, imagecache_1.getSpriteByGfxName)(sprite, gfxFiles),
            onRenderChild: (type, child, parent) => tslib_1.__awaiter(this, void 0, void 0, function* () { return renderInlayOverrideChild(type, child, parent, inlay, styleTable, gfxFiles); }),
        });
        return `<div class="${styleTable.style('focus-inlay-window-root', () => `
        position: absolute;
        left: ${inlay.position.x}px;
        top: ${inlay.position.y}px;
        z-index: 5;
    `)}" start="${(_a = inlay.token) === null || _a === void 0 ? void 0 : _a.start}" end="${(_b = inlay.token) === null || _b === void 0 ? void 0 : _b.end}" file="${inlay.file}">${content}</div>`;
    });
}
function renderInlayOverrideChild(type, child, parentInfo, inlay, styleTable, gfxFiles) {
    var _a, _b, _c, _d, _e;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if ((type !== 'icon' && type !== 'button') || !child.name) {
            return undefined;
        }
        const slot = inlay.scriptedImages.find(scriptedImage => scriptedImage.id === child.name);
        if (!slot) {
            return undefined;
        }
        const spriteOption = (_a = slot.gfxOptions.find(option => option.gfxFile)) !== null && _a !== void 0 ? _a : slot.gfxOptions[0];
        if (!spriteOption) {
            return undefined;
        }
        const sprite = spriteOption.gfxFile ? yield (0, imagecache_1.getSpriteByGfxName)(spriteOption.gfxName, spriteOption.gfxFile) : yield (0, imagecache_1.getSpriteByGfxName)(spriteOption.gfxName, gfxFiles);
        if (!sprite) {
            return undefined;
        }
        const iconLikeChild = child;
        let [x, y] = (0, common_2.calculateBBox)(iconLikeChild, parentInfo);
        if (iconLikeChild.centerposition) {
            x -= sprite.width / 2;
            y -= sprite.height / 2;
        }
        const scale = (_b = iconLikeChild.scale) !== null && _b !== void 0 ? _b : 1;
        const gfxClassPlaceholder = `{{inlay_slot_class:${slot.id}}}`;
        const spriteHtml = (0, nodecommon_1.renderSprite)({ x: 0, y: 0 }, sprite, sprite, 0, scale, {
            styleTable,
            classNames: gfxClassPlaceholder,
        });
        const textHtml = type === 'button' ? yield (0, instanttextbox_1.renderInstantTextBox)(Object.assign(Object.assign({}, iconLikeChild), { position: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) }, bordersize: { x: (0, schema_1.toNumberLike)(0), y: (0, schema_1.toNumberLike)(0) }, maxheight: (0, schema_1.toNumberLike)(sprite.height * scale), maxwidth: (0, schema_1.toNumberLike)(sprite.width * scale), font: iconLikeChild.buttonfont, text: (_c = iconLikeChild.buttontext) !== null && _c !== void 0 ? _c : iconLikeChild.text, format: (0, schema_1.toStringAsSymbolIgnoreCase)('center'), vertical_alignment: 'center', orientation: (0, schema_1.toStringAsSymbolIgnoreCase)('upper_left') }), parentInfo, { styleTable }) : '';
        return `<div
        start="${(_d = child._token) === null || _d === void 0 ? void 0 : _d.start}"
        end="${(_e = child._token) === null || _e === void 0 ? void 0 : _e.end}"
        class="navigator ${styleTable.style('positionAbsolute', () => `position: absolute;`)} ${styleTable.oneTimeStyle('inlay-gui-slot', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${sprite.width * scale}px;
            height: ${sprite.height * scale}px;
        `)}">
            ${spriteHtml}
            ${textHtml}
        </div>`;
    });
}
function renderFocus(focus, styleTable, gfxFiles, file, titlebarStyles) {
    var _a, _b, _c, _d;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        for (const focusIcon of focus.icon) {
            const iconName = focusIcon.icon;
            const iconObject = iconName ? yield getFocusIcon(iconName, gfxFiles) : null;
            styleTable.style('focus-icon-' + (0, styletable_1.normalizeForStyle)(iconName !== null && iconName !== void 0 ? iconName : '-empty'), () => `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width : 0}px;`);
        }
        styleTable.style('focus-icon-' + (0, styletable_1.normalizeForStyle)('-empty'), () => 'background: grey;');
        const titlebarObject = yield (0, titlebar_1.getFocusTitlebarImage)(focus.textIcon, titlebarStyles);
        const titlebarClass = styleTable.style('focus-titlebar-' + (0, styletable_1.normalizeForStyle)((_a = focus.textIcon) !== null && _a !== void 0 ? _a : '-empty'), () => titlebarObject ? `
            background-image: url(${titlebarObject.uri});
            width: ${titlebarObject.width}px;
            height: ${titlebarObject.height}px;
            background-size: ${titlebarObject.width}px ${titlebarObject.height}px;
        ` : `
            display: none;
        `);
        const overlayObject = yield (0, titlebar_1.getFocusOverlayImage)(focus.overlay);
        const overlayClass = styleTable.style('focus-overlay-' + (0, styletable_1.normalizeForStyle)((_b = focus.overlay) !== null && _b !== void 0 ? _b : '-empty'), () => overlayObject ? `
            background-image: url(${overlayObject.uri});
            width: ${overlayObject.width}px;
            height: ${overlayObject.height}px;
            background-size: ${overlayObject.width}px ${overlayObject.height}px;
            display: block;
        ` : `
            display: none;
        `);
        let textContent = focus.id;
        if (featureflags_2.localisationIndex) {
            let localizedText = yield (0, localisationIndex_1.getLocalisedTextQuick)(focus.id);
            if (localizedText === focus.id || !localizedText) {
                if (focus.text) {
                    localizedText = yield (0, localisationIndex_1.getLocalisedTextQuick)(focus.text);
                    if (localizedText !== focus.text && localizedText !== null) {
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
        ${styleTable.style('focus-common', () => `
            position: relative;
            width: 100%;
            height: 100%;
            text-align: center;
            cursor: pointer;
        `)}
    "
    start="${(_c = focus.token) === null || _c === void 0 ? void 0 : _c.start}"
    end="${(_d = focus.token) === null || _d === void 0 ? void 0 : _d.end}"
    ${file === focus.file ? '' : `file="${focus.file}"`}
    title="${focus.id}\n({{position}})">
        <div
        class="{{iconClass}} ${styleTable.style('focus-icon-layer', () => `
            position: absolute;
            inset: 0;
            background-position-x: center;
            background-position-y: calc(50% - 18px);
            background-repeat: no-repeat;
            z-index: 1;
            pointer-events: none;
        `)}"></div>
        <div
        class="focus-titlebar-layer ${titlebarClass} ${styleTable.style('focus-titlebar-layer', () => `
            position: absolute;
            left: 50%;
            top: 70px;
            transform: translateX(-50%);
            background-repeat: no-repeat;
            pointer-events: none;
            z-index: 0;
        `)}"
        data-has-custom-titlebar="${titlebarObject ? 'true' : 'false'}"></div>
        <div
        class="focus-overlay-layer ${overlayClass} ${styleTable.style('focus-overlay-layer', () => `
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, calc(-50% - 3px));
            background-repeat: no-repeat;
            pointer-events: none;
            z-index: 2;
        `)}"
        data-has-focus-overlay="${overlayObject ? 'true' : 'false'}"></div>
        <div class="focus-checkbox ${styleTable.style('focus-checkbox', () => `position: absolute; top: 1px; z-index: 3;`)}">
            <input id="checkbox-${(0, styletable_1.normalizeForStyle)(focus.id)}" type="checkbox"/>
        </div>
        <span
        class="${styleTable.style('focus-span', () => `
            position: relative;
            z-index: 3;
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