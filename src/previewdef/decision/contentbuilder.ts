import * as vscode from "vscode";
import { DecisionsLoader } from "./loader";
import { localize } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { buildDecisionGraphPayload } from "./graph";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";
import { renderLoaderFile } from "../loaderrender";
import { renderPreviewShell, toolbarWrapper, toggleHtml, searchHtml, filterOption, filterSelectHtml } from "../toolbarparts";

export async function renderDecisionFile(loader: DecisionsLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions): Promise<LoaderRender> {
	return renderLoaderFile(loader, uri, webview, options, {
		debugLabel: "Loader session decision tree",
		scripts: ["common.js", "decisiontree.js"],
		styles: ["codicon.css", "common.css", "hoicard.css", "hoigraph.css", "decisiontree.css"],
		serverStylesId: "decision-server-styles",
		buildPage: async (result, styleTable) => {
			const decisionGraph = await buildDecisionGraphPayload(result, styleTable);
			return { content: renderPreviewShell(styleTable, "decisiontreecontent", () => renderToolBar(styleTable), true), data: { decisionGraph } };
		},
	});
}

function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("decToggleLabel", () => `margin-right:5px`);
	const search = searchHtml(labelStyle, "dec", localize("decisiontree.search", "Search: "));
	const marker = (kind: string) => `ev-marker dec-marker-${kind}`;
	const filters = filterSelectHtml(styleTable, labelStyle, "dec", localize("decisiontree.filters", "Filters: "), [
		filterOption("missions", localize("decisiontree.filtermissions", "Missions"), marker("mission")),
		filterOption("decisions", localize("decisiontree.filterdecisions", "Decisions"), marker("decision")),
		filterOption("chains", localize("decisiontree.filterchains", "In a chain"), ""),
		filterOption("effects", localize("decisiontree.filtereffects", "Has effects"), ""),
		filterOption("modifiers", localize("decisiontree.filtermodifiers", "Has modifiers"), ""),
		filterOption("conditions", localize("decisiontree.filterconditions", "Has conditions"), ""),
		filterOption("scriptedgui", localize("decisiontree.filterscriptedgui", "Custom GUI"), marker("gui")),
	]);
	const toggles = [
		toggleHtml(labelStyle, "show-localisation", localize("decisiontree.showlocalisation", "Show localisation")),
		toggleHtml(labelStyle, "show-icon", localize("decisiontree.showicon", "Show icon")),
		toggleHtml(labelStyle, "show-conditions", localize("decisiontree.showconditions", "Show conditions")),
		toggleHtml(labelStyle, "show-effects", localize("decisiontree.showeffects", "Show effects")),
		toggleHtml(labelStyle, "show-scripted-gui", localize("decisiontree.showscriptedgui", "Show custom GUI")),
	].join("");
	const iconButton = (id: string, icon: string, text: string) => `
        <button id="${id}" title="${text}" aria-label="${text}">
            <i class="codicon codicon-${icon}"></i>
        </button>`;
	const collapseButtons = [
		iconButton("collapse-all-categories", "collapse-all", localize("decisiontree.collapseallcategories", "Collapse all categories")),
		iconButton("expand-all-categories", "expand-all", localize("decisiontree.expandallcategories", "Expand all categories")),
	].join("");
	return toolbarWrapper(styleTable, () => `${search}${filters}${toggles}${collapseButtons}`);
}
