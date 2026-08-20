import * as vscode from "vscode";
import { IdeasLoader } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, htmlEscape, previewedFileUriScript } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { forceError, jsonForScript } from "../../util/common";
import { buildIdeaPreviewPayload } from "./build";
import { LoaderRender } from "../loaderpreview";

// Height of the fixed toolbar strip. The roster is offset by it so it never renders underneath.
// webviewsrc/ideapreview.ts carries the same constant -- the two must move together.
const toolbarHeight = 52;

export async function renderIdeaFile(
	loader: IdeasLoader,
	uri: vscode.Uri,
	webview: vscode.Webview,
): Promise<LoaderRender> {
	try {
		const session = new LoaderSession(false);
		const loadResult = await loader.load(session);
		debug("Loader session idea preview", session.loadedLoaderNames());

		const styleTable = new StyleTable();
		const ideaPreview = await buildIdeaPreviewPayload(
			loadResult.result,
			styleTable,
		);

		const fullHtml = html(
			webview,
			renderShell(styleTable),
			[
				previewedFileUriScript(uri),
				// jsonForScript, not JSON.stringify: the payload carries localisation text straight
				// from the workspace, and a string containing `</script>` would end the tag here.
				{ content: `window.ideaPreview = ${jsonForScript(ideaPreview)};` },
				{ content: i18nTableAsScript() },
				"common.js",
				"ideapreview.js",
			],
			[
				"codicon.css",
				// The shared widget stylesheet: .toolbar-outer, .toolbar and the codicon checkbox the
				// toggles are upgraded into.
				"common.css",
				// The card primitives, shared with the event preview so an idea card and an event card
				// are the same object.
				"hoicard.css",
				"ideapreview.css",
				// Addressable id so an in-place updateBody can refresh the server StyleTable -- which
				// holds the idea icons -- by mutating this <style>.textContent instead of forcing a
				// full reload.
				{ content: styleTable.toRawCss(), id: "idea-server-styles" },
			],
		);

		// Parts for the in-place update. The roster is built in the webview, so the payload ships the
		// data rather than markup. JSON.stringify over a deterministically built payload is
		// byte-identical for identical input, so an unchanged edit hashes equal and the
		// LoaderPreview skips.
		return {
			html: fullHtml,
			update: { styleCss: styleTable.toRawCss(), data: { ideaPreview } },
		};
	} catch (e) {
		const baseContent = `${localize("error", "Error")}: <br/>  <pre>${htmlEscape(forceError(e).toString())}</pre>`;
		return html(webview, baseContent, [previewedFileUriScript(uri)], []);
	}
}

function renderShell(styleTable: StyleTable): string {
	return `
        <div id="ideapreviewcontent" class="${styleTable.style(
					"ideapreviewcontent",
					() => `
            position: relative;
            top: ${toolbarHeight}px;
        `,
				)}"></div>
        ${renderToolBar(styleTable)}
    `;
}

// The toolbar lives outside #ideapreviewcontent so its listeners are bound once and an in-place
// update never rebinds them. Modelled on the event preview's toolbar.
//
// Every control is always rendered, including the ones a given file cannot use: which of them are
// shown is decided in the webview from IdeaPreviewPayload.toolbarFlags. Deciding it here would put
// the answer in the baked-in shell, where the only way to apply a change is to reassign the whole
// html -- a page teardown, losing scroll, on every flip.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("ideaToggleLabel", () => `margin-right:5px`);

	// The <input> is hidden and replaced by a codicon checkbox as soon as the webview loads, so it
	// carries no spacing: the gap between two toggles is on .checkbox-container-out.
	const toggle = (id: string, text: string) => `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}">`;

	// Leftmost, because the toolbar strip scrolls horizontally in a narrow pane and search is the
	// one control that has to stay reachable without scrolling it.
	const search = `
        <label for="idea-searchbox" class="${labelStyle}">${localize("ideapreview.search", "Search: ")}</label>
        <input id="idea-searchbox" type="text" />
        <span id="idea-search-count" class="idea-search-count"></span>`;

	// One multi-select rather than one checkbox per kind: every entry answers the same question --
	// which ideas belong in the roster -- and separate controls narrowing the same list would leave
	// the reader with no single place to read the answer off. Selecting nothing shows everything;
	// selecting several is an OR.
	const filterOption = (value: string, text: string) =>
		`<div class="option" value="${value}">${text}</div>`;
	const filters = `
        <div id="idea-filter-container">
            <label for="idea-filters" class="${labelStyle}">${localize("ideapreview.filters", "Filters: ")}</label>
            <div class="select-container ${styleTable.style("marginRight10", () => `margin-right:10px`)}">
                <div id="idea-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    ${filterOption("laws", localize("ideapreview.filterlaws", "Laws"))}
                    ${filterOption("default", localize("ideapreview.filterdefault", "Starting idea"))}
                    ${filterOption("modifiers", localize("ideapreview.filtermodifiers", "Has modifiers"))}
                    ${filterOption("research", localize("ideapreview.filterresearch", "Has research bonus"))}
                    ${filterOption("conditions", localize("ideapreview.filterconditions", "Has conditions"))}
                    ${filterOption("chains", localize("ideapreview.filterchains", "In an idea chain"))}
                </div>
            </div>
        </div>`;

	const toggles = [
		toggle("show-localisation", localize("ideapreview.showlocalisation", "Show localisation")),
		toggle("show-icon", localize("ideapreview.showicon", "Show icon")),
		toggle("show-modifiers", localize("ideapreview.showmodifiers", "Show modifiers")),
		toggle("show-description", localize("ideapreview.showdescription", "Show description")),
		toggle("show-conditions", localize("ideapreview.showconditions", "Show conditions")),
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
