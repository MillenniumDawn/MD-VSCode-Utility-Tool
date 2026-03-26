"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGfxFile = void 0;
const tslib_1 = require("tslib");
const hoiparser_1 = require("../../hoiformat/hoiparser");
const spritetype_1 = require("../../hoiformat/spritetype");
const imagecache_1 = require("../../util/image/imagecache");
const i18n_1 = require("../../util/i18n");
const html_1 = require("../../util/html");
const styletable_1 = require("../../util/styletable");
const common_1 = require("../../util/common");
function renderGfxFile(fileContent, uri, webview) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
        try {
            const spriteTypes = (0, spritetype_1.getSpriteTypes)((0, hoiparser_1.parseHoi4File)(fileContent, (0, i18n_1.localize)('infile', 'In file {0}:\n', uri.toString())));
            const styleTable = new styletable_1.StyleTable();
            const baseContent = yield renderSpriteTypes(spriteTypes, styleTable);
            return (0, html_1.html)(webview, baseContent, [
                setPreviewFileUriScript,
                'common.js',
                'gfx.js',
            ], [
                'common.css',
                styleTable,
            ]);
        }
        catch (e) {
            const baseContent = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
    });
}
exports.renderGfxFile = renderGfxFile;
function renderSpriteTypes(spriteTypes, styleTable) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const imageList = (yield Promise.all(spriteTypes.map(st => renderSpriteType(st, styleTable)))).join('');
        const filter = `<div
    class="${styleTable.style('filterBar', () => `
        position: fixed;
        padding-top: 10px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
    `)}">
        <label for="filter" class="${styleTable.style('filterLabel', () => `margin-right:5px`)}">${(0, i18n_1.localize)('gfx.filter', 'Filter: ')}</label>
        <input
            id="filter"
            type="text"
        />
    </div>`;
        return `${filter}
    <div class="${styleTable.style('imageList', () => `margin-top: 40px`)}">
        ${imageList}
    </div>`;
    });
}
function renderSpriteType(spriteType, styleTable) {
    var _a, _b;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const image = yield (0, imagecache_1.getImageByPath)(spriteType.texturefile);
        return `<div
        id="${spriteType.name}"
        class="
            spriteTypePreview
            navigator
            ${styleTable.style('spriteTypePreview', () => `
                display: inline-block;
                text-align: center;
                margin: 10px;
                cursor: pointer;
            `)}
        "
        start="${(_a = spriteType.token) === null || _a === void 0 ? void 0 : _a.start}"
        end="${(_b = spriteType.token) === null || _b === void 0 ? void 0 : _b.end}"
        title="${spriteType.name}${image ? ` (${image.width / spriteType.noofframes}x${image.height}x${spriteType.noofframes})` : ''}\n${image ? image.path : (0, i18n_1.localize)('gfx.imagenotfound', 'Image not found')}">
        ${image ? `<img src="${image.uri}" />` :
            `<div 
            class="${styleTable.style('missingImageOuter', () => `
                height: 100px;
                width: 100px;
                background: grey;
                margin: auto;
                display: table;
            `)}">
                <div class="${styleTable.style('missingImageInner', () => `display:table-cell;vertical-align:middle;color:black;`)}">
                    MISSING
                </div>
            </div>`}
        <p class="
            ${styleTable.style('imageName-common', () => `
                min-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0
            `)}
            ${styleTable.oneTimeStyle('imageName', () => `
                max-width: ${Math.max((image === null || image === void 0 ? void 0 : image.width) || 100, 120)}px;
            `)}
        ">
            ${(0, html_1.htmlEscape)(spriteType.name)}
        </p>
    </div>`;
    });
}
//# sourceMappingURL=contentbuilder.js.map