import { StyleTable } from "../util/styletable";
import { registerWarningStyles, warningListClass } from "../util/hoi4gui/warningstyles";
import { Localizer, iconButtonHtml } from "./toolbaricons";

export const TOOLBAR_HEIGHT = 52;

export function renderPreviewShell(styleTable: StyleTable, contentId: string, toolbar: () => string, dragger = false): string {
	const drag = dragger ? `
        <div id="dragger" class="${styleTable.style("dragger", () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>` : "";
	return `${drag}
        <div id="${contentId}" class="${styleTable.style(contentId, () => `
            position: relative;
            top: ${TOOLBAR_HEIGHT}px;
        `)}"></div>
        ${toolbar()}
    `;
}

export function toolbarWrapper(styleTable: StyleTable, content: () => string): string {
	return `<div class="toolbar-outer ${styleTable.style("toolbar-height", () => `box-sizing: border-box; height: ${TOOLBAR_HEIGHT}px;`)}">
        <div class="toolbar">
            ${content()}
        </div>
    </div>`;
}

export function toggleHtml(labelStyle: string, id: string, text: string): string {
	return `
        <label for="${id}" class="${labelStyle}">${text}</label>
        <input type="checkbox" id="${id}">`;
}

export function searchHtml(labelStyle: string, prefix: string, text: string): string {
	return `
        <label for="${prefix}-searchbox" class="${labelStyle}">${text}</label>
        <input id="${prefix}-searchbox" type="text" />
        <span id="${prefix}-search-count" class="${prefix}-search-count"></span>`;
}

export function filterOption(value: string, text: string, glyph?: string): string {
	return `<div class="option" value="${value}"${glyph === undefined ? "" : ` data-glyph="${glyph}"`}>${text}</div>`;
}

export function filterSelectHtml(styleTable: StyleTable, labelStyle: string, prefix: string, text: string, options: string[]): string {
	return `
        <div id="${prefix}-filter-container">
            <label for="${prefix}-filters" class="${labelStyle}">${text}</label>
            <div class="select-container ${styleTable.style("marginRight10", () => `margin-right:10px`)}">
                <div id="${prefix}-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    ${options.join("\n                    ")}
                </div>
            </div>
        </div>`;
}

// The warnings panel a tree preview opens from its toolbar, over the whole tree; the webview fills
// #warnings. The marker and list rules go into the same shell stylesheet, which is serialized once
// before any render, so the webview can attach them to freshly rendered nodes. See warningstyles.ts.
export function warningPanelHtml(styleTable: StyleTable): string {
	registerWarningStyles(styleTable);
	return `
    <div id="warnings-container" class="${styleTable.style("warnings-container", () => `
        height: 100vh;
        width: 100vw;
        position: fixed;
        top: 0;
        left: 0;
        padding-top: ${TOOLBAR_HEIGHT}px;
        background: var(--vscode-editor-background);
        box-sizing: border-box;
        display: none;
    `)}">
        <div id="warnings" class="${warningListClass}"></div>
    </div>`;
}

// Shown by the webview only while a prerequisite trace is active, so there is always a visible
// way out of the dimmed view. Hidden through an inline display rather than the `hidden`
// attribute: the class below sets a display of its own, which would win over `[hidden]`.
export function traceStatusHtml(styleTable: StyleTable, localize: Localizer): string {
	return `
        <div id="trace-status-container" style="display:none" class="${styleTable.style("traceStatusContainer", () => `margin-left:10px; align-items:center;`)}">
            <span id="trace-status" class="${styleTable.style("traceStatus", () => `margin-right:5px; opacity:0.8;`)}"></span>
            ${iconButtonHtml("clearTrace", localize, { domId: "clear-trace" })}
        </div>`;
}
