import * as vscode from "vscode";
import { CharactersLoader } from "./loader";
import { LoaderSession } from "../../util/loader/loader";
import { debug } from "../../util/debug";
import { html, previewedFileUriScript, errorPage } from "../../util/html";
import { localize, i18nTableAsScript } from "../../util/i18n";
import { StyleTable } from "../../util/styletable";
import { jsonForScript } from "../../util/common";
import { buildCharacterPreviewPayload } from "./build";
import { LoaderRender } from "../loaderpreview";

// Height of the fixed toolbar strip. The roster is offset by it so it never renders underneath.
// webviewsrc/characterpreview.ts and resource/characterpreview.css carry the same constant -- the
// three must move together.
const toolbarHeight = 52;

export async function renderCharacterFile(
	loader: CharactersLoader,
	uri: vscode.Uri,
	webview: vscode.Webview,
): Promise<LoaderRender> {
	try {
		const session = new LoaderSession(false);
		const loadResult = await loader.load(session);
		debug("Loader session character preview", session.loadedLoaderNames());

		const styleTable = new StyleTable();
		const characterPreview = await buildCharacterPreviewPayload(
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
				{ content: `window.characterPreview = ${jsonForScript(characterPreview)};` },
				{ content: i18nTableAsScript() },
				"common.js",
				"characterpreview.js",
			],
			[
				"codicon.css",
				// The shared widget stylesheet: .toolbar-outer, .toolbar and the codicon checkbox the
				// toggles are upgraded into.
				"common.css",
				// The card primitives, shared with the event and idea previews so a character card
				// and an idea card are the same object.
				"hoicard.css",
				"characterpreview.css",
				// Addressable id so an in-place updateBody can refresh the server StyleTable -- which
				// holds the portraits -- by mutating this <style>.textContent instead of forcing a
				// full reload.
				{ content: styleTable.toRawCss(), id: "character-server-styles" },
			],
		);

		// Parts for the in-place update. The roster is built in the webview, so the payload ships the
		// data rather than markup. JSON.stringify over a deterministically built payload is
		// byte-identical for identical input, so an unchanged edit hashes equal and the
		// LoaderPreview skips.
		return {
			html: fullHtml,
			update: { styleCss: styleTable.toRawCss(), data: { characterPreview } },
		};
	} catch (e) {
		return errorPage(webview, uri, e);
	}
}

function renderShell(styleTable: StyleTable): string {
	return `
        <div id="characterpreviewcontent" class="${styleTable.style(
					"characterpreviewcontent",
					() => `
            position: relative;
            top: ${toolbarHeight}px;
        `,
				)}"></div>
        ${renderToolBar(styleTable)}
    `;
}

// The toolbar lives outside #characterpreviewcontent so its listeners are bound once and an
// in-place update never rebinds them. Modelled on the idea preview's toolbar.
//
// Every control is always rendered, including the ones a given file cannot use: which of them are
// shown is decided in the webview from CharacterPreviewPayload.toolbarFlags. Deciding it here would
// put the answer in the baked-in shell, where the only way to apply a change is to reassign the
// whole html -- a page teardown, losing scroll, on every flip.
function renderToolBar(styleTable: StyleTable): string {
	const labelStyle = styleTable.style("charToggleLabel", () => `margin-right:5px`);

	// The <input> is hidden and replaced by a codicon checkbox as soon as the webview loads, so it
	// carries no spacing: the gap between two toggles is on .checkbox-container-out.
	const toggle = (id: string, text: string) => `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}">`;

	// Leftmost, because the toolbar strip scrolls horizontally in a narrow pane and search is the
	// one control that has to stay reachable without scrolling it.
	const search = `
        <label for="character-searchbox" class="${labelStyle}">${localize("characterpreview.search", "Search: ")}</label>
        <input id="character-searchbox" type="text" />
        <span id="character-search-count" class="character-search-count"></span>`;

	// One multi-select rather than one checkbox per kind: every entry answers the same question --
	// which characters belong in the roster -- and separate controls narrowing the same list would
	// leave the reader with no single place to read the answer off. Selecting nothing shows
	// everything; selecting several is an OR.
	const filterOption = (value: string, text: string) =>
		`<div class="option" value="${value}">${text}</div>`;
	const filters = `
        <div id="character-filter-container">
            <label for="character-filters" class="${labelStyle}">${localize("characterpreview.filters", "Filters: ")}</label>
            <div class="select-container ${styleTable.style("marginRight10", () => `margin-right:10px`)}">
                <div id="character-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    ${filterOption("multirole", localize("characterpreview.filtermultirole", "Has several roles"))}
                    ${filterOption("unknowntrait", localize("characterpreview.filterunknowntrait", "Has unknown trait"))}
                    ${filterOption("noportrait", localize("characterpreview.filternoportrait", "Portrait not found"))}
                    ${filterOption("traits", localize("characterpreview.filtertraits", "Has traits"))}
                    ${filterOption("conditions", localize("characterpreview.filterconditions", "Has conditions"))}
                </div>
            </div>
        </div>`;

	const toggles = [
		toggle("show-localisation", localize("characterpreview.showlocalisation", "Show localisation")),
		toggle("show-portrait", localize("characterpreview.showportrait", "Show portrait")),
		toggle("show-skills", localize("characterpreview.showskills", "Show skills")),
		toggle("expand-traits", localize("characterpreview.expandtraits", "Expand traits")),
		toggle("show-description", localize("characterpreview.showdescription", "Show description")),
		toggle("show-conditions", localize("characterpreview.showconditions", "Show conditions")),
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
