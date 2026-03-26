import { ConditionComplexExpr } from "./condition";
import { Node, NodeValue } from "./hoiparser";
import { Scope } from "./scope";
export type EffectComplexExpr = EffectItem | EffectByCondition | RandomListEffect | null;
export interface EffectItem {
    scopeName: string;
    nodeContent: string;
    node: Node;
}
export interface RandomListEffect {
    items: RandomListEffectItem[];
}
interface RandomListEffectItem {
    possibility: number;
    effect: EffectComplexExpr;
}
export interface EffectByCondition {
    condition: ConditionComplexExpr;
    items: EffectComplexExpr[];
}
export interface EffectValue {
    effect: EffectComplexExpr;
}
export declare function extractEffectValue(nodeValue: NodeValue, scope: Scope, excludedKeys?: string[] | undefined): EffectValue;
export {};
