import { StyleTable } from '../../util/styletable';

/**
 * Class names shared between the focus tree content builder (which emits the CSS into the shell
 * stylesheet) and the focus tree webview (which attaches the classes to rendered connections).
 *
 * Same ordering constraint as warningstyles.ts: `StyleTable.toStyleElement` snapshots its records
 * at call time, so anything registered after `#focustreeplaceholder` has been filled never reaches
 * the page. These live in the shell, emitted once before any render.
 */
export const traceLineClass = 'st-ft-trace-line';
export const traceDimClass = 'st-ft-trace-dim';

export function registerTraceStyles(styleTable: StyleTable): void {
    // Emitted through `raw` with an id prefix rather than as plain classes, because the per-line
    // geometry class (`.st-gridbox-connection-N`, carrying `border-top: 1px solid #88aaff`) is
    // serialized into the body *after* the shell stylesheet and would win a same-specificity tie
    // on document order. An id selector wins on specificity instead, which beats reaching for
    // !important.
    //
    // The z-index is not optional: connections are emitted before the item divs, and a focus node's
    // own layers go up to z-index 3, so without it the traced line stays hidden behind the nodes it
    // connects. 5 keeps it below the warning marker box at 6.
    styleTable.raw(`#focustreeplaceholder .${traceLineClass}`, `
        border-color: #ffcc44;
        z-index: 5;
    `);

    styleTable.raw(`#focustreeplaceholder .${traceDimClass}`, `
        opacity: 0.1;
    `);
}
