import { getSpriteByGfxName, Image } from '../image/imagecache';
import type { GridBoxTileShape } from './gridboxcommon';
import { defaultFocusLinkSprites, FocusLinkImages, FocusLinkSpriteSpec, focusLinkShapes } from './focuslink';
import { nationalFocusViewGfxFile } from './exclusivelinkimages';

/**
 * Resolves the solid and dashed frame of every prerequisite line tile. Returns undefined when any
 * of them cannot be resolved, so the caller keeps the plain line rather than drawing half a path in
 * textures.
 */
export async function loadFocusLinkImages(
    spec: FocusLinkSpriteSpec = defaultFocusLinkSprites,
    gfxFiles: string | string[] = nationalFocusViewGfxFile,
): Promise<FocusLinkImages | undefined> {
    const solid: Partial<Record<GridBoxTileShape, Image>> = {};
    const dashed: Partial<Record<GridBoxTileShape, Image>> = {};
    for (const shape of focusLinkShapes) {
        const sprite = await getSpriteByGfxName(spec.gfx[shape], gfxFiles);
        // A frame rather than the sprite, as for the exclusive link: the strip holds all four.
        const solidFrame = sprite?.frames[spec.frame];
        const dashedFrame = sprite?.frames[spec.dashedFrame];
        if (solidFrame === undefined || dashedFrame === undefined) {
            return undefined;
        }
        solid[shape] = solidFrame;
        dashed[shape] = dashedFrame;
    }

    return { solid, dashed } as FocusLinkImages;
}
