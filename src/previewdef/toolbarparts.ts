import { StyleTable } from "../util/styletable";

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
