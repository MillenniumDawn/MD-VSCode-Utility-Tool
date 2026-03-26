import { Node, Token } from "../../hoiformat/hoiparser";
import { HOIPartial, Position, Raw } from "../../hoiformat/schema";
import { ConditionItem, ConditionComplexExpr } from "../../hoiformat/condition";
import { Warning } from "../../util/common";
export interface FocusTree {
    id: string;
    focuses: Record<string, Focus>;
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
}
interface FocusDef {
    id: string;
    icon: Raw[];
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
