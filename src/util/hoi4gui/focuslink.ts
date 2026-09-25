import { StyleTable } from '../styletable';
import type { Image } from '../image/imagecache';
import type { GridBoxTileShape } from './gridboxcommon';

/**
 * The prerequisite line of the focus tree, drawn the way the game draws it: 16x16 tiles from the
 * `GFX_focus_link_*` sprites that `national_focus_link` in nationalfocusview.gui declares, one
 * sprite per shape of tile.
 *
 * The same host/webview split as `exclusivelink.ts`: the grid box lays the tiles out in the
 * webview and tags each with a class from `focusLinkClass`, and the CSS behind those classes is
 * registered on the host, where the textures can be decoded. The webview draws the same tiles on
 * both render passes, so the class carries the whole difference: a thin line on the structure
 * pass, the textures once they are resolved.
 *
 * Imported by the webview bundle, so it stays free of extension host imports.
 */
export const focusLinkShapes: GridBoxTileShape[] = ['up_down', 'left_right', 'up_left', 'up_right', 'down_left', 'down_right'];

export function focusLinkClass(shape: GridBoxTileShape, dashed: boolean): string {
    return 'st-focus-link-' + shape.replace('_', '-') + (dashed ? '-dashed' : '');
}

/** The sprite of every tile shape and the 0 based frames of the solid and the dashed line. */
export interface FocusLinkSpriteSpec {
    gfx: Record<GridBoxTileShape, string>;
    frame: number;
    dashedFrame: number;
}

// Every strip holds four frames: solid, dashed, and both again in the completed colour. The gui's
// `frame = 1` is the first of them.
export const defaultFocusLinkSprites: FocusLinkSpriteSpec = {
    gfx: {
        up_down: 'GFX_focus_link_up_down',
        left_right: 'GFX_focus_link_left_right',
        up_left: 'GFX_focus_link_up_left',
        up_right: 'GFX_focus_link_up_right',
        down_left: 'GFX_focus_link_down_left',
        down_right: 'GFX_focus_link_down_right',
    },
    frame: 0,
    dashedFrame: 1,
};

export interface FocusLinkImages {
    solid: Record<GridBoxTileShape, Image>;
    dashed: Record<GridBoxTileShape, Image>;
}

const lineColor = '#88aaff';

function repeatOf(shape: GridBoxTileShape): string {
    return shape === 'up_down' ? 'repeat-y' : shape === 'left_right' ? 'repeat-x' : 'no-repeat';
}

// Where the plain line runs inside a tile: `::before` carries the vertical half, `::after` the
// horizontal one, each reaching the tile's centre from the side the shape names.
function verticalPart(shape: GridBoxTileShape): { top: string; bottom: string } | undefined {
    if (shape === 'left_right') {
        return undefined;
    }
    if (shape === 'up_down') {
        return { top: '0', bottom: '0' };
    }
    return shape.startsWith('up') ? { top: '0', bottom: '50%' } : { top: '50%', bottom: '0' };
}

function horizontalPart(shape: GridBoxTileShape): { left: string; right: string } | undefined {
    if (shape === 'up_down') {
        return undefined;
    }
    if (shape === 'left_right') {
        return { left: '0', right: '0' };
    }
    return shape.endsWith('left') ? { left: '0', right: '50%' } : { left: '50%', right: '0' };
}

/**
 * Registers the CSS behind every `focusLinkClass`. Pass undefined for `images` to get the plain
 * 1px line the preview has always drawn, which the structure only pass and an unresolvable install
 * path both need.
 *
 * As with the exclusive link, both branches declare the same properties on the tile and on both
 * pseudo elements: the two passes land in two <style> elements of one page, and a property only one
 * of them declared would survive underneath the other.
 */
export function registerFocusLinkStyles(styleTable: StyleTable, images: FocusLinkImages | undefined): void {
    for (const dashed of [false, true]) {
        for (const shape of focusLinkShapes) {
            const className = focusLinkClass(shape, dashed);
            const image = images ? (dashed ? images.dashed : images.solid)[shape] : undefined;
            const border = `1px ${dashed ? 'dashed' : 'solid'} ${lineColor}`;

            styleTable.raw(`.${className}`, image ? `
                background-image: url(${image.uri});
                background-repeat: ${repeatOf(shape)};
                background-position: center center;
                background-size: ${image.width}px ${image.height}px;
            ` : `
                background-image: none;
                background-repeat: repeat;
                background-position: 0 0;
                background-size: auto;
            `);

            const vertical = image ? undefined : verticalPart(shape);
            styleTable.raw(`.${className}::before`, vertical ? `
                content: '';
                position: absolute;
                left: 50%;
                top: ${vertical.top};
                bottom: ${vertical.bottom};
                border-left: ${border};
            ` : `
                content: none;
                position: static;
                left: auto;
                top: auto;
                bottom: auto;
                border-left: none;
            `);

            const horizontal = image ? undefined : horizontalPart(shape);
            styleTable.raw(`.${className}::after`, horizontal ? `
                content: '';
                position: absolute;
                top: 50%;
                left: ${horizontal.left};
                right: ${horizontal.right};
                border-top: ${border};
            ` : `
                content: none;
                position: static;
                top: auto;
                left: auto;
                right: auto;
                border-top: none;
            `);
        }
    }
}
