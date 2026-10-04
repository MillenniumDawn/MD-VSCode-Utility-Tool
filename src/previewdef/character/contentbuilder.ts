import * as vscode from "vscode";
import { CharactersLoader } from "./loader";
import { localize } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { buildCharacterPreviewPayload } from "./build";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";
import { renderLoaderFile } from "../loaderrender";
import { renderPreviewShell, toolbarWrapper, toggleHtml, searchHtml, filterOption, filterSelectHtml } from "../toolbarparts";

export async function renderCharacterFile(loader: CharactersLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions): Promise<LoaderRender> {
	return renderLoaderFile(loader, uri, webview, options, {
		debugLabel: "Loader session character preview",
		scripts: ["common.js", "characterpreview.js"],
		styles: ["codicon.css", "common.css", "hoicard.css", "characterpreview.css"],
		serverStylesId: "character-server-styles",
		buildPage: async (result, styleTable) => {
			const characterPreview = await buildCharacterPreviewPayload(result, styleTable);
			return { content: renderPreviewShell(styleTable, "characterpreviewcontent", () => renderToolBar(styleTable)), data: { characterPreview } };
		},
	});
}

function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("charToggleLabel", () => `margin-right:5px`);
	const search = searchHtml(labelStyle, "character", localize("characterpreview.search", "Search: "));
	const filters = filterSelectHtml(styleTable, labelStyle, "character", localize("characterpreview.filters", "Filters: "), [
		filterOption("multirole", localize("characterpreview.filtermultirole", "Has several roles")),
		filterOption("unknowntrait", localize("characterpreview.filterunknowntrait", "Has unknown trait")),
		filterOption("noportrait", localize("characterpreview.filternoportrait", "Portrait not found")),
		filterOption("traits", localize("characterpreview.filtertraits", "Has traits")),
		filterOption("conditions", localize("characterpreview.filterconditions", "Has conditions")),
	]);
	const toggles = [
		toggleHtml(labelStyle, "show-localisation", localize("characterpreview.showlocalisation", "Show localisation")),
		toggleHtml(labelStyle, "show-portrait", localize("characterpreview.showportrait", "Show portrait")),
		toggleHtml(labelStyle, "show-skills", localize("characterpreview.showskills", "Show skills")),
		toggleHtml(labelStyle, "expand-traits", localize("characterpreview.expandtraits", "Expand traits")),
		toggleHtml(labelStyle, "show-description", localize("characterpreview.showdescription", "Show description")),
		toggleHtml(labelStyle, "show-conditions", localize("characterpreview.showconditions", "Show conditions")),
	].join("");
	return toolbarWrapper(styleTable, () => `${search}${filters}${toggles}`);
}
