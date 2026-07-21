import * as vscode from 'vscode';
import { getSpriteByGfxName, Image, getImageByPath } from '../../util/image/imagecache';
import { localize, i18nTableAsScript } from '../../util/i18n';
import { forceError, randomString } from '../../util/common';
import { HOIPartial, toNumberLike, toStringAsSymbolIgnoreCase } from '../../hoiformat/schema';
import { html, htmlEscape, previewedFileUriScript } from '../../util/html';
import { GridBoxType } from '../../hoiformat/gui';
import { MioLoader } from './loader';
import { LoaderSession } from '../../util/loader/loader';
import { debug } from '../../util/debug';
import { StyleTable, normalizeForStyle } from '../../util/styletable';
import { Mio, MioTrait, TraitEffect } from './schema';
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { localisationIndex } from "../../util/featureflags";
import { LoaderRender } from '../loaderpreview';

const defaultTraitIcon = 'gfx/interface/goals/goal_unknown.dds';
const traitEffectIconMap: Record<TraitEffect, string> = {
    equiment: 'GFX_design_team_icon',
    production: 'GFX_industrial_manufacturer_icon',
    organization: 'GFX_organization_modifier_icon',
};

export async function renderMioFile(loader: MioLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<LoaderRender> {
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
        const { baseContent, data } = await renderMios(mios, styleTable, loadResult.result.gfxFiles, jsCodes, styleNonce, loader.file);
        jsCodes.push(i18nTableAsScript());

        const fullHtml = html(
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
                // Addressable id so an in-place updateBody can refresh the trait-icon CSS (this is the
                // server StyleTable the rendered trait HTML references) without a full webview reload.
                { content: styleTable.toRawCss(), id: 'mio-server-styles' },
                { nonce: styleNonce },
            ],
        );

        // Parts for the in-place update. styleNonce is deliberately not resent: it stays the original
        // so the CSP-authorized <style> the webview's buildContent re-injects keeps validating. The
        // webview refreshes these globals + the trait-icon <style>, then re-runs buildContent to
        // redraw the tree and the tree_header_text layer, preserving scroll and client state.
        return { html: fullHtml, update: { styleCss: styleTable.toRawCss(), data } };

    } catch (e) {
        const baseContent = `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
        return html(webview, baseContent, [ previewedFileUriScript(uri) ], []);
    }
}

const leftPadding = 50;
const topPadding = 50;
const xGridSize = 87;
const yGridSize = 117;

async function renderMios(mios: Mio[], styleTable: StyleTable, gfxFiles: string[], jsCodes: string[], styleNonce: string, file: string): Promise<{ baseContent: string; data: Record<string, unknown> }> {

    const gridBox: HOIPartial<GridBoxType> = {
        position: { x: toNumberLike(leftPadding), y: toNumberLike(topPadding) },
        format: toStringAsSymbolIgnoreCase('up'),
        size: { width: toNumberLike(xGridSize), height: undefined },
        slotsize: { width: toNumberLike(xGridSize), height: toNumberLike(yGridSize) },
    } as HOIPartial<GridBoxType>;

    // The mio dropdown <option> list. Built once and shared between the initial toolbar render and
    // the update payload, so an in-place update refreshes the (localised) labels and add/remove of
    // organizations without a full reload. The labels use server-only localisation, so the webview
    // can't rebuild them from `mios` alone — it swaps this html into the stable <select>.
    const mioOptionsHtml = renderMioOptions(mios);

    const baseContent = (
        `<div id="dragger" class="${styleTable.style('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` +
        `<div id="miopreviewcontent" class="${styleTable.style('miopreviewcontent', () => `top:40px;left:-20px;position:relative`)}">
            <div id="miopreviewplaceholder"></div>
        </div>` +
        await renderToolBar(mios, styleTable, mioOptionsHtml)
    );

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

    return {
        baseContent,
        // The globals the webview's buildContent re-renders from. gridBox/xGridSize are constants,
        // but resending them keeps the update self-contained (they don't destabilize the change hash
        // since they never vary).
        // mioOptionsHtml lets the webview refresh the dropdown while keeping the element + listener.
        data: { mios, renderedTrait, renderedHeaders, gridBox, xGridSize, mioOptionsHtml },
    };
}

function renderMioOptions(mios: Mio[]): string {
    return mios.map((mio, i) => {
        const localizedText = localisationIndex ? `(${mio.id}) ${getLocalisedTextQuick(mio.id)}` : mio.id;
        return `<option value="${i}">${htmlEscape(localizedText)}</option>`;
    }).join('');
}

async function renderToolBar(mios: Mio[], styleTable: StyleTable, mioOptionsHtml: string): Promise<string> {
    // Always render the dropdown (wrapped like #condition-container so it stays one toolbar flex
    // item) so an in-place update can refresh its options and its change listener never re-binds.
    // Hidden for the single-org case; the webview toggles this via #mio-select-container.
    const mioSelect = `
        <div id="mio-select-container" class="${mios.length <= 1 ? styleTable.style('mio-select-hidden', () => `display:none`) : ''}">
            <label for="mios" class="${styleTable.style('miosLabel', () => `margin-right:5px`)}">${localize('miopreview.mio', 'Military Industrial Organization: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <select id="mios" class="select multiple-select" tabindex="0" role="combobox">
                    ${mioOptionsHtml}
                </select>
            </div>
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
        <label for="show-grid" class="${styleTable.style('toggleLabel', () => `margin-right:5px`)}">${localize('miopreview.showGrid', 'Show grid')}</label>
        <input type="checkbox" id="show-grid" class="${styleTable.style('marginRight10', () => `margin-right:10px`)}">`;

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
