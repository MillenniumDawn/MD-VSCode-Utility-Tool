import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { Node, Token } from "../../hoiformat/hoiparser";
import { Warning } from "../../util/common";
export interface Mio {
    id: string;
    traits: Record<string, MioTrait>;
    conditionExprs: ConditionItem[];
    warnings: MioWarning[];
}
export interface MioWarning extends Warning<string> {
    navigations?: {
        file: string;
        start: number;
        end: number;
    }[];
}
export type TraitEffect = 'equiment' | 'production' | 'organization';
export interface MioTrait {
    id: string;
    name: string;
    icon: string | undefined;
    anyParent: string[];
    allParents: string[];
    exclusive: string[];
    parent: {
        traits: string[];
        numNeeded: number;
    } | undefined;
    x: number;
    y: number;
    relativePositionId: string | undefined;
    visible: ConditionComplexExpr;
    hasVisible: boolean;
    specialTraitBackground: boolean;
    effects: TraitEffect[];
    token: Token | undefined;
    file: string;
}
export declare function getMiosFromFile(node: Node, dependentMios: Mio[], filePath: string): Mio[];
