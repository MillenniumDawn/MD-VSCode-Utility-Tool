import { ConditionItem } from "../../hoiformat/condition";
import { Node } from "../../hoiformat/hoiparser";
import type { FocusTreeInlay, FocusTreeInlayRef, FocusWarning } from "./schema";
interface ParsedInlayFile {
    inlays: FocusTreeInlay[];
    warnings: FocusWarning[];
}
export declare function loadFocusInlayWindows(): Promise<ParsedInlayFile>;
export declare function resolveInlaysForTree(refs: FocusTreeInlayRef[], allInlays: FocusTreeInlay[]): {
    inlayWindows: FocusTreeInlay[];
    inlayConditionExprs: ConditionItem[];
    warnings: FocusWarning[];
};
interface InlayGfxResolution {
    resolvedFiles: string[];
}
export declare function resolveInlayGuiWindows(inlays: FocusTreeInlay[]): Promise<{
    guiFiles: string[];
    gfxFiles: string[];
    warnings: FocusWarning[];
}>;
export declare function resolveInlayGfxFiles(inlays: FocusTreeInlay[]): Promise<InlayGfxResolution>;
export declare function addInlayGfxWarnings(inlays: FocusTreeInlay[], warnings: FocusWarning[]): void;
export declare function parseInlayWindowRef(node: Node, file: string): FocusTreeInlayRef | undefined;
export {};
