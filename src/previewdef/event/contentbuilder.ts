import * as vscode from "vscode";
import { EventsLoader, EventsLoaderResult } from "./loader";
import { localize } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { HOIEvent } from "./schema";
import flatten from "lodash/flatten";
import { arrayToMap } from "../../util/common";
import { buildEventGraphPayload, eventsToGraph } from "./graph";
import { EventGraphPayload } from "./payload";
import { LoaderRender, RenderContentOptions } from "../loaderpreview";
import { renderLoaderFile } from "../loaderrender";
import { renderPreviewShell, toolbarWrapper, toggleHtml, searchHtml, filterOption, filterSelectHtml } from "../toolbarparts";

export async function renderEventFile(loader: EventsLoader, uri: vscode.Uri, webview: vscode.Webview, options?: RenderContentOptions): Promise<LoaderRender> {
	return renderLoaderFile(loader, uri, webview, options, {
		debugLabel: "Loader session event tree",
		scripts: ["common.js", "eventtree.js"],
		styles: ["codicon.css", "common.css", "hoicard.css", "hoigraph.css", "eventtree.css"],
		serverStylesId: "event-server-styles",
		buildPage: async (result, styleTable) => {
			const eventGraph = await renderEvents(result, styleTable);
			return {
				content: renderPreviewShell(styleTable, "eventtreecontent", () => renderToolBar(styleTable), true),
				data: {
					eventGraph,
					...(options?.browserSmoke === true ? { browserSmokeRenderAck: true } : {}),
				},
			};
		},
	});
}

async function renderEvents(eventsLoaderResult: EventsLoaderResult, styleTable: StyleTable): Promise<EventGraphPayload> {
	const eventIdToEvent = arrayToMap(
		flatten(Object.values(eventsLoaderResult.events.eventItemsByNamespace)) as HOIEvent[],
		"id",
	);
	const graph = eventsToGraph(eventIdToEvent, eventsLoaderResult.mainNamespaces);
	return buildEventGraphPayload(graph, eventsLoaderResult, styleTable);
}

function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("evToggleLabel", () => `margin-right:5px`);
	const search = searchHtml(labelStyle, "ev", localize("eventtree.search", "Search: "));
	const marker = (kind: string) => `ev-marker ev-marker-${kind}`;
	const filters = filterSelectHtml(styleTable, labelStyle, "ev", localize("eventtree.filters", "Filters: "), [
		filterOption("mtth", localize("eventtree.filtermtth", "MTTH events"), marker("mtth")),
		filterOption("triggered", localize("eventtree.filtertriggered", "Triggered only"), marker("triggered")),
		filterOption("news", localize("eventtree.filternews", "News events"), marker("news")),
		filterOption("hidden", localize("eventtree.filterhidden", "Hidden"), marker("hidden")),
		filterOption("major", localize("eventtree.filtermajor", "Major"), marker("major")),
		filterOption("chains", localize("eventtree.filterchains", "Event chains"), ""),
	]);
	const toggles = [
		toggleHtml(labelStyle, "show-localisation", localize("eventtree.showlocalisation", "Show localisation")),
		toggleHtml(labelStyle, "show-option-triggers", localize("eventtree.showoptiontriggers", "Show option triggers")),
		toggleHtml(labelStyle, "show-edge-conditions", localize("eventtree.showedgeconditions", "Show arrow conditions")),
		toggleHtml(labelStyle, "show-event-conditions", localize("eventtree.showeventconditions", "Show event conditions")),
		toggleHtml(labelStyle, "show-picture", localize("eventtree.showpicture", "Show event picture")),
		toggleHtml(labelStyle, "show-effects", localize("eventtree.showeffects", "Show effects")),
	].join("");
	return toolbarWrapper(styleTable, () => `${search}${filters}${toggles}`);
}
