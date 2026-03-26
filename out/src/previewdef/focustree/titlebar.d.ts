import { Image } from "../../util/image/imagecache";
export declare const focusTitlebarStylesFile = "common/national_focus/00_titlebar_styles.txt";
export declare const nationalFocusViewGfxFile = "interface/nationalfocusview.gfx";
export declare function loadFocusTitlebarStyles(): Promise<Record<string, string>>;
export declare function getFocusTitlebarImage(textIcon: string | undefined, titlebarStyles: Record<string, string>): Promise<Image | undefined>;
