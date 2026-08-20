import * as vscode from "vscode";
import { EventsLoader, EventsLoaderResult } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, htmlEscape, previewedFileUriScript } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { HOIEvent } from "./schema";
import { flatten } from "lodash";
import { arrayToMap, forceError, jsonForScript } from "../../util/common";
import { buildEventGraphPayload, eventsToGraph } from "./graph";
import { EventGraphPayload } from "./payload";
import { LoaderRender } from "../loaderpreview";

// Height of the fixed toolbar strip. The content is offset by it and enableZoom is told about
// it, so the graph never renders underneath the toolbar.
const toolbarHeight = 40;

export async function renderEventFile(
	loader: EventsLoader,
	uri: vscode.Uri,
	webview: vscode.Webview,
): Promise<LoaderRender> {
	try {
		const session = new LoaderSession(false);
		const loadResult = await loader.load(session);
		debug("Loader session event tree", session.loadedLoaderNames());

		const styleTable = new StyleTable();
		const eventGraph = await renderEvents(loadResult.result, styleTable);

		const baseContent = renderShell(styleTable);

		const fullHtml = html(
			webview,
			baseContent,
			[
				previewedFileUriScript(uri),
				// jsonForScript, not JSON.stringify: the payload carries localisation text straight
				// from the workspace, and a string containing `</script>` would end the tag here.
				{ content: `window.eventGraph = ${jsonForScript(eventGraph)};` },
				{ content: i18nTableAsScript() },
				"common.js",
				"eventtree.js",
			],
			[
				"codicon.css",
				// The shared widget stylesheet: .toolbar-outer, .toolbar and the codicon checkbox
				// the toggles are upgraded into. Without it the toolbar renders unstyled.
				"common.css",
				"eventtree.css",
				// Addressable id so an in-place updateBody can refresh the server StyleTable -- which
				// now only holds the event picture sprites -- by mutating this <style>.textContent
				// instead of forcing a full reload.
				{ content: styleTable.toRawCss(), id: "event-server-styles" },
			],
		);

		// Parts for the in-place update. The graph is laid out and rendered in the webview, so the
		// payload ships the data rather than markup. JSON.stringify over a deterministically built
		// payload (stable graph order, counter-assigned ids) is byte-identical for identical input,
		// so an unchanged edit hashes equal and the LoaderPreview skips.
		return {
			html: fullHtml,
			update: { styleCss: styleTable.toRawCss(), data: { eventGraph } },
		};
	} catch (e) {
		const baseContent = `${localize("error", "Error")}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
		return html(webview, baseContent, [previewedFileUriScript(uri)], []);
	}
}

async function renderEvents(
	eventsLoaderResult: EventsLoaderResult,
	styleTable: StyleTable,
): Promise<EventGraphPayload> {
	const eventIdToEvent = arrayToMap(
		flatten(Object.values(eventsLoaderResult.events.eventItemsByNamespace)) as HOIEvent[],
		"id",
	);
	const graph = eventsToGraph(eventIdToEvent, eventsLoaderResult.mainNamespaces);
	return buildEventGraphPayload(graph, eventsLoaderResult, styleTable);
}

function renderShell(styleTable: StyleTable): string {
	return `
        ${renderToolBar(styleTable)}
        <div id="dragger" class="${styleTable.style(
					"dragger",
					() => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `,
				)}"></div>
        <div id="eventtreecontent" class="${styleTable.style(
					"eventtreecontent",
					() => `
            position: relative;
            top: ${toolbarHeight}px;
        `,
				)}"></div>
    `;
}

// The toolbar lives outside #eventtreecontent so its listeners are bound once and an in-place
// update never rebinds them. Modelled on the MIO preview's toolbar.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("evToggleLabel", () => `margin-right:5px`);
	const gapStyle = styleTable.style("evToggleGap", () => `margin-right:20px`);

	const toggle = (id: string, text: string) => `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}" class="${gapStyle}">`;

	const toggles = [
		toggle("show-localisation", localize("eventtree.showlocalisation", "Show localisation")),
		toggle("show-triggers", localize("eventtree.showtriggers", "Show triggers")),
		toggle("show-event-conditions", localize("eventtree.showeventconditions", "Show event conditions")),
		toggle("show-hidden", localize("eventtree.showhidden", "Show hidden & immediate")),
		toggle("show-picture", localize("eventtree.showpicture", "Show event picture")),
	].join("");

	return `<div class="toolbar-outer ${styleTable.style(
		"toolbar-height",
		() => `box-sizing: border-box; height: ${toolbarHeight}px;`,
	)}">
        <div class="toolbar">
            ${toggles}
        </div>
    </div>`;
}
