import { StyleTable } from '../styletable';

/**
 * Class names shared between a grid box tree's content builder (which emits the CSS into the shell
 * stylesheet) and its webview (which attaches the classes to rendered connections). Used by the
 * focus tree and the MIO trait tree.
 *
 * Same ordering constraint as warningstyles.ts: `StyleTable.toStyleElement` snapshots its records
 * at call time, so anything registered after the tree's placeholder has been filled never reaches
 * the page. These live in the shell, emitted once before any render.
 */
export const traceLineClass = 'st-ft-trace-line';
export const traceDimClass = 'st-ft-trace-dim';

// `placeholderId` is the element the tree is rendered into, which scopes every rule.
export function registerTraceStyles(styleTable: StyleTable, placeholderId: string): void {
    const scope = '#' + placeholderId;
    // Emitted through `raw` with an id prefix rather than as plain classes, because the line's
    // border class (`.st-gridbox-connection-...`, carrying `border-top: 1px solid #88aaff`) is
    // serialized into the body *after* the shell stylesheet and would win a same-specificity tie
    // on document order. An id selector wins on specificity instead, which beats reaching for
    // !important. That border has to stay a class for the same reason: an inline style would beat
    // any selector, so the connection keeps only its geometry in its style attribute.
    //
    // The z-index is not optional: connections are emitted before the item divs, and a focus node's
    // own layers go up to z-index 3, so without it the traced line stays hidden behind the nodes it
    // connects. 5 keeps it below the warning marker box at 6.
    styleTable.raw(`${scope} .${traceLineClass}`, `
        border-color: #ffcc44;
        z-index: 5;
    `);

    // A prerequisite line is drawn as tiles: a texture, which no border colour reaches, or a plain
    // line on their pseudo elements, which the rule above does not select.
    styleTable.raw(`${scope} .${traceLineClass}::before, ${scope} .${traceLineClass}::after`, `
        border-color: #ffcc44;
    `);
    styleTable.raw(`${scope} .${traceLineClass}[class*="st-focus-link-"]`, `
        filter: drop-shadow(0 0 2px #ffcc44) brightness(1.4);
    `);

    styleTable.raw(`${scope} .${traceDimClass}`, `
        opacity: 0.1;
    `);
}
