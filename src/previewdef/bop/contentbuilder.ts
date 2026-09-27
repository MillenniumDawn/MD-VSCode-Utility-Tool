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

// Height of the fixed toolbar strip, as the MIO preview's: room for the dropdown and the strip's
// own thin scrollbar. The window is offset by it so it never renders underneath.
const toolbarHeight = 52;

// The steps Millennium Dawn's add_power_balance_value calls use most.
const steps = [-0.1, -0.05, 0.05, 0.1];

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

// Outside #boppreviewcontent so its listeners are bound once and an in-place update never rebinds
// them. The BoP dropdown, as the MIO preview's, is only shown when the file has more than one; the
// value controls stand in for add_power_balance_value and act on the BoP shown.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("bopToggleLabel", () => `margin-right:5px`);
	const gap = styleTable.style("marginRight10", () => `margin-right:10px`);
	const stepButton = (step: number) =>
		`<button class="bop-step" data-step="${step}">${step > 0 ? "+" : ""}${step}</button>`;
	return `<div class="toolbar-outer ${styleTable.style(
		"toolbar-height",
		() => `box-sizing: border-box; height: ${toolbarHeight}px;`,
	)}">
        <div class="toolbar">
            <div id="bop-select-container" class="${styleTable.style("bop-select-hidden", () => `display:none`)}">
                <label for="bops" class="${labelStyle}">${localize("boppreview.bop", "Balance of power: ")}</label>
                <div class="select-container ${gap}">
                    <select id="bops" class="select multiple-select" tabindex="0" role="combobox"></select>
                </div>
            </div>
            <div class="bop-controls ${gap}">
                ${steps.filter((s) => s < 0).map(stepButton).join("")}
                <input type="range" id="bop-slider" class="bop-slider" min="-1" max="1" step="0.01">
                ${steps.filter((s) => s > 0).map(stepButton).join("")}
                <input type="number" id="bop-number" class="bop-number" min="-1" max="1" step="0.01">
                <button id="bop-reset" class="bop-reset">${localize("boppreview.reset", "Reset to initial_value")}</button>
            </div>
            <label for="show-localisation" class="${labelStyle}">${localize("boppreview.showlocalisation", "Show localisation")}</label>
            <input type="checkbox" id="show-localisation">
        </div>
    </div>`;
}
