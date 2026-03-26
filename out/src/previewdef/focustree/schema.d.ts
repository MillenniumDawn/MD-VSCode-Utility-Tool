import { Node, Token } from "../../hoiformat/hoiparser";
import { HOIPartial, Position, Raw } from "../../hoiformat/schema";
import { ConditionItem, ConditionComplexExpr } from "../../hoiformat/condition";
import { Warning } from "../../util/common";
export interface FocusTree {
    id: string;
    focuses: Record<string, Focus>;
    inlayWindowRefs: FocusTreeInlayRef[];
    inlayWindows: FocusTreeInlay[];
    inlayConditionExprs: ConditionItem[];
    allowBranchOptions: string[];
    conditionExprs: ConditionItem[];
    isSharedFocues: boolean;
    continuousFocusPositionX?: number;
    continuousFocusPositionY?: number;
    warnings: FocusWarning[];
}
interface FocusIconWithCondition {
    icon: string | undefined;
    condition: ConditionComplexExpr;
}
export interface Focus {
    x: number;
    y: number;
    id: string;
    icon: FocusIconWithCondition[];
    textIcon?: string;
    overlay?: string;
    prerequisite: string[][];
    exclusive: string[];
    hasAllowBranch: boolean;
    inAllowBranch: string[];
    allowBranch: ConditionComplexExpr | undefined;
    relativePositionId: string | undefined;
    offset: Offset[];
    token: Token | undefined;
    file: string;
    text?: string;
}
export interface FocusWarning extends Warning<string> {
    navigations?: {
        file: string;
        start: number;
        end: number;
    }[];
}
export interface FocusTreeInlayRef {
    id: string;
    position: {
        x: number;
        y: number;
    };
    file: string;
    token: Token | undefined;
}
export interface FocusTreeInlay {
    id: string;
    file: string;
    token: Token | undefined;
    windowName?: string;
    internal: boolean;
    visible: ConditionComplexExpr;
    position: {
        x: number;
        y: number;
    };
    scriptedImages: FocusInlayImageSlot[];
    scriptedButtons: FocusTreeInlayButtonMeta[];
    conditionExprs: ConditionItem[];
}
export interface FocusInlayImageSlot {
    id: string;
    file: string;
    token: Token | undefined;
    gfxOptions: FocusInlayGfxOption[];
}
export interface FocusInlayGfxOption {
    gfxName: string;
    condition: ConditionComplexExpr;
    file: string;
    token: Token | undefined;
    gfxFile?: string;
}
export interface FocusTreeInlayButtonMeta {
    id: string;
    file: string;
    token: Token | undefined;
    available?: ConditionComplexExpr;
}
interface Offset {
    x: number;
    y: number;
    trigger: ConditionComplexExpr | undefined;
}
interface FocusTreeDef {
    id: string;
    shared_focus: string[];
    focus: FocusDef[];
    continuous_focus_position: Position;
    inlay_window: Raw[];
}
interface FocusDef {
    id: string;
    icon: Raw[];
    text_icon: string;
    overlay: string;
    x: number;
    y: number;
    prerequisite: FocusOrORList[];
    mutually_exclusive: FocusOrORList[];
    relative_position_id: string;
    allow_branch: Raw[];
    offset: OffsetDef[];
    _token: Token;
    text?: string;
}
interface OffsetDef {
    x: number;
    y: number;
    trigger: Raw[];
}
interface FocusOrORList {
    focus: string[];
    OR: string[];
}
interface FocusFile {
    focus_tree: FocusTreeDef[];
    shared_focus: FocusDef[];
    joint_focus: FocusDef[];
}
export declare function convertFocusFileNodeToJson(node: Node, constants: {}): HOIPartial<FocusFile>;
export declare function getFocusTreeWithFocusFile(file: HOIPartial<FocusFile>, sharedFocusTrees: FocusTree[], filePath: string, constants: {}): FocusTree[];
export declare function getFocusTree(node: Node, sharedFocusTrees: FocusTree[], filePath: string): FocusTree[];
export {};
