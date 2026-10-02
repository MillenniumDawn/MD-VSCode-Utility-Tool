import * as vscode from "vscode";
import { BopLoader } from "./loader";
import { localize } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { buildBopPreviewPayload } from "./build";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";
import { renderLoaderFile } from "../loaderrender";
import { renderPreviewShell, toolbarWrapper } from "../toolbarparts";

// The steps Millennium Dawn's add_power_balance_value calls use most.
const steps = [-0.1, -0.05, 0.05, 0.1];

export async function renderBopFile(loader: BopLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions): Promise<LoaderRender> {
	return renderLoaderFile(loader, uri, webview, options, {
		debugLabel: "Loader session bop preview",
		scripts: ["common.js", "boppreview.js"],
		styles: ["codicon.css", "common.css", "hoicard.css", "boppreview.css"],
		serverStylesId: "bop-server-styles",
		buildPage: async (result, styleTable) => {
			const bopPreview = await buildBopPreviewPayload(result, styleTable);
			return { content: renderPreviewShell(styleTable, "boppreviewcontent", () => renderToolBar(styleTable)), data: { bopPreview } };
		},
	});
}

function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("bopToggleLabel", () => `margin-right:5px`);
	const gap = styleTable.style("marginRight10", () => `margin-right:10px`);
	const stepButton = (step: number) =>
		`<button class="bop-step" data-step="${step}">${step > 0 ? "+" : ""}${step}</button>`;
	return toolbarWrapper(styleTable, () => `<div id="bop-select-container" class="${styleTable.style("bop-select-hidden", () => `display:none`)}">
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
            <input type="checkbox" id="show-localisation">`);
}
