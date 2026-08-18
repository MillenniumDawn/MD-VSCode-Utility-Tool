import { StyleTable } from '../../util/styletable';
import type { Image } from '../../util/image/imagecache';

/**
 * The mutually exclusive link between two focuses, drawn with the game's own textures instead of
 * a flat red border.
 *
 * The textures are DDS files that have to be decoded and inlined as base64 data URIs, which only
 * the extension host can do. The focus tree's connections, however, are rendered in the webview
 * (`renderGridBoxCommon` runs there, synchronously), so the webview can only attach a class name
 * and the CSS behind it must be registered here. That is the same split `warningstyles.ts` uses,
 * and the class name is likewise a shared constant so the two sides cannot drift apart.
 *
 * This module is imported by the webview bundle, which cannot resolve `vscode`, so it must stay
 * free of extension host imports -- `loadExclusiveLinkImages` in the content builder does the
 * sprite resolving and hands the result in.
 */
export const exclusiveLinkClass = 'st-focus-exclusive-link';

// A connection element spans focus centre to focus centre, while the game sizes its exclusive
// marker from focus box edge to focus box edge. With a 96px grid slot, insetting the icons by half
// a slot minus half an icon lands them on the box edges, and starting the line half an icon further
// in reproduces the gui, which places `link1` at x=16 against an icon drawn at x=0.
const iconInset = 32;
const lineInset = iconInset + 16;

export interface ExclusiveLinkImages {
    line: Image;
    left: Image;
    mid: Image;
    right: Image;
}

/**
 * Registers the CSS behind `exclusiveLinkClass`. The class is attached to the 1px connection element
 * the grid box emits; both painted layers are pseudo elements positioned against it, which keeps
 * them out of a specificity fight with the per-connection rule that sizes that element.
 *
 * Pass undefined for `images` to get the previous plain red line, which is what the structure only
 * render pass and an unresolvable install path both need.
 */
export function registerExclusiveLinkStyles(styleTable: StyleTable, images: ExclusiveLinkImages | undefined): void {
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
            border-top: 1px solid red;
        `);
        styleTable.raw(`.${exclusiveLinkClass}::after`, `
            content: none;
        `);
        return;
    }

    const { line, left, mid, right } = images;

    styleTable.raw(`.${exclusiveLinkClass}::before`, `
        content: '';
        position: absolute;
        left: ${lineInset}px;
        right: ${lineInset}px;
        top: ${-line.height / 2}px;
        height: ${line.height}px;
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
