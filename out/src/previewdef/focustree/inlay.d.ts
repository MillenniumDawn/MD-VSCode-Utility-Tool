import { ConditionItem } from "../../hoiformat/condition";
import { Node } from "../../hoiformat/hoiparser";
import { FocusTreeInlay, FocusTreeInlayRef, FocusWarning } from "./schema";
interface ParsedInlayFile {
    inlays: FocusTreeInlay[];
    warnings: FocusWarning[];
}
export declare function loadFocusInlayWindows(): Promise<ParsedInlayFile>;
export declare function resolveInlaysForTree(refs: FocusTreeInlayRef[], allInlays: FocusTreeInlay[], sharedWarnings: FocusWarning[]): {
    inlayWindows: FocusTreeInlay[];
    inlayConditionExprs: ConditionItem[];
    warnings: FocusWarning[];
};
interface InlayGfxResolution {
    resolvedFiles: string[];
    gfxFileByName: Record<string, string | undefined>;
}
export declare function resolveInlayGfxFiles(inlays: FocusTreeInlay[]): Promise<InlayGfxResolution>;
export declare function addInlayGfxWarnings(inlays: FocusTreeInlay[], warnings: FocusWarning[]): void;
export declare function parseInlayWindowRef(node: Node, file: string): FocusTreeInlayRef | undefined;
export {};
