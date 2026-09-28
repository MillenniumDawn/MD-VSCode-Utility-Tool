import { convertNodeToJson, SchemaDef } from "../../hoiformat/schema";
import { getSpriteByGfxName, Image } from "../../util/image/imagecache";
import { getDescriptorFocusOverlayGfx, parseHoi4FileCached } from "../../util/fileloader";
import { resolveConfiguredGfxFiles } from "../../util/configuredgfxfiles";
import { nationalFocusViewGfxFile } from "../../util/hoi4gui/exclusivelinkimages";
import { describeParseFailure } from "../../util/indexHalf";
import { Logger } from "../../util/logger";
import { getConfiguration } from "../../util/vsccommon";

export const focusTitlebarStylesFile = 'common/national_focus/00_titlebar_styles.txt';
// Where the game defines its own focus overlays. A mod's overlay files are named by the
// focusOverlayGfxFiles setting or the focus_overlay_gfx list in its descriptor, never in code.
export const vanillaFocusOverlayGfxFile = 'interface/goals.gfx';
const focusOverlaySetting = 'mdHoi4Utilities.focusOverlayGfxFiles';

// Declared with the exclusive link sprites, which the MIO preview also reads, so both previews name
// the file once. Re-exported here because the focus tree's loader and content builder have always
// taken it from this module.
export { nationalFocusViewGfxFile };

interface TitlebarStyleDef {
    name: string;
    available: string;
}

interface TitlebarStyleFile {
    style: TitlebarStyleDef[];
}

const titlebarStyleSchema: SchemaDef<TitlebarStyleDef> = {
    name: "string",
    available: "string",
};

const titlebarStyleFileSchema: SchemaDef<TitlebarStyleFile> = {
    style: {
        _innerType: titlebarStyleSchema,
        _type: 'array',
    },
};

export async function loadFocusTitlebarStyles(): Promise<Record<string, string>> {
    try {
        const node = await parseHoi4FileCached(focusTitlebarStylesFile);
        const file = convertNodeToJson<TitlebarStyleFile>(node, titlebarStyleFileSchema);
        const result: Record<string, string> = {};

        for (const style of file.style) {
            if (style?.name && style.available) {
                result[style.name] = style.available;
            }
        }

        return result;
    } catch (e) {
        Logger.error(`Cannot read ${focusTitlebarStylesFile}; focus text icons are disabled: ${describeParseFailure(e)}`);
        return {};
    }
}

export async function getFocusTitlebarImage(textIcon: string | undefined, titlebarStyles: Record<string, string>): Promise<Image | undefined> {
    if (!textIcon) {
        return undefined;
    }

    const gfxName = titlebarStyles[textIcon];
    if (!gfxName) {
        return undefined;
    }

    const sprite = await getSpriteByGfxName(gfxName, nationalFocusViewGfxFile);
    return sprite?.image;
}

/**
 * The .gfx files focus overlays are looked up in, in order: the game's interface/goals.gfx, then
 * what the setting names, then what the working mod's (and its parent mods') descriptors name.
 */
export async function getFocusOverlayGfxFiles(): Promise<string[]> {
    return resolveConfiguredGfxFiles(vanillaFocusOverlayGfxFile, [
        ...(getConfiguration().focusOverlayGfxFiles ?? []).map(entry => ({ entry, source: focusOverlaySetting })),
        ...(await getDescriptorFocusOverlayGfx()).map(entry => ({ entry, source: 'focus_overlay_gfx in the .mod file' })),
    ]);
}

export async function getFocusOverlayImage(overlay: string | undefined, overlayGfxFiles: string[]): Promise<Image | undefined> {
    if (!overlay) {
        return undefined;
    }

    const sprite = await getSpriteByGfxName(overlay, overlayGfxFiles);
    return sprite?.image;
}
