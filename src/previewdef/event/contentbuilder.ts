import * as vscode from "vscode";
import { EventsLoader, EventsLoaderResult } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, previewedFileUriScript, errorPage } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { HOIEvent } from "./schema";
import { flatten } from "lodash";
import { arrayToMap, jsonForScript } from "../../util/common";
import { buildEventGraphPayload, eventsToGraph } from "./graph";
import { EventGraphPayload } from "./payload";
import { LoaderRender } from "../loaderpreview";

// Height of the fixed toolbar strip. The content is offset by it and enableZoom is told about
// it, so the graph never renders underneath the toolbar.
//
// It has to clear more than the row itself: common.css adds 10px of padding above, a 1px bottom
// border, and the strip scrolls horizontally, so its 6px scrollbar eats into the same box. At 40
// that left less room than the 24px-tall search box and checkboxes need and the row was clipped.
// webviewsrc/eventtree.ts carries the same constant -- the two must move together.
const toolbarHeight = 52;

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
				// The theme tokens and the card primitives, shared with the idea preview.
				"hoicard.css",
				// The canvas the cards are laid out on -- rails, arrows, chips -- shared with the
				// decision preview.
				"hoigraph.css",
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
		return errorPage(webview, uri, e);
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

// The drag layer is a fixed, viewport-sized, transparent div: pressing anywhere the graph does not
// cover starts a pan (see initCommon in webviewsrc/util/common.ts). Which of these three covers
// which is settled by the --ev-layer-* scale in eventtree.css, not by the order they are written
// in; the order below is kept only because it reads the way the layers stack.
function renderShell(styleTable: StyleTable): string {
	return `
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
        ${renderToolBar(styleTable)}
    `;
}

// The toolbar lives outside #eventtreecontent so its listeners are bound once and an in-place
// update never rebinds them. Modelled on the MIO preview's toolbar.
//
// Every control is always rendered, including the ones a given file cannot use: which of them are
// shown is decided in the webview from EventGraphPayload.toolbarFlags. Deciding it here would put
// the answer in the baked-in shell, where the only way to apply a change is to reassign the whole
// html -- a page teardown, losing scroll and zoom, on every flip.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("evToggleLabel", () => `margin-right:5px`);

	// The <input> is hidden and replaced by a codicon checkbox as soon as the webview loads, so it
	// carries no spacing: the gap between two toggles is on .checkbox-container-out in eventtree.css.
	const toggle = (id: string, text: string) => `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}">`;

	// Leftmost, because the toolbar strip scrolls horizontally in a narrow pane and search is the one
	// control that has to stay reachable without scrolling it.
	const search = `
        <label for="ev-searchbox" class="${labelStyle}">${localize("eventtree.search", "Search: ")}</label>
        <input id="ev-searchbox" type="text" />
        <span id="ev-search-count" class="ev-search-count"></span>`;

	// One multi-select rather than one checkbox per idea: every entry answers the same question --
	// which events belong on the canvas -- and two separate controls narrowing the same graph left
	// the reader with no single place to read the answer off. Selecting nothing shows everything;
	// selecting several is an OR. Which entries are offered is decided in the webview from
	// EventGraphPayload.toolbarFlags, so the list itself is written out in full here.
	//
	// Each entry carries the glyph the matching events wear on the canvas, so the shape vocabulary is
	// learned from the control that uses it. It travels as an attribute rather than as markup inside
	// the div because the dropdown flattens an option with textContent, which would drop the element
	// and leave its classes in the closed combobox caption. Event chains has no glyph -- nothing on a
	// card stands for it -- so it passes the empty string, which still reserves the column and keeps
	// the six labels aligned.
	const filterOption = (value: string, text: string, glyph: string) =>
		`<div class="option" value="${value}" data-glyph="${glyph}">${text}</div>`;
	const marker = (kind: string) => `ev-marker ev-marker-${kind}`;
	const filters = `
        <div id="ev-filter-container">
            <label for="ev-filters" class="${labelStyle}">${localize("eventtree.filters", "Filters: ")}</label>
            <div class="select-container ${styleTable.style("marginRight10", () => `margin-right:10px`)}">
                <div id="ev-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    ${filterOption("mtth", localize("eventtree.filtermtth", "MTTH events"), marker("mtth"))}
                    ${filterOption("triggered", localize("eventtree.filtertriggered", "Triggered only"), marker("triggered"))}
                    ${filterOption("news", localize("eventtree.filternews", "News events"), marker("news"))}
                    ${filterOption("hidden", localize("eventtree.filterhidden", "Hidden"), marker("hidden"))}
                    ${filterOption("major", localize("eventtree.filtermajor", "Major"), marker("major"))}
                    ${filterOption("chains", localize("eventtree.filterchains", "Event chains"), "")}
                </div>
            </div>
        </div>`;

	const toggles = [
		toggle("show-localisation", localize("eventtree.showlocalisation", "Show localisation")),
		toggle("show-option-triggers", localize("eventtree.showoptiontriggers", "Show option triggers")),
		toggle("show-edge-conditions", localize("eventtree.showedgeconditions", "Show arrow conditions")),
		toggle("show-event-conditions", localize("eventtree.showeventconditions", "Show event conditions")),
		toggle("show-picture", localize("eventtree.showpicture", "Show event picture")),
		toggle("show-effects", localize("eventtree.showeffects", "Show effects")),
	].join("");

	return `<div class="toolbar-outer ${styleTable.style(
		"toolbar-height",
		() => `box-sizing: border-box; height: ${toolbarHeight}px;`,
	)}">
        <div class="toolbar">
            ${search}${filters}${toggles}
        </div>
    </div>`;
}
