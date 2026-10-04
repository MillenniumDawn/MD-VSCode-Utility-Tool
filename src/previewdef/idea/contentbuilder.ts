import * as vscode from "vscode";
import { IdeasLoader } from "./loader";
import { localize } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { buildIdeaPreviewPayload } from "./build";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";
import { renderLoaderFile } from "../loaderrender";
import { renderPreviewShell, toolbarWrapper, toggleHtml, searchHtml, filterOption, filterSelectHtml } from "../toolbarparts";

export async function renderIdeaFile(loader: IdeasLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions): Promise<LoaderRender> {
	return renderLoaderFile(loader, uri, webview, options, {
		debugLabel: "Loader session idea preview",
		scripts: ["common.js", "ideapreview.js"],
		styles: ["codicon.css", "common.css", "hoicard.css", "ideapreview.css"],
		serverStylesId: "idea-server-styles",
		buildPage: async (result, styleTable) => {
			const ideaPreview = await buildIdeaPreviewPayload(result, styleTable);
			return { content: renderPreviewShell(styleTable, "ideapreviewcontent", () => renderToolBar(styleTable)), data: { ideaPreview } };
		},
	});
}

function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("ideaToggleLabel", () => `margin-right:5px`);
	const search = searchHtml(labelStyle, "idea", localize("ideapreview.search", "Search: "));
	const filters = filterSelectHtml(styleTable, labelStyle, "idea", localize("ideapreview.filters", "Filters: "), [
		filterOption("laws", localize("ideapreview.filterlaws", "Laws")),
		filterOption("default", localize("ideapreview.filterdefault", "Starting idea")),
		filterOption("modifiers", localize("ideapreview.filtermodifiers", "Has modifiers")),
		filterOption("research", localize("ideapreview.filterresearch", "Has research bonus")),
		filterOption("conditions", localize("ideapreview.filterconditions", "Has conditions")),
		filterOption("chains", localize("ideapreview.filterchains", "In an idea chain")),
	]);
	const toggles = [
		toggleHtml(labelStyle, "show-localisation", localize("ideapreview.showlocalisation", "Show localisation")),
		toggleHtml(labelStyle, "show-icon", localize("ideapreview.showicon", "Show icon")),
		toggleHtml(labelStyle, "show-modifiers", localize("ideapreview.showmodifiers", "Show modifiers")),
		toggleHtml(labelStyle, "show-description", localize("ideapreview.showdescription", "Show description")),
		toggleHtml(labelStyle, "show-conditions", localize("ideapreview.showconditions", "Show conditions")),
	].join("");
	return toolbarWrapper(styleTable, () => `${search}${filters}${toggles}`);
}
