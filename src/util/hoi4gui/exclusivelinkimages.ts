import { getSpriteByGfxName } from '../image/imagecache';
import { ExclusiveLinkImages } from './exclusivelink';

/**
 * Both sprites of the mutually exclusive link live in nationalfocusview.gfx, whichever tree draws
 * them: the MIO trait tree reuses the focus view's textures rather than shipping its own.
 */
export const nationalFocusViewGfxFile = 'interface/nationalfocusview.gfx';

// Sprite names and frames as `national_focus_exclusive_item` in `nationalfocusview.gui` and
// `industrial_organisation_mutually_exclusive_item` in `industrial_organization_detail.gui` use
// them. A `frame = 1` there is the first frame; the sprite frame array is 0 based.
const exclusiveLineGfxName = 'GFX_focus_exclusive_line1';
const exclusiveIconGfxName = 'GFX_focus_link_exclusive';
const exclusiveLineFrame = 0;
const exclusiveLeftIconFrame = 1;
const exclusiveMidIconFrame = 0;
const exclusiveRightIconFrame = 2;

/**
 * Resolves the four textures the mutually exclusive link is drawn from. Returns undefined when they
 * cannot be resolved -- no install path configured, or a mod that redeclares the sprites without
 * shipping a texture -- so the caller falls back to the plain line.
 */
export async function loadExclusiveLinkImages(): Promise<ExclusiveLinkImages | undefined> {
    const lineSprite = await getSpriteByGfxName(exclusiveLineGfxName, nationalFocusViewGfxFile);
    const iconSprite = await getSpriteByGfxName(exclusiveIconGfxName, nationalFocusViewGfxFile);
    if (lineSprite === undefined || iconSprite === undefined) {
        return undefined;
    }

    // `frames` splits the strip horizontally. Taking a frame rather than the sprite also keeps the
    // line off the 9-slice path: it is declared as a corneredTileSpriteType but carries no
    // borderSize, so slicing it would cut the tile apart for nothing.
    const line = lineSprite.frames[exclusiveLineFrame];
    const left = iconSprite.frames[exclusiveLeftIconFrame];
    const mid = iconSprite.frames[exclusiveMidIconFrame];
    const right = iconSprite.frames[exclusiveRightIconFrame];
    if (line === undefined || left === undefined || mid === undefined || right === undefined) {
        return undefined;
    }

    return { line, left, mid, right };
}
