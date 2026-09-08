import * as vscode from "vscode";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import { getSpriteTypes, SpriteType } from "../../hoiformat/spritetype";
import { getImageByPath } from "../../util/image/imagecache";
import { localize } from "../../util/i18n";
import { escapeAttr, html, htmlEscape, previewedFileUriScript, errorPageContent } from "../../util/html";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { mapLimit } from "../../util/common";
import { LoaderRenderResult } from "../updateablepreview";

// Caps how many sprite renders -- and therefore how many DDS/TGA decodes -- run at once. A single
// interface/*.gfx routinely declares thousands of spriteTypes, so an unbounded fan-out read and
// decoded every referenced texture simultaneously. Matches the focus tree's renderConcurrency.
const renderConcurrency = 8;

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
		const baseContent = errorPageContent(e);
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
		await mapLimit(spriteTypes, renderConcurrency, (st) =>
			renderSpriteType(st, styleTable),
		)
	).join("");
}

async function renderSpriteType(
	spriteType: SpriteType,
	styleTable: StyleTable,
): Promise<string> {
	const image = await getImageByPath(spriteType.texturefile);
	const captionWidth = Math.max(image?.width || 100, 120);
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
						? // The texture is carried by a CSS rule keyed on its resolved path, not by an <img>
							// src, so a texture named by many spriteTypes (an event picture shared by
							// hundreds of them) contributes its base64 payload to the page exactly once
							// instead of once per sprite. inline-block reproduces the <img>'s layout under
							// the parent's text-align: center.
							`<div class="${styleTable.style(
								"gfx-texture-" + normalizeForStyle(image.path.toString()),
								() => `
                display: inline-block;
                width: ${image.width}px;
                height: ${image.height}px;
                background-image: url(${image.uri});
                background-size: ${image.width}px ${image.height}px;
            `,
							)}"></div>`
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
            ${styleTable.style(
							"imageName-w" + captionWidth,
							() => `
                max-width: ${captionWidth}px;
            `,
						)}
        ">
            ${htmlEscape(spriteType.name)}
        </p>
    </div>`;
}
