import { parseHoi4File } from "../../hoiformat/hoiparser";
import { convertNodeToJson, SchemaDef } from "../../hoiformat/schema";
import { getSpriteByGfxName, Image } from "../../util/image/imagecache";
import { localize } from "../../util/i18n";
import { readFileFromModOrHOI4 } from "../../util/fileloader";

export const focusTitlebarStylesFile = 'common/national_focus/00_titlebar_styles.txt';
export const nationalFocusViewGfxFile = 'interface/nationalfocusview.gfx';
export const goalsOverlaysGfxFile = 'interface/goals_overlays.gfx';

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
        const [buffer, realPath] = await readFileFromModOrHOI4(focusTitlebarStylesFile);
        const node = parseHoi4File(buffer.toString(), localize('infile', 'In file {0}:\n', realPath));
        const file = convertNodeToJson<TitlebarStyleFile>(node, titlebarStyleFileSchema);
        const result: Record<string, string> = {};

        for (const style of file.style) {
            if (style?.name && style.available) {
                result[style.name] = style.available;
            }
        }

        return result;
    } catch {
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

export async function getFocusOverlayImage(overlay: string | undefined): Promise<Image | undefined> {
    if (!overlay) {
        return undefined;
    }

    const sprite = await getSpriteByGfxName(overlay, goalsOverlaysGfxFile);
    return sprite?.image;
}
