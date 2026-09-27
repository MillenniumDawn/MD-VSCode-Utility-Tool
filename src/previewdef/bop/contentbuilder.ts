import * as vscode from "vscode";
import { BopLoader } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, previewedFileUriScript, errorPage } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { jsonForScript } from "../../util/common";
import { buildBopPreviewPayload } from "./build";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";

// Height of the fixed toolbar strip. The cards are offset by it so they never render underneath.
const toolbarHeight = 40;

export async function renderBopFile(
	loader: BopLoader,
	uri: vscode.Uri,
	webview: vscode.Webview,
	options?: RenderContentOptions,
): Promise<LoaderRender> {
	try {
		// A dependency change is a .gfx or a modifier definition being edited, not this file. The
		// loader decides whether to reload by hashing this file's content, which has not moved, so
		// without forcing the session it would hand back what it read before the edit.
		const session = new LoaderSession(options?.dependencyChanged ?? false);
		const loadResult = await loader.load(session);
		debug("Loader session bop preview", session.loadedLoaderNames());

		const styleTable = new StyleTable();
		const bopPreview = await buildBopPreviewPayload(loadResult.result, styleTable);

		const baseContent = renderShell(styleTable);
		const fullHtml = () => html(
			webview,
			baseContent,
			[
				previewedFileUriScript(uri),
				{ content: `window.bopPreview = ${jsonForScript(bopPreview)};` },
				{ content: i18nTableAsScript() },
				"common.js",
				"boppreview.js",
			],
			[
				"codicon.css",
				"common.css",
				"hoicard.css",
				"boppreview.css",
				{ content: styleTable.toRawCss(), id: "bop-server-styles" },
			],
		);

		return {
			html: fullHtml,
			update: { styleCss: styleTable.toRawCss(), data: { bopPreview } },
		};
	} catch (e) {
		return errorPage(webview, uri, e);
	}
}

function renderShell(styleTable: StyleTable): string {
	return `
        <div id="boppreviewcontent" class="${styleTable.style(
					"boppreviewcontent",
					() => `
            position: relative;
            top: ${toolbarHeight}px;
        `,
				)}"></div>
        ${renderToolBar(styleTable)}
    `;
}

// Outside #boppreviewcontent so its listener is bound once and an in-place update never rebinds it.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("bopToggleLabel", () => `margin-right:5px`);
	return `<div class="toolbar-outer ${styleTable.style(
		"toolbar-height",
		() => `box-sizing: border-box; height: ${toolbarHeight}px;`,
	)}">
        <div class="toolbar">
            <label for="show-localisation" class="${labelStyle}">${localize("boppreview.showlocalisation", "Show localisation")}</label>
            <input type="checkbox" id="show-localisation">
        </div>
    </div>`;
}
