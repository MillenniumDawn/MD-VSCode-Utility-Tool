import { getSpriteByGfxName } from '../image/imagecache';
import { defaultExclusiveLinkSprites, ExclusiveLinkImages, ExclusiveLinkSpriteSpec } from './exclusivelink';

/**
 * Both sprites of the mutually exclusive link live in nationalfocusview.gfx, whichever tree draws
 * them: the MIO trait tree reuses the focus view's textures rather than shipping its own.
 */
export const nationalFocusViewGfxFile = 'interface/nationalfocusview.gfx';

/**
 * Resolves the four textures the mutually exclusive link is drawn from. Returns undefined when they
 * cannot be resolved -- no install path configured, or a mod that redeclares the sprites without
 * shipping a texture -- so the caller falls back to the plain line.
 *
 * The default sprites and frames are the ones `national_focus_exclusive_item` in
 * `nationalfocusview.gui` and `industrial_organisation_mutually_exclusive_item` in
 * `industrial_organization_detail.gui` use; the focus tree's gui layout can name others.
 */
export async function loadExclusiveLinkImages(
    spec: ExclusiveLinkSpriteSpec = defaultExclusiveLinkSprites,
    gfxFiles: string | string[] = nationalFocusViewGfxFile,
): Promise<ExclusiveLinkImages | undefined> {
    const lineSprite = await getSpriteByGfxName(spec.lineGfx, gfxFiles);
    const leftSprite = await getSpriteByGfxName(spec.leftGfx, gfxFiles);
    const midSprite = spec.midGfx === spec.leftGfx ? leftSprite : await getSpriteByGfxName(spec.midGfx, gfxFiles);
    const rightSprite = spec.rightGfx === spec.leftGfx ? leftSprite : await getSpriteByGfxName(spec.rightGfx, gfxFiles);
    if (lineSprite === undefined || leftSprite === undefined || midSprite === undefined || rightSprite === undefined) {
        return undefined;
    }

    // `frames` splits the strip horizontally. Taking a frame rather than the sprite also keeps the
    // line off the 9-slice path: it is declared as a corneredTileSpriteType but carries no
    // borderSize, so slicing it would cut the tile apart for nothing.
    const line = lineSprite.frames[spec.lineFrame];
    const left = leftSprite.frames[spec.leftFrame];
    const mid = midSprite.frames[spec.midFrame];
    const right = rightSprite.frames[spec.rightFrame];
    if (line === undefined || left === undefined || mid === undefined || right === undefined) {
        return undefined;
    }

    return { line, left, mid, right };
}
