import * as vscode from 'vscode';
import { getSpriteByGfxName, Image, getImageByPath } from '../../util/image/imagecache';
import { localize, i18nTableAsScript } from '../../util/i18n';
import { forceError, randomString } from '../../util/common';
import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { html, htmlEscape, previewedFileUriScript } from '../../util/html';
import { ContainerWindowType, GridBoxType } from '../../hoiformat/gui';
import { renderContainerWindow } from '../../util/hoi4gui/containerwindow';
import { MioFrame, MioLoader } from './loader';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { Mio, MioTrait, TraitEffect } from './schema';
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { localisationIndex } from "../../util/featureflags";

const defaultTraitIcon = 'gfx/interface/goals/goal_unknown.dds';
const traitEffectIconMap: Record<TraitEffect, string> = {
    equiment: 'GFX_design_team_icon',
    production: 'GFX_industrial_manufacturer_icon',
    organization: 'GFX_organization_modifier_icon',
};

export async function renderMioFile(loader: MioLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string> {
    try {
        const session = new LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from((session as any).loadedLoader).map<string>(v => (v as any).toString());
        debug('Loader session mio', loadedLoaders);

        const mios = loadResult.result.mios;

        if (mios.length === 0) {
            const baseContent = localize('miopreview.nomio', 'No military industrial organization defined.');
            return html(webview, baseContent, [ previewedFileUriScript(uri) ], []);
        }

        mios.sort((a, b) => a.id.localeCompare(b.id));

        const styleTable = new StyleTable();
        const jsCodes: string[] = [];
        const styleNonce = randomString(32);
        const baseContent = await renderMios(mios, styleTable, loadResult.result.gfxFiles, jsCodes, styleNonce, loader.file, loadResult.result.frame);
        jsCodes.push(i18nTableAsScript());

        return html(
            webview,
            baseContent,
            [
                previewedFileUriScript(uri),
                ...jsCodes.map(c => ({ content: c })),
                'common.js',
                'miopreview.js',
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
        return html(webview, baseContent, [ previewedFileUriScript(uri) ], []);
    }
}

const leftPadding = 50;
const topPadding = 50;
const xGridSize = 87;
const yGridSize = 117;

async function renderMios(mios: Mio[], styleTable: StyleTable, gfxFiles: string[], jsCodes: string[], styleNonce: string, file: string, frame: MioFrame | undefined): Promise<string> {

    const gridBox: HOIPartial<GridBoxType> = {
        position: { x: toNumberLike(leftPadding), y: toNumberLike(topPadding) },
        format: toStringAsSymbolIgnoreCase('up'),
        size: { width: toNumberLike(xGridSize), height: undefined },
        slotsize: { width: toNumberLike(xGridSize), height: toNumberLike(yGridSize) },
    } as HOIPartial<GridBoxType>;

    const renderedTrait: Record<string, Record<string, string>> = {};
    for (const mio of mios) {
        const renderedTraitForMio: Record<string, string> = {};
        renderedTrait[mio.id] = renderedTraitForMio;
        await Promise.all(Object.values(mio.traits).map(async (trait) =>
            renderedTraitForMio[trait.id] = (await renderTrait(trait, styleTable, gfxFiles, file)).replace(/\s\s+/g, ' ')));
    }

    const renderedHeaders: Record<string, string> = {};
    for (const mio of mios) {
        renderedHeaders[mio.id] = renderTreeHeaders(mio, styleTable).replace(/\s\s+/g, ' ');
    }

    jsCodes.push('window.mios = ' + JSON.stringify(mios));
    jsCodes.push('window.renderedTrait = ' + JSON.stringify(renderedTrait));
    jsCodes.push('window.renderedHeaders = ' + JSON.stringify(renderedHeaders));
    jsCodes.push('window.gridBox = ' + JSON.stringify(gridBox));
    jsCodes.push('window.styleNonce = ' + JSON.stringify(styleNonce));
    jsCodes.push('window.xGridSize = ' + xGridSize);

    const frameHtml = frame ? await renderFrame(frame, gfxFiles, styleTable) : '';
    jsCodes.push('window.mioFrameAvailable = ' + JSON.stringify(!!frame));

    return (
        `<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` +
        `<div id="miopreviewcontent" class="${styleTable.oneTimeStyle('miopreviewcontent', () => `top:40px;left:-20px;position:relative`)}">
            <div id="miopreviewplaceholder"></div>
        </div>` +
        frameHtml +
        await renderToolBar(mios, styleTable)
    );
}

// Names of the dynamic panels inside industrial_organisation_detail_window that the game fills at
// runtime. We render our own trait tree in their place, so we skip them when drawing the chrome.
const detailTreeWindowName = 'tree_scrollbar_window';
const detailHistoryWindowName = 'history_window';

async function renderFrame(frame: MioFrame, gfxFiles: string[], styleTable: StyleTable): Promise<string> {
    // --- Trait tree panel (industrial_organisation_tree_window). Holds the scrollable trait grid. ---
    const treeWindow = frame.window;
    const treeWidth = treeWindow.size?.width?._value ?? 945;
    const treeHeight = treeWindow.size?.height?._value ?? 665;

    const scrollbar = frame.scrollbarWindow;
    const scrollX = scrollbar?.position?.x?._value ?? 45;
    const scrollY = scrollbar?.position?.y?._value ?? 25;
    const scrollW = scrollbar?.size?.width?._value ?? 905;
    const scrollH = scrollbar?.size?.height?._value ?? 640;
    const marginTop = scrollbar?.margin?.top?._value ?? 0;
    const marginLeft = scrollbar?.margin?.left?._value ?? 0;
    const marginBottom = scrollbar?.margin?.bottom?._value ?? 20;
    const marginRight = scrollbar?.margin?.right?._value ?? 20;
    const innerW = scrollW - marginLeft - marginRight;
    const innerH = scrollH - marginTop - marginBottom;

    const bgSpriteName = treeWindow.background?.spritetype ?? 'GFX_MIO_details_background';
    const bgSprite = await getSpriteByGfxName(bgSpriteName, gfxFiles);
    const bgImage = bgSprite ? bgSprite.image : undefined;

    const treePanel = (left: number, top: number) => `
        <div id="mio-frame-treewindow" class="${styleTable.oneTimeStyle('mio-frame-treewindow', () => `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            width: ${treeWidth}px;
            height: ${treeHeight}px;
            ${bgImage ? `background-image: url(${bgImage.uri});` : 'background: #1a1a1a;'}
            background-size: ${treeWidth}px ${treeHeight}px;
            background-repeat: no-repeat;
            box-sizing: border-box;
        `)}">
            <div id="mio-frame-scrollbar" class="${styleTable.oneTimeStyle('mio-frame-scrollbar', () => `
                position: absolute;
                left: ${scrollX}px;
                top: ${scrollY}px;
                width: ${scrollW}px;
                height: ${scrollH}px;
                overflow: auto;
                box-sizing: border-box;
                padding: ${marginTop}px ${marginRight}px ${marginBottom}px ${marginLeft}px;
            `)}">
                <div id="mio-frame-slot" class="${styleTable.oneTimeStyle('mio-frame-slot', () => `
                    position: relative;
                    width: ${innerW}px;
                    min-height: ${innerH}px;
                `)}"></div>
            </div>
        </div>`;

    const detail = frame.detailWindow;

    // Fallback: detail window missing from the gui — render just the tree panel (previous behavior).
    if (!detail) {
        return `<div id="mio-frame" class="${styleTable.oneTimeStyle('mio-frame', () => `
            display: none;
            position: absolute;
            top: 60px;
            left: 20px;
            width: ${treeWidth}px;
            height: ${treeHeight}px;
            box-sizing: border-box;
        `)}">
            ${treePanel(0, 0)}
        </div>`;
    }

    // --- Full in-game detail window: left info column (org icon/size/points, aggregated bonuses,
    // policies), title and the traits/history tabs. We draw it as chrome and overlay the trait tree. ---
    const detailW = detail.size?.width?._value ?? 1280;
    const detailH = detail.size?.height?._value ?? 720;
    const treeAreaX = frame.treeScrollbarWindow?.position?.x?._value ?? 320;
    const treeAreaY = frame.treeScrollbarWindow?.position?.y?._value ?? 50;

    const chrome = await renderContainerWindow(
        {
            ...detail,
            orientation: toStringAsSymbolIgnoreCase('upper_left'),
            origo: toStringAsSymbolIgnoreCase('upper_left'),
        } as HOIPartial<ContainerWindowType>,
        { size: { width: detailW, height: detailH }, orientation: 'upper_left' },
        {
            getSprite: (sprite: string) => getSpriteByGfxName(sprite, gfxFiles),
            styleTable,
            ignorePosition: true,
            onRenderChild: async (type, child) => {
                if (type === 'containerwindow' && (child.name === detailTreeWindowName || child.name === detailHistoryWindowName)) {
                    return '';
                }
                return undefined;
            },
        },
    );

    return `<div id="mio-frame" class="${styleTable.oneTimeStyle('mio-frame', () => `
        display: none;
        position: absolute;
        top: 60px;
        left: 20px;
        width: ${detailW}px;
        height: ${detailH}px;
        box-sizing: border-box;
    `)}">
        ${chrome}
        ${treePanel(treeAreaX, treeAreaY)}
    </div>`;
}

async function renderToolBar(mios: Mio[], styleTable: StyleTable): Promise<string> {
    const mioSelect = mios.length <= 1 ? '' : `
        <label for="mios" class="${styleTable.style('miosLabel', () => `margin-right:5px`)}">${localize('miopreview.mio', 'Military Industrial Organization: ')}</label>
        <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
            <select id="mios" class="select multiple-select" tabindex="0" role="combobox">
                ${mios.map((mio, i) => {
                    const localizedText = localisationIndex ? `(${mio.id}) ${getLocalisedTextQuick(mio.id)}` : mio.id;
                    return `<option value="${i}">${localizedText}</option>`;
                }).join('')}
            </select>
        </div>`;

    const conditions = `
        <div id="condition-container">
            <label for="conditions" class="${styleTable.style('conditionsLabel', () => `margin-right:5px`)}">${localize('miopreview.conditions', 'Conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox" class="${styleTable.style('conditionsLabel', () => `max-width:400px`)}">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    
    const toggles = `
        <label for="show-included-traits" class="${styleTable.style('toggleLabel', () => `margin-right:5px`)}">${localize('miopreview.showInheritedTraits', 'Show inherited traits')}</label>
        <input type="checkbox" id="show-included-traits" class="${styleTable.style('marginRight30', () => `margin-right:30px`)}">
        <label for="show-frame" class="${styleTable.style('toggleLabel', () => `margin-right:5px`)}">${localize('miopreview.showFrame', 'Show ingame ui')}</label>
        <input type="checkbox" id="show-frame" class="${styleTable.style('marginRight10', () => `margin-right:10px`)}">`;

    return `<div class="toolbar-outer ${styleTable.style('toolbar-height', () => `box-sizing: border-box; height: 40px;`)}">
        <div class="toolbar">
            ${mioSelect}
            ${conditions}
            ${toggles}
        </div>
    </div>`;
}

// Column headers declared by `tree_header_text` blocks. Each sits above the trait grid at its
// column x. The header text is localised here (server side); the raw key is the fallback. The
// containing layer is positioned client side so it lines up with the dynamically-computed grid
// origin, so each header only carries its column offset (left = x * xGridSize).
function renderTreeHeaders(mio: Mio, styleTable: StyleTable): string {
    return mio.textHeaders.map(header => {
        const text = getLocalisedTextQuick(header.text) ?? header.text;
        return `<div class="
            ${styleTable.style('mio-tree-header', () => `
                position: absolute;
                top: 0;
                width: ${xGridSize}px;
                text-align: center;
                font-size: 11px;
                line-height: 1.1;
                opacity: 0.7;
                white-space: nowrap;
                pointer-events: none;
            `)}
            ${styleTable.oneTimeStyle('mio-tree-header-pos', () => `left: ${header.x * xGridSize}px;`)}
        ">${htmlEscape(text)}</div>`;
    }).join('');
}

async function renderTrait(trait: MioTrait, styleTable: StyleTable, gfxFiles: string[], file: string): Promise<string> {
    const traitIcon = trait.icon;
    if (traitIcon) {
        const iconObject = traitIcon ? await getTraitIcon(traitIcon, gfxFiles) : null;
        styleTable.style('trait-icon-' + normalizeForStyle(traitIcon ?? '-empty'), () => 
            `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width: 0}px;`
        );
    }
    
    styleTable.style('trait-icon-' + normalizeForStyle('-empty'), () => 'background: grey;');
    styleTable.raw(`.${styleTable.name('trait-common')}:hover .${styleTable.name('trait-span')}`, `display:inline-block;`);
    styleTable.raw(`.${styleTable.name('trait-common')}:hover .${styleTable.name('trait-span-display')}`, `margin-top: -12px;`);

    const traitBg = await getSpriteByGfxName(trait.specialTraitBackground ? 'GFX_country_spefific_org_trait_button' : 'GFX_industrial_org_trait_button', gfxFiles);

    return `<div
    class="
        ${styleTable.style(trait.specialTraitBackground ? 'trait-bg-special' : 'trait-bg-normal',
            () => traitBg ? `background-image: url(${(traitBg.frames[2] ?? traitBg.image).uri});` : '')}
        ${styleTable.style('trait-background', () => `
            background-position-x: center;
            background-position-y: center;
            background-repeat: no-repeat;
            width: 100%;
            height: 100%;
            text-align: center;
            cursor: pointer;
        `)}"
    >
        <div
        class="
            navigator
            ${styleTable.name('trait-icon-' + normalizeForStyle(traitIcon ?? '-empty'))}
            ${styleTable.style('trait-common', () => `
                background-position-x: center;
                background-position-y: calc(50% - 8px);
                background-repeat: no-repeat;
                width: 100%;
                height: 100%;
                text-align: center;
                cursor: pointer;
            `)}
        "
        start="${trait.token?.start}"
        end="${trait.token?.end}"
        ${file === trait.file ? '' : `file="${trait.file}"`}
        title="${trait.id}${localisationIndex ? `\n${getLocalisedTextQuick(trait.name)}` : ''}\n({{position}})">
            <div class="
                ${styleTable.style('effect-host', () => `
                    text-align: center;
                    position: absolute;
                    width: 100%;
                    top: 73px;
                `)}
            ">
                ${(await Promise.all(trait.effects.map(async (effect) => `
                <span class="
                    ${await styleTable.style('effect-icon-' + effect, async () => {
                        const icon = await getTraitIcon(traitEffectIconMap[effect], gfxFiles);
                        return icon ? `background-image: url(${icon.uri}); width: ${icon.width}px; height: ${icon.height}px;` : '';
                    })}
                    ${styleTable.style('effect-icon', () => `
                        display: inline-block;
                    `)}
                ">
                &nbsp;
                </span>
                `))).join('')}
            </div>
            <span
            class="${styleTable.style('trait-span', () => `
                margin: 10px -400px;
                margin-top: 95px;
                text-align: center;
                display: none;
                position: relative;
                z-index: 5;
            `)}">
            ${trait.id}
            </span>
            <br/>
            <span
            class="${styleTable.style('trait-span-display', () => `
                margin: 10px -400px;
                margin-top: 84px;
                text-align: center;
                display: inline-block;
                position: relative;
                z-index: 5;
            `)}">
            ${localisationIndex ? `${getLocalisedTextQuick(trait.name)}` : ''}
            </span>
        </div>
    </div>`;
}

export async function getTraitIcon(name: string, gfxFiles: string[]): Promise<Image | undefined> {
    const sprite = await getSpriteByGfxName(name, gfxFiles);
    if (sprite !== undefined) {
        return sprite.image;
    }

    return await getImageByPath(defaultTraitIcon);
}
