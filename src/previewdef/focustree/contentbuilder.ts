import * as vscode from 'vscode';
import { FocusTree, Focus } from './schema';
import { getSpriteByGfxName, Image, getImageByPath } from '../../util/image/imagecache';
import { localize, i18nTableAsScript } from '../../util/i18n';
import { forceError, randomString } from '../../util/common';
import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { html, htmlEscape } from '../../util/html';
import { GridBoxType } from '../../hoiformat/gui';
import { FocusTreeLoader } from './loader';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { useConditionInFocus } from '../../util/featureflags';
import { flatMap } from 'lodash';
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { localisationIndex } from "../../util/featureflags";
import { getFocusTitlebarImage, getFocusOverlayImage, loadFocusTitlebarStyles } from "./titlebar";
import { renderContainerWindow, RenderChildTypeMap } from "../../util/hoi4gui/containerwindow";
import { calculateBBox, ParentInfo } from "../../util/hoi4gui/common";
import { renderInstantTextBox } from "../../util/hoi4gui/instanttextbox";
import { renderSprite } from "../../util/hoi4gui/nodecommon";
import { ContainerWindowType, IconType, ButtonType } from "../../hoiformat/gui";

const defaultFocusIcon = 'gfx/interface/goals/goal_unknown.dds';

export async function renderFocusTreeFile(loader: FocusTreeLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };

    try {
        const session = new LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
        debug('Loader session focus tree', loadedLoaders);

        const focustrees = loadResult.result.focusTrees;

        if (focustrees.length === 0) {
            const baseContent = localize('focustree.nofocustree', 'No focus tree.');
            return html(webview, baseContent, [ setPreviewFileUriScript ], []);
        }

        const styleTable = new StyleTable();
        const jsCodes: string[] = [];
        const styleNonce = randomString(32);
        const baseContent = await renderFocusTrees(focustrees, styleTable, loadResult.result.gfxFiles, jsCodes, styleNonce, loader.file);
        jsCodes.push(i18nTableAsScript());

        return html(
            webview,
            baseContent,
            [
                setPreviewFileUriScript,
                ...jsCodes.map(c => ({ content: c })),
                'common.js',
                'focustree.js',
            ],
            [
                'codicon.css',
                'common.css',
                styleTable,
                { nonce: styleNonce },
            ],
        );

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return html(webview, baseContent, [ setPreviewFileUriScript ], []);
    }
}

const leftPaddingBase = 50;
const topPaddingBase = 50;
const xGridSize = 96;
const yGridSize = 130;

