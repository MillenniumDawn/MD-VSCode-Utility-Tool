"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMioFile = renderMioFile;
exports.getTraitIcon = getTraitIcon;
const imagecache_1 = require("../../util/image/imagecache");
const i18n_1 = require("../../util/i18n");
const common_1 = require("../../util/common");
const schema_1 = require("../../hoiformat/schema");
const html_1 = require("../../util/html");
const loader_1 = require("../../util/loader/loader");
const debug_1 = require("../../util/debug");
const styletable_1 = require("../../util/styletable");
const localisationIndex_1 = require("../../util/localisationIndex");
const featureflags_1 = require("../../util/featureflags");
const defaultTraitIcon = 'gfx/interface/goals/goal_unknown.dds';
const traitEffectIconMap = {
    equiment: 'GFX_design_team_icon',
    production: 'GFX_industrial_manufacturer_icon',
    organization: 'GFX_organization_modifier_icon',
};
async function renderMioFile(loader, uri, webview) {
    const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
    try {
        const session = new loader_1.LoaderSession(false);
        const loadResult = await loader.load(session);
        const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
        (0, debug_1.debug)('Loader session mio', loadedLoaders);
        const mios = loadResult.result.mios;
        if (mios.length === 0) {
            const baseContent = (0, i18n_1.localize)('miopreview.nomio', 'No military industrial organization defined.');
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
        mios.sort((a, b) => a.id.localeCompare(b.id));
        const styleTable = new styletable_1.StyleTable();
        const jsCodes = [];
        const styleNonce = (0, common_1.randomString)(32);
        const baseContent = await renderMios(mios, styleTable, loadResult.result.gfxFiles, jsCodes, styleNonce, loader.file, loadResult.result.frame);
        jsCodes.push((0, i18n_1.i18nTableAsScript)());
        return (0, html_1.html)(webview, baseContent, [
            setPreviewFileUriScript,
            ...jsCodes.map(c => ({ content: c })),
            'common.js',
            'miopreview.js',
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
}
const leftPadding = 50;
const topPadding = 50;
const xGridSize = 87;
const yGridSize = 117;
async function renderMios(mios, styleTable, gfxFiles, jsCodes, styleNonce, file, frame) {
    const gridBox = {
        position: { x: (0, schema_1.toNumberLike)(leftPadding), y: (0, schema_1.toNumberLike)(topPadding) },
        format: (0, schema_1.toStringAsSymbolIgnoreCase)('up'),
        size: { width: (0, schema_1.toNumberLike)(xGridSize), height: undefined },
        slotsize: { width: (0, schema_1.toNumberLike)(xGridSize), height: (0, schema_1.toNumberLike)(yGridSize) },
    };
    const renderedTrait = {};
    for (const mio of mios) {
        const renderedTraitForMio = {};
        renderedTrait[mio.id] = renderedTraitForMio;
        await Promise.all(Object.values(mio.traits).map(async (trait) => renderedTraitForMio[trait.id] = (await renderTrait(trait, styleTable, gfxFiles, file)).replace(/\s\s+/g, ' ')));
    }
    const mioHeaderTexts = {};
    for (const mio of mios) {
        mioHeaderTexts[mio.id] = await Promise.all(mio.headerTexts.map(async (h) => ({
            text: h.text,
            resolved: (featureflags_1.localisationIndex ? await (0, localisationIndex_1.getLocalisedTextQuick)(h.text) : undefined) ?? h.text,
            x: h.x,
        })));
    }
    const treeHeaderInfo = {
        x: frame?.treeHeaderWindow?.position?.x?._value ?? 0,
        y: frame?.treeHeaderWindow?.position?.y?._value ?? 11,
        w: frame?.treeHeaderWindow?.size?.width?._value ?? 945,
        h: frame?.treeHeaderWindow?.size?.height?._value ?? 24,
        flavorX: frame?.flavorTextWindow?.position?.x?._value ?? 0,
        flavorY: frame?.flavorTextWindow?.position?.y?._value ?? 0,
    };
    jsCodes.push('window.mios = ' + JSON.stringify(mios));
    jsCodes.push('window.renderedTrait = ' + JSON.stringify(renderedTrait));
    jsCodes.push('window.mioHeaderTexts = ' + JSON.stringify(mioHeaderTexts));
    jsCodes.push('window.mioTreeHeader = ' + JSON.stringify(treeHeaderInfo));
    jsCodes.push('window.gridBox = ' + JSON.stringify(gridBox));
    jsCodes.push('window.styleNonce = ' + JSON.stringify(styleNonce));
    jsCodes.push('window.xGridSize = ' + xGridSize);
    const frameHtml = frame ? await renderFrame(frame, gfxFiles, styleTable, treeHeaderInfo) : '';
    jsCodes.push('window.mioFrameAvailable = ' + JSON.stringify(!!frame));
    return (`<div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
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
        await renderToolBar(mios, styleTable));
}
async function renderFrame(frame, gfxFiles, styleTable, treeHeaderInfo) {
    const width = frame.window.size?.width?._value ?? 945;
    const height = frame.window.size?.height?._value ?? 665;
    const scrollbar = frame.scrollbarWindow;
    const scrollX = scrollbar?.position?.x?._value ?? 45;
    const scrollY = scrollbar?.position?.y?._value ?? 25;
    const scrollW = scrollbar?.size?.width?._value ?? 905;
    const scrollH = scrollbar?.size?.height?._value ?? 640;
    const marginTop = scrollbar?.margin?.top?._value ?? 0;
    const marginLeft = scrollbar?.margin?.left?._value ?? 0;
    const marginBottom = scrollbar?.margin?.bottom?._value ?? 20;
    const marginRight = scrollbar?.margin?.right?._value ?? 20;
    const bgSpriteName = frame.window.background?.spritetype ?? 'GFX_MIO_details_background';
    const bgSprite = await (0, imagecache_1.getSpriteByGfxName)(bgSpriteName, gfxFiles);
    const bgImage = bgSprite ? bgSprite.image : undefined;
    const innerW = scrollW - marginLeft - marginRight;
    const innerH = scrollH - marginTop - marginBottom;
    return `<div id="mio-frame" class="${styleTable.oneTimeStyle('mio-frame', () => `
        display: none;
        position: absolute;
        top: 60px;
        left: 20px;
        width: ${width}px;
        height: ${height}px;
        ${bgImage ? `background-image: url(${bgImage.uri});` : 'background: #1a1a1a;'}
        background-size: ${width}px ${height}px;
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
        <div id="mio-frame-tree-header" class="${styleTable.oneTimeStyle('mio-frame-tree-header', () => `
            position: absolute;
            left: ${treeHeaderInfo.x}px;
            top: ${treeHeaderInfo.y}px;
            width: ${treeHeaderInfo.w}px;
            height: ${treeHeaderInfo.h}px;
            pointer-events: none;
        `)}"></div>
    </div>`;
}
async function renderToolBar(mios, styleTable) {
    const mioSelect = mios.length <= 1 ? '' : `
        <label for="mios" class="${styleTable.style('miosLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('miopreview.mio', 'Military Industrial Organization: ')}</label>
        <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
            <select id="mios" class="select multiple-select" tabindex="0" role="combobox">
                ${await Promise.all(mios.map(async (mio, i) => {
        const localizedText = featureflags_1.localisationIndex ? `(${mio.id}) ${await (0, localisationIndex_1.getLocalisedTextQuick)(mio.id)}` : mio.id;
        return `<option value="${i}">${localizedText}</option>`;
    })).then(options => options.join(''))}
            </select>
        </div>`;
    const conditions = `
        <div id="condition-container">
            <label for="conditions" class="${styleTable.style('conditionsLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('miopreview.conditions', 'Conditions: ')}</label>
            <div class="select-container ${styleTable.style('marginRight10', () => `margin-right:10px`)}">
                <div id="conditions" class="select multiple-select" tabindex="0" role="combobox" class="${styleTable.style('conditionsLabel', () => `max-width:400px`)}">
                    <span class="value"></span>
                </div>
            </div>
        </div>`;
    const toggles = `
        <label for="show-included-traits" class="${styleTable.style('toggleLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('miopreview.showInheritedTraits', 'Show inherited traits')}</label>
        <input type="checkbox" id="show-included-traits" class="${styleTable.style('marginRight30', () => `margin-right:30px`)}">
        <label for="show-frame" class="${styleTable.style('toggleLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('miopreview.showFrame', 'Show ingame ui')}</label>
        <input type="checkbox" id="show-frame" class="${styleTable.style('marginRight10', () => `margin-right:10px`)}">`;
    return `<div class="toolbar-outer ${styleTable.style('toolbar-height', () => `box-sizing: border-box; height: 40px;`)}">
        <div class="toolbar">
            ${mioSelect}
            ${conditions}
            ${toggles}
        </div>
    </div>`;
}
async function renderTrait(trait, styleTable, gfxFiles, file) {
    const traitIcon = trait.icon;
    if (traitIcon) {
        const iconObject = traitIcon ? await getTraitIcon(traitIcon, gfxFiles) : null;
        styleTable.style('trait-icon-' + (0, styletable_1.normalizeForStyle)(traitIcon ?? '-empty'), () => `${iconObject ? `background-image: url(${iconObject.uri});` : 'background: grey;'}
            background-size: ${iconObject ? iconObject.width : 0}px;`);
    }
    styleTable.style('trait-icon-' + (0, styletable_1.normalizeForStyle)('-empty'), () => 'background: grey;');
    styleTable.raw(`.${styleTable.name('trait-common')}:hover .${styleTable.name('trait-span')}`, `display:inline-block;`);
    styleTable.raw(`.${styleTable.name('trait-common')}:hover .${styleTable.name('trait-span-display')}`, `margin-top: -12px;`);
    const traitBg = await (0, imagecache_1.getSpriteByGfxName)(trait.specialTraitBackground ? 'GFX_country_spefific_org_trait_button' : 'GFX_industrial_org_trait_button', gfxFiles);
    return `<div
    class="
        ${styleTable.style(trait.specialTraitBackground ? 'trait-bg-special' : 'trait-bg-normal', () => traitBg ? `background-image: url(${(traitBg.frames[2] ?? traitBg.image).uri});` : '')}
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
            ${styleTable.name('trait-icon-' + (0, styletable_1.normalizeForStyle)(traitIcon ?? '-empty'))}
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
        title="${trait.id}${featureflags_1.localisationIndex ? `\n${await (0, localisationIndex_1.getLocalisedTextQuick)(trait.name)}` : ''}\n({{position}})">
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
            ${featureflags_1.localisationIndex ? `${await (0, localisationIndex_1.getLocalisedTextQuick)(trait.name)}` : ''}
            </span>
        </div>
    </div>`;
}
async function getTraitIcon(name, gfxFiles) {
    const sprite = await (0, imagecache_1.getSpriteByGfxName)(name, gfxFiles);
    if (sprite !== undefined) {
        return sprite.image;
    }
    return await (0, imagecache_1.getImageByPath)(defaultTraitIcon);
}
//# sourceMappingURL=contentbuilder.js.map