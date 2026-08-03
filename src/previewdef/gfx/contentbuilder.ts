import * as vscode from "vscode";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { getSpriteTypes, SpriteType } from "../../hoiformat/spritetype";
import { getImageByPath } from "../../util/image/imagecache";
import { localize } from "../../util/i18n";
import { html, htmlEscape, previewedFileUriScript } from "../../util/html";
import { StyleTable } from "../../util/styletable";
import { forceError } from "../../util/common";
import { LoaderRenderResult } from "../updateablepreview";

// Renders the .gfx preview as a full html doc plus an in-place update payload. The update carries the
// sprite list markup (contentHtml) and the accumulated CSS (styleCss); the webview swaps only the
// image-list innerHTML on edit, so the filter bar, scroll and the filter input's listeners survive.
// A parse/render error returns a plain-string html with no update, which flips the loaded page to
// not-update-capable so the next valid render does a full reload.
export async function renderGfxFile(
	fileContent: string,
	uri: vscode.Uri,
	webview: vscode.Webview,
): Promise<LoaderRenderResult> {
	try {
		const spriteTypes = getSpriteTypes(
			parseHoi4File(
				fileContent,
				localize("infile", "In file {0}:\n", uri.toString()),
			),
		);
		const styleTable = new StyleTable();
		const imageList = await renderSpriteTypes(spriteTypes, styleTable);
		const baseContent =
			renderFilterBar(styleTable) + renderImageList(imageList, styleTable);
		return {
			html: html(
				webview,
				baseContent,
				[previewedFileUriScript(uri), "common.js", "gfx.js"],
				[
					"common.css",
					{ id: "gfx-server-styles", content: styleTable.toRawCss() },
				],
			),
			update: {
				styleCss: styleTable.toRawCss(),
				data: { contentHtml: imageList },
			},
		};
	} catch (e) {
		const baseContent = `${localize("error", "Error")}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
		return {
			html: html(webview, baseContent, [previewedFileUriScript(uri)], []),
		};
	}
}

function renderFilterBar(styleTable: StyleTable): string {
	return `<div
    class="${styleTable.style(
			"filterBar",
			() => `
        position: fixed;
        padding-top: 10px;
        padding-left: 20px;
        width: 100%;
        height: 30px;
        top: 0;
        left: 0;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
    `,
		)}">
        <label for="filter" class="${styleTable.style("filterLabel", () => `margin-right:5px`)}">${localize("gfx.filter", "Filter: ")}</label>
        <input
            id="filter"
            type="text"
        />
    </div>`;
}

function renderImageList(imageList: string, styleTable: StyleTable): string {
	return `<div
        id="gfx-image-list"
        class="${styleTable.style("imageList", () => `margin-top: 40px`)}">
        ${imageList}
    </div>`;
}

async function renderSpriteTypes(
	spriteTypes: SpriteType[],
	styleTable: StyleTable,
): Promise<string> {
	return (
		await Promise.all(spriteTypes.map((st) => renderSpriteType(st, styleTable)))
	).join("");
}

// Attribute-context escape for the sprite name in the id: unlike htmlEscape it leaves spaces as-is so
// the filter's element.id.includes() keeps matching, while still neutralising a "-breakout from a
// crafted mod name. The name is untrusted (comes from the parsed .gfx file).
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

async function renderSpriteType(
	spriteType: SpriteType,
	styleTable: StyleTable,
): Promise<string> {
	const image = await getImageByPath(spriteType.texturefile);
	return `<div
        id="${escapeAttr(spriteType.name)}"
        class="
            spriteTypePreview
            navigator
            ${styleTable.style(
							"spriteTypePreview",
							() => `
                display: inline-block;
                text-align: center;
                margin: 10px;
                cursor: pointer;
            `,
						)}
        "
        start="${spriteType.token?.start}"
        end="${spriteType.token?.end}"
        title="${htmlEscape(spriteType.name)}${
					image
						? ` (${
								image.width / spriteType.noofframes
							}x${image.height}x${spriteType.noofframes})`
						: ""
				}\n${image ? image.path : localize("gfx.imagenotfound", "Image not found")}">
        ${
					image
						? `<img src="${image.uri}" />`
						: `<div 
            class="${styleTable.style(
							"missingImageOuter",
							() => `
                height: 100px;
                width: 100px;
                background: grey;
                margin: auto;
                display: table;
            `,
						)}">
                <div class="${styleTable.style("missingImageInner", () => `display:table-cell;vertical-align:middle;color:black;`)}">
                    MISSING
                </div>
            </div>`
				}
        <p class="
            ${styleTable.style(
							"imageName-common",
							() => `
                min-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-top: 0
            `,
						)}
            ${styleTable.oneTimeStyle(
							"imageName",
							() => `
                max-width: ${Math.max(image?.width || 100, 120)}px;
            `,
						)}
        ">
            ${htmlEscape(spriteType.name)}
        </p>
    </div>`;
}
