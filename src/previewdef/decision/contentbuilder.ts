import * as vscode from "vscode";
import { DecisionsLoader } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, previewedFileUriScript, errorPage } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { jsonForScript } from "../../util/common";
import { buildDecisionGraphPayload } from "./graph";
import { LoaderRender } from "../loaderpreview";

// Height of the fixed toolbar strip. The content is offset by it and enableZoom is told about it,
// so the graph never renders underneath the toolbar.
// webviewsrc/decisiontree.ts carries the same constant -- the two must move together.
const toolbarHeight = 52;

export async function renderDecisionFile(
	loader: DecisionsLoader,
	uri: vscode.Uri,
	webview: vscode.Webview,
): Promise<LoaderRender> {
	try {
		const session = new LoaderSession(false);
		const loadResult = await loader.load(session);
		debug("Loader session decision tree", session.loadedLoaderNames());

		const styleTable = new StyleTable();
		const decisionGraph = await buildDecisionGraphPayload(loadResult.result, styleTable);

		const fullHtml = html(
			webview,
			renderShell(styleTable),
			[
				previewedFileUriScript(uri),
				// jsonForScript, not JSON.stringify: the payload carries localisation text straight
				// from the workspace, and a string containing `</script>` would end the tag here.
				{ content: `window.decisionGraph = ${jsonForScript(decisionGraph)};` },
				{ content: i18nTableAsScript() },
				"common.js",
				"decisiontree.js",
			],
			[
				"codicon.css",
				// The shared widget stylesheet: .toolbar-outer, .toolbar and the codicon checkbox the
				// toggles are upgraded into.
				"common.css",
				// The theme tokens and the card primitives, shared with the event and idea previews.
				"hoicard.css",
				// The canvas the cards are laid out on -- rails, arrows, chips -- shared with the
				// event preview.
				"hoigraph.css",
				"decisiontree.css",
				// Addressable id so an in-place updateBody can refresh the server StyleTable -- which
				// holds the decision icons and the rendered scripted GUI windows -- by mutating this
				// <style>.textContent instead of forcing a full reload.
				{ content: styleTable.toRawCss(), id: "decision-server-styles" },
			],
		);

		// Parts for the in-place update. The graph is laid out and rendered in the webview, so the
		// payload ships the data rather than markup. JSON.stringify over a deterministically built
		// payload is byte-identical for identical input, so an unchanged edit hashes equal and the
		// LoaderPreview skips.
		return {
			html: fullHtml,
			update: { styleCss: styleTable.toRawCss(), data: { decisionGraph } },
		};
	} catch (e) {
		return errorPage(webview, uri, e);
	}
}

// The drag layer is a fixed, viewport-sized, transparent div: pressing anywhere the graph does not
// cover starts a pan. Which of these three covers which is settled by the --ev-layer-* scale in
// hoicard.css, not by the order they are written in.
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
        <div id="decisiontreecontent" class="${styleTable.style(
					"decisiontreecontent",
					() => `
            position: relative;
            top: ${toolbarHeight}px;
        `,
				)}"></div>
        ${renderToolBar(styleTable)}
    `;
}

// The toolbar lives outside #decisiontreecontent so its listeners are bound once and an in-place
// update never rebinds them.
//
// Every control is always rendered, including the ones a given file cannot use: which of them are
// shown is decided in the webview from DecisionGraphPayload.toolbarFlags. Deciding it here would
// put the answer in the baked-in shell, where the only way to apply a change is to reassign the
// whole html -- a page teardown, losing scroll and zoom, on every flip.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("decToggleLabel", () => `margin-right:5px`);

	const toggle = (id: string, text: string) => `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}">`;

	// Leftmost, because the toolbar strip scrolls horizontally in a narrow pane and search is the one
	// control that has to stay reachable without scrolling it.
	const search = `
        <label for="dec-searchbox" class="${labelStyle}">${localize("decisiontree.search", "Search: ")}</label>
        <input id="dec-searchbox" type="text" />
        <span id="dec-search-count" class="dec-search-count"></span>`;

	// One multi-select rather than one checkbox per kind: every entry answers the same question --
	// which decisions belong on the canvas. Selecting nothing shows everything; selecting several is
	// an OR. Each entry carries the glyph the matching cards wear, so the vocabulary is learned from
	// the control that uses it; the entries with nothing on a card standing for them pass the empty
	// string, which still reserves the column and keeps the labels aligned.
	const filterOption = (value: string, text: string, glyph: string) =>
		`<div class="option" value="${value}" data-glyph="${glyph}">${text}</div>`;
	const marker = (kind: string) => `ev-marker dec-marker-${kind}`;
	const filters = `
        <div id="dec-filter-container">
            <label for="dec-filters" class="${labelStyle}">${localize("decisiontree.filters", "Filters: ")}</label>
            <div class="select-container ${styleTable.style("marginRight10", () => `margin-right:10px`)}">
                <div id="dec-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    ${filterOption("missions", localize("decisiontree.filtermissions", "Missions"), marker("mission"))}
                    ${filterOption("decisions", localize("decisiontree.filterdecisions", "Decisions"), marker("decision"))}
                    ${filterOption("chains", localize("decisiontree.filterchains", "In a chain"), "")}
                    ${filterOption("effects", localize("decisiontree.filtereffects", "Has effects"), "")}
                    ${filterOption("modifiers", localize("decisiontree.filtermodifiers", "Has modifiers"), "")}
                    ${filterOption("conditions", localize("decisiontree.filterconditions", "Has conditions"), "")}
                    ${filterOption("scriptedgui", localize("decisiontree.filterscriptedgui", "Custom GUI"), marker("gui"))}
                </div>
            </div>
        </div>`;

	const toggles = [
		toggle("show-localisation", localize("decisiontree.showlocalisation", "Show localisation")),
		toggle("show-icon", localize("decisiontree.showicon", "Show icon")),
		toggle("show-conditions", localize("decisiontree.showconditions", "Show conditions")),
		toggle("show-effects", localize("decisiontree.showeffects", "Show effects")),
		toggle("show-scripted-gui", localize("decisiontree.showscriptedgui", "Show custom GUI")),
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
