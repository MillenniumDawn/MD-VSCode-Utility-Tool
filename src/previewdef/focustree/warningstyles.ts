import { StyleTable } from '../../util/styletable';

/**
 * Class names shared between the focus tree content builder (which emits the CSS into the shell
 * stylesheet) and the focus tree webview (which attaches the classes to rendered focuses).
 *
 * The rules deliberately live in the shell stylesheet rather than in the per-render StyleTable the
 * webview builds: `StyleTable.toStyleElement` snapshots its records at call time, so anything
 * registered after `#focustreeplaceholder` has been filled never reaches the page. Keeping them in
 * the shell -- emitted once, before any render -- makes that ordering trap impossible.
 *
 * `registerWarningStyles` derives the names through `StyleTable.name`, and a unit test asserts the
 * emitted rules match the constants below, so the two sides cannot drift apart.
 */
export const warningBoxClass = 'st-focus-warning-box';
export const warningBadgeClass = 'st-focus-warning-badge';
export const warningFlashClass = 'st-focus-warning-flash';
export const warningEntryClass = 'st-focus-warning-entry';
export const warningListClass = 'st-focus-warning-list';

export function registerWarningStyles(styleTable: StyleTable): void {
    // Marker box drawn as a child of the focus grid item, covering its whole slot. z-index beats
    // the focus node's own layers (titlebar 0, icon 1, overlay 2, checkbox and label 3), and
    // pointer-events:none keeps the click reaching the .navigator underneath so jump-to-definition
    // still works through the marker. Same treatment the MIO preview gives overlapping traits.
    styleTable.style('focus-warning-box', () => `
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        border: 2px solid #e33;
        background: rgba(255, 0, 0, 0.18);
        pointer-events: none;
        z-index: 6;
    `);

    styleTable.style('focus-warning-badge', () => `
        position: absolute;
        top: 1px;
        right: 3px;
        font-size: 10px;
        font-weight: bold;
        color: #fff;
        text-shadow: 0 0 3px #000;
        pointer-events: none;
        white-space: nowrap;
    `);

    // Short pulse applied to a focus jumped to from the warnings panel, so the eye catches where
    // the canvas scrolled to. Deliberately box-shadow rather than outline or background: `search`
    // writes `outlineWidth: 0` and `background: transparent` inline onto every non-matching focus
    // after each render, and inline styles would win over this rule.
    styleTable.style('focus-warning-flash', () => `
        box-shadow: 0 0 0 3px #ffb454, 0 0 12px 4px rgba(255, 180, 84, 0.6);
    `);

    styleTable.style('focus-warning-list', () => `
        height: 100%;
        width: 100%;
        overflow: auto;
        font-family: 'Consolas', monospace;
        background: var(--vscode-editor-background);
        padding: 10px;
        box-sizing: border-box;
    `);

    styleTable.style('focus-warning-entry', () => `
        display: block;
        width: 100%;
        text-align: left;
        cursor: pointer;
        padding: 3px 6px;
        border-left: 3px solid #e33;
        margin-bottom: 3px;
        white-space: pre-wrap;
        color: var(--vscode-editor-foreground);
        background: transparent;
    `);

    styleTable.style('focus-warning-entry', () => `
        background: var(--vscode-list-hoverBackground);
    `, ':hover');

    styleTable.style('focus-warning-entry', () => `
        outline: 1px solid var(--vscode-focusBorder);
    `, ':focus');
}
