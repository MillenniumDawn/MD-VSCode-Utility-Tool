import { StyleTable } from '../styletable';
import type { Image } from '../image/imagecache';
import { GridBoxConnection, GridBoxItem } from './gridboxcommon';

/**
 * The mutually exclusive link between two nodes of a grid box tree, drawn with the game's own
 * textures instead of a flat red border. Shared by the focus tree and the MIO trait tree, which the
 * game itself draws from the same sprites: `national_focus_exclusive_item` in nationalfocusview.gui
 * and `industrial_organisation_mutually_exclusive_item` in industrial_organization_detail.gui
 * declare the same `GFX_focus_exclusive_line1` strip and the same three `GFX_focus_link_exclusive`
 * frames.
 *
 * The textures are DDS files that have to be decoded and inlined as base64 data URIs, which only
 * the extension host can do. The connections, however, are rendered in the webview
 * (`renderGridBoxCommon` runs there, synchronously), so the webview can only attach a class name
 * and the CSS behind it must be registered on the host. That is the same split `warningstyles.ts`
 * uses, and the class name is likewise a shared constant so the two sides cannot drift apart.
 *
 * This module is imported by the webview bundle, which cannot resolve `vscode`, so it must stay
 * free of extension host imports -- `loadExclusiveLinkImages` in `exclusivelinkimages.ts` does the
 * sprite resolving and hands the result in.
 */
export const exclusiveLinkClass = 'st-focus-exclusive-link';

export interface ExclusiveLinkImages {
    line: Image;
    left: Image;
    mid: Image;
    right: Image;
}

/**
 * A connection element spans node centre to node centre, while the game sizes its exclusive marker
 * from box edge to box edge. Insetting the icons by half a slot minus half an icon lands them on
 * the box edges, and starting the line half an icon further in reproduces the gui, which places
 * `link1` at x=16 against a 32px wide icon drawn at x=0.
 *
 * Exported for the tests, which pin the numbers this produces for the focus tree (96px slot) and
 * the MIO tree (87px slot).
 */
export function exclusiveLinkInsets(slotWidth: number, iconWidth: number): { iconInset: number; lineInset: number } {
    const iconInset = slotWidth / 2 - iconWidth / 2;
    return { iconInset, lineInset: iconInset + iconWidth / 2 };
}

/**
 * Registers the CSS behind `exclusiveLinkClass`. The class is attached to the 1px connection element
 * the grid box emits; both painted layers are pseudo elements positioned against it, which keeps
 * them out of a specificity fight with the per-connection rule that sizes that element.
 *
 * Pass undefined for `images` to get the previous plain red line, which is what the focus tree's
 * structure only render pass and an unresolvable install path both need.
 *
 * Both branches declare the *same* set of properties, deliberately. The focus tree renders in two
 * passes with a StyleTable each, and both end up in the same page in their own <style> element (the
 * structure pass in <head>, the texture pass in #ft-progressive-icons at the top of <body>).
 * StyleTable.raw only de-duplicates within one table, so both rules live in the document and the
 * cascade resolves them property by property. A property declared by only one branch is therefore
 * not overridden but blended in -- which is exactly how the red border used to survive underneath
 * the textures it was replaced by.
 */
export function registerExclusiveLinkStyles(
    styleTable: StyleTable,
    images: ExclusiveLinkImages | undefined,
    slotWidth: number,
): void {
    // Both layers are taller than the 1px connection element they hang off, on purpose.
    styleTable.style('focus-exclusive-link', () => `
        overflow: visible;
    `);

    if (images === undefined) {
        styleTable.raw(`.${exclusiveLinkClass}::before`, `
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            height: 0;
            border-top: 1px solid red;
            background-image: none;
        `);
        styleTable.raw(`.${exclusiveLinkClass}::after`, `
            content: none;
            background-image: none;
        `);
        return;
    }

    const { line, left, mid, right } = images;
    const { iconInset, lineInset } = exclusiveLinkInsets(slotWidth, left.width);

    styleTable.raw(`.${exclusiveLinkClass}::before`, `
        content: '';
        position: absolute;
        left: ${lineInset}px;
        right: ${lineInset}px;
        top: ${-line.height / 2}px;
        height: ${line.height}px;
        border-top: none;
        background-image: url(${line.uri});
        background-repeat: repeat-x;
        background-position: left center;
        background-size: ${line.width}px ${line.height}px;
    `);

    // The three icons ride on one element as three background layers: left arrow, mid icon, right
    // arrow, in the same order the game's gui declares them.
    styleTable.raw(`.${exclusiveLinkClass}::after`, `
        content: '';
        position: absolute;
        left: ${iconInset}px;
        right: ${iconInset}px;
        top: ${-left.height / 2}px;
        height: ${left.height}px;
        background-image: url(${left.uri}), url(${mid.uri}), url(${right.uri});
        background-repeat: no-repeat, no-repeat, no-repeat;
        background-position: left center, center center, right center;
        background-size: ${left.width}px ${left.height}px, ${mid.width}px ${mid.height}px, ${right.width}px ${right.height}px;
    `);
}

/**
 * Swaps the plain line of a mutually exclusive link for the game's own textures, but only when both
 * nodes share a row. Any other pair takes renderGridBoxConnection's L-shaped corner path, which
 * draws borders on two edges of a tall box, where a horizontal texture would be wrong -- and for the
 * focus tree the schema already warns about such a pair. Deciding this here instead of while the
 * items are built is what makes the target's row known: resolving it there would mean positioning
 * nodes the branch filter has dropped, which would shift the tree's left padding.
 *
 * Runs in the webview, on the items about to go into `renderGridBoxCommon`.
 */
export function applyExclusiveLinkStyle(items: GridBoxItem[]): void {
    const rowById: Record<string, number> = {};
    for (const item of items) {
        rowById[item.id] = item.gridY;
    }

    const drawn: Record<string, true> = {};
    for (const item of items) {
        const kept: GridBoxConnection[] = [];
        for (const conn of item.connections) {
            if (conn.targetType !== 'related' || rowById[conn.target] !== item.gridY) {
                kept.push(conn);
                continue;
            }

            // Both nodes of a pair push a connection to the other, so the link is drawn twice on
            // top of itself. That is invisible for a 1px border but double composites the
            // semi-transparent textures; both connections carry the same set of branch classes, so
            // dropping either one of them is safe.
            const key = item.id < conn.target
                ? item.id + ' ' + conn.target
                : conn.target + ' ' + item.id;
            if (drawn[key]) {
                continue;
            }
            drawn[key] = true;

            conn.style = 'none';
            conn.classNames = (conn.classNames ?? '') + ' ' + exclusiveLinkClass;
            kept.push(conn);
        }
        item.connections = kept;
    }
}