async function renderFocusTrees(focusTrees: FocusTree[], styleTable: StyleTable, gfxFiles: string[], jsCodes: string[], styleNonce: string, file: string): Promise<string> {
    const leftPadding = leftPaddingBase;
    const topPadding = topPaddingBase;

    const gridBox: HOIPartial<GridBoxType> = {
        position: { x: toNumberLike(leftPadding), y: toNumberLike(topPadding) },
        format: toStringAsSymbolIgnoreCase('up'),
        size: { width: toNumberLike(xGridSize), height: undefined },
        slotsize: { width: toNumberLike(xGridSize), height: toNumberLike(yGridSize) },
    } as HOIPartial<GridBoxType>;

    const titlebarStyles = await loadFocusTitlebarStyles();
    const renderedFocus: Record<string, string> = {};
    const renderedInlayWindows: Record<string, string> = {};
    await Promise.all(flatMap(focusTrees, tree => Object.values(tree.focuses)).map(async (focus) =>
        renderedFocus[focus.id] = (await renderFocus(focus, styleTable, gfxFiles, file, titlebarStyles)).replace(/\s\s+/g, ' ')));
    await prepareInlayGfxStyles(focusTrees, styleTable);
    await Promise.all(flatMap(focusTrees, tree => tree.inlayWindows).map(async (inlay) => {
        renderedInlayWindows[inlay.id] = (await renderInlayWindow(inlay, styleTable, gfxFiles)).replace(/\s\s+/g, ' ');
    }));

    jsCodes.push('window.focusTrees = ' + JSON.stringify(focusTrees));
    jsCodes.push('window.renderedFocus = ' + JSON.stringify(renderedFocus));
    jsCodes.push('window.renderedInlayWindows = ' + JSON.stringify(renderedInlayWindows));
    jsCodes.push('window.gridBox = ' + JSON.stringify(gridBox));
    jsCodes.push('window.styleNonce = ' + JSON.stringify(styleNonce));
    jsCodes.push('window.useConditionInFocus = ' + useConditionInFocus);
    jsCodes.push('window.xGridSize = ' + xGridSize);

    const continuousFocusContent =
        `<div id="continuousFocuses" class="${styleTable.oneTimeStyle('continuousFocuses', () => `
            position: absolute;
            width: 770px;
            height: 380px;
            margin: 20px;
            background: rgba(128, 128, 128, 0.2);
            text-align: center;
            pointer-events: none;
        `)}">Continuous focuses</div>`;

    return (
        `<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
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
        renderToolBar(focusTrees, styleTable)
    );
}

function renderWarningContainer(styleTable: StyleTable) {
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

function renderToolBar(focusTrees: FocusTree[], styleTable: StyleTable): string {
    const focuses = focusTrees.length <= 1 ? '' : `
        <label for="focuses" class="${styleTable.style('focusesLabel', () => `margin-right:5px`)}">${localize('focustree.focustree', 'Focus tree: ')}</label>
        <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
            <select id="focuses" class="select multiple-select" tabindex="0" role="combobox">
                ${focusTrees.map((focus, i) => `<option value="${i}">${focus.id}</option>`).join('')}
            </select>
        </div>`;

    const searchbox = `    
        <label for="searchbox" class="${styleTable.style('searchboxLabel', () => `margin-right:5px`)}">${localize('focustree.search', 'Search: ')}</label>
        <input
            class="${styleTable.style('searchbox', () => `margin-right:10px`)}"
            id="searchbox"
            type="text"
        />`;

    const customTitlebars = `
        <div class="${styleTable.style('customTitlebarsContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-custom-titlebars">${localize('TODO', 'Custom titlebars')}</label>
            <input
                id="show-custom-titlebars"
                type="checkbox"
            />
        </div>`;

    const focusOverlays = `
        <div class="${styleTable.style('focusOverlaysContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-focus-overlays">${localize('TODO', 'Focus overlays')}</label>
            <input
                id="show-focus-overlays"
                type="checkbox"
            />
        </div>`;

    const inlayWindowsToggle = `
        <div id="show-inlay-windows-container" class="${styleTable.style('inlayWindowsContainer', () => `margin-right:10px; display:flex; align-items:center;`)}">
            <label for="show-inlay-windows">${localize('TODO', 'Inlay windows')}</label>
            <input
                id="show-inlay-windows"
                type="checkbox"
            />
        </div>`;

    const inlayWindows = `
        <div id="inlay-window-container">
            <label for="inlay-windows" class="${styleTable.style('inlayWindowsLabel', () => `margin-right:5px`)}">${localize('TODO', 'Inlay window: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <select id="inlay-windows" class="select multiple-select" tabindex="0" role="combobox"></select>
            </div>
        </div>`;

    const allowbranch = `
        <div id="allowbranch-container">
            <label for="allowbranch" class="${styleTable.style('allowbranchLabel', () => `margin-right:5px`)}">${localize('focustree.allowbranch', 'Allow branch: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="allowbranch" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const conditions = `
        <div id="condition-container">
            <label for="conditions" class="${styleTable.style('conditionsLabel', () => `margin-right:5px`)}">${localize('TODO', 'Focus conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox" class="${styleTable.style('conditionsLabel', () => `max-width:400px`)}">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;

    const inlayConditions = `
        <div id="inlay-condition-container">
            <label for="inlay-conditions" class="${styleTable.style('inlayConditionsLabel', () => `margin-right:5px`)}">${localize('TODO', 'Inlay conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="inlay-conditions" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    
    const warningsButton = focusTrees.every(ft => ft.warnings.length === 0) ? '' : `
        <button id="show-warnings" title="${localize('focustree.warnings', 'Toggle warnings')}">
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
            ${useConditionInFocus ? conditions + inlayConditions : allowbranch}
            ${warningsButton}
        </div>
    </div>`;
}

function getInlayGfxStyleKey(gfxName: string, gfxFile: string | undefined) {
    return 'inlay-gfx-' + normalizeForStyle((gfxFile ?? 'missing') + '-' + gfxName);
}

async function prepareInlayGfxStyles(focusTrees: FocusTree[], styleTable: StyleTable): Promise<void> {
    const processed = new Set<string>();
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

                    const sprite = await getSpriteByGfxName(option.gfxName, option.gfxFile);
                    const frame = sprite?.frames[0];
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
}

async function renderInlayWindow(inlay: FocusTree["inlayWindows"][number], styleTable: StyleTable, gfxFiles: string[]): Promise<string> {
    if (!inlay.guiWindow) {
        return '';
    }

    const parentInfo: ParentInfo = {
        size: {
            width: 1920,
            height: 1080,
        },
        orientation: 'upper_left',
    };

    const content = await renderContainerWindow(
        {
            ...inlay.guiWindow,
            position: { x: toNumberLike(0), y: toNumberLike(0) },
        },
        parentInfo,
        {
            styleTable,
            enableNavigator: true,
            classNames: 'focus-inlay-window navigator',
            getSprite: (sprite) => getSpriteByGfxName(sprite, gfxFiles),
            onRenderChild: async (type, child, parent) => renderInlayOverrideChild(type, child, parent, inlay, styleTable, gfxFiles),
        }
    );

    return `<div class="${styleTable.style('focus-inlay-window-root', () => `
        position: absolute;
        left: ${inlay.position.x}px;
        top: ${inlay.position.y}px;
        z-index: 5;
    `)}" start="${inlay.token?.start}" end="${inlay.token?.end}" file="${inlay.file}">${content}</div>`;
}

async function renderInlayOverrideChild<T extends keyof RenderChildTypeMap>(
    type: T,
    child: RenderChildTypeMap[T],
    parentInfo: ParentInfo,
    inlay: FocusTree["inlayWindows"][number],
    styleTable: StyleTable,
    gfxFiles: string[],
): Promise<string | undefined> {
    if ((type !== 'icon' && type !== 'button') || !child.name) {
        return undefined;
    }

    const slot = inlay.scriptedImages.find(scriptedImage => scriptedImage.id === child.name);
    if (!slot) {
        return undefined;
    }

    const spriteOption = slot.gfxOptions.find(option => option.gfxFile) ?? slot.gfxOptions[0];
    if (!spriteOption) {
        return undefined;
    }

    const sprite = spriteOption.gfxFile ? await getSpriteByGfxName(spriteOption.gfxName, spriteOption.gfxFile) : await getSpriteByGfxName(spriteOption.gfxName, gfxFiles);
    if (!sprite) {
        return undefined;
    }

    const iconLikeChild = child as any as IconType & ButtonType;
    let [x, y] = calculateBBox(iconLikeChild, parentInfo);
    if (iconLikeChild.centerposition) {
        x -= sprite.width / 2;
        y -= sprite.height / 2;
    }

    const scale = iconLikeChild.scale ?? 1;
    const gfxClassPlaceholder = `{{inlay_slot_class:${slot.id}}}`;
    const spriteHtml = renderSprite({ x: 0, y: 0 }, sprite, sprite, 0, scale, {
        styleTable,
        classNames: gfxClassPlaceholder,
    });
    const textHtml = type === 'button' ? await renderInstantTextBox({
        ...iconLikeChild,
        position: { x: toNumberLike(0), y: toNumberLike(0) },
        bordersize: { x: toNumberLike(0), y: toNumberLike(0) },
        maxheight: toNumberLike(sprite.height * scale),
        maxwidth: toNumberLike(sprite.width * scale),
        font: iconLikeChild.buttonfont,
        text: iconLikeChild.buttontext ?? iconLikeChild.text,
        format: toStringAsSymbolIgnoreCase('center'),
        vertical_alignment: 'center',
        orientation: toStringAsSymbolIgnoreCase('upper_left')
    }, parentInfo, { styleTable }) : '';

    return `<div
        start="${child._token?.start}"
        end="${child._token?.end}"
        class="navigator ${styleTable.style('positionAbsolute', () => `position: absolute;`)} ${styleTable.oneTimeStyle('inlay-gui-slot', () => `
            left: ${x}px;
            top: ${y}px;
            width: ${sprite.width * scale}px;
            height: ${sprite.height * scale}px;
        `)}">
            ${spriteHtml}
            ${textHtml}
        </div>`;
}

async function renderFocus(
    focus: Focus,
    styleTable: StyleTable,
    gfxFiles: string[],
    file: string,
    titlebarStyles: Record<string, string>,
): Promise<string> {
    for (const focusIcon of focus.icon) {
        const iconName = focusIcon.icon;
        const iconObject = iconName ? await getFocusIcon(iconName, gfxFiles) : null;
        styleTable.style('focus-icon-' + normalizeForStyle(iconName ?? '-empty'), () => 
            `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width: 0}px;`
        );
    }
    
    styleTable.style('focus-icon-' + normalizeForStyle('-empty'), () => 'background: grey;');

    const titlebarObject = await getFocusTitlebarImage(focus.textIcon, titlebarStyles);
    const titlebarClass = styleTable.style('focus-titlebar-' + normalizeForStyle(focus.textIcon ?? '-empty'), () =>
        titlebarObject ? `
            background-image: url(${titlebarObject.uri});
            width: ${titlebarObject.width}px;
            height: ${titlebarObject.height}px;
            background-size: ${titlebarObject.width}px ${titlebarObject.height}px;
        ` : `
            display: none;
        `
    );
    const overlayObject = await getFocusOverlayImage(focus.overlay);
    const overlayClass = styleTable.style('focus-overlay-' + normalizeForStyle(focus.overlay ?? '-empty'), () =>
        overlayObject ? `
            background-image: url(${overlayObject.uri});
            width: ${overlayObject.width}px;
            height: ${overlayObject.height}px;
            background-size: ${overlayObject.width}px ${overlayObject.height}px;
            display: block;
        ` : `
            display: none;
        `
    );

    let textContent = focus.id;
    if (localisationIndex){
        let localizedText = await getLocalisedTextQuick(focus.id);
        if (localizedText === focus.id || !localizedText){
            if (focus.text){
                localizedText = await getLocalisedTextQuick(focus.text);
                if (localizedText !== focus.text && localizedText !== null){
                    textContent += `<br/>${localizedText}`;
                }
            }
        }else {
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
    start="${focus.token?.start}"
    end="${focus.token?.end}"
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
            <input id="checkbox-${normalizeForStyle(focus.id)}" type="checkbox"/>
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
}

export async function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined> {
    const sprite = await getSpriteByGfxName(name, gfxFiles);
    if (sprite !== undefined) {
        return sprite.image;
    }

    return await getImageByPath(defaultFocusIcon);
}
