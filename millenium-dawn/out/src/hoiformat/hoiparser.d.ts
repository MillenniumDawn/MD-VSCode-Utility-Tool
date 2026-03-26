export type NodeValue = string | number | Node[] | SymbolNode | null;
export interface Node {
    name: string | null;
    operator: string | null;
    value: NodeValue;
    valueAttachment: SymbolNode | null;
    valueAttachmentToken: Token | null;
    nameToken: Token | null;
    operatorToken: Token | null;
    valueStartToken: Token | null;
    valueEndToken: Token | null;
}
export interface SymbolNode {
    name: string;
}
export interface Token<T extends string = string> {
    value: string;
    start: number;
    end: number;
    type: T;
}
export declare function parseHoi4File(input: string, errorMessagePrefix?: string): Node;
