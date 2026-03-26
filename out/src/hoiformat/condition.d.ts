import { NodeValue } from "./hoiparser";
import { Scope } from "./scope";
export type ConditionFolderType = 'and' | 'or' | 'ornot' | 'andnot';
export type ConditionComplexExpr = ConditionFolder | ConditionAmountFolder | ConditionItem | boolean;
export interface ConditionItem {
    scopeName: string;
    nodeContent: string;
}
export interface ConditionFolder {
    type: ConditionFolderType;
    items: ConditionComplexExpr[];
}
export interface ConditionAmountFolder {
    type: 'count';
    amount: number;
    items: ConditionComplexExpr[];
}
export interface ConditionValue {
    condition: ConditionComplexExpr;
    exprs: ConditionItem[];
}
export declare function extractConditionValue(nodeValue: NodeValue, scope: Scope, exprs?: ConditionItem[]): ConditionValue;
export declare function extractConditionValues(nodeValue: NodeValue[], scope: Scope, exprs?: ConditionItem[]): ConditionValue;
export declare function extractConditionFolder(nodeValue: NodeValue, scopeStack: Scope[], type?: ConditionFolderType | 'count', excludedKeys?: string[] | undefined, amount?: number): ConditionFolder | ConditionAmountFolder;
export declare function applyCondition(condition: ConditionComplexExpr, trueExprs: ConditionItem[]): boolean;
export declare function simplifyCondition(condition: ConditionComplexExpr): ConditionComplexExpr;
export declare function extractConditionalExprs(condition: ConditionComplexExpr, result?: ConditionItem[]): ConditionItem[];
export declare function conditionToString(condition: ConditionComplexExpr): string;
