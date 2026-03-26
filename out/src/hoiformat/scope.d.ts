import { Node } from "./hoiparser";
export type ScopeType = 'country' | 'state' | 'leader' | 'operative' | 'division' | 'character' | 'mio' | 'purchaseContract' | 'unknown';
export interface Scope {
    scopeName: string;
    scopeType: ScopeType;
}
export interface ScopeDef {
    name: string;
    from: ScopeType | '*';
    to: ScopeType;
    condition: boolean;
    effect: boolean;
}
export declare const countryScope: Scope;
export declare function tryMoveScope(node: Node, scopeStack: Scope[], type: 'condition' | 'effect'): boolean;
export declare const scopeDefs: Record<string, ScopeDef>;
