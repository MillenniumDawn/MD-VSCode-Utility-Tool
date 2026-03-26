import { Node, Token, NodeValue, SymbolNode } from "./hoiparser";
export interface TokenObject {
    _token: Token | undefined;
}
export interface CustomMap<T> extends TokenObject {
    _map: Record<string, {
        _key: string;
        _value: T;
    }>;
}
export interface Enum extends TokenObject {
    _values: string[];
}
export interface StringIgnoreCase<T extends string> extends TokenObject {
    _stringAsSymbolIgnoreCase: true;
    _name: T;
}
export interface NumberLike extends TokenObject {
    _value: number;
    _unit: NumberUnit | undefined;
}
export interface DetailValue<T> extends TokenObject {
    _attachment: string | undefined;
    _attachmentToken: Token | undefined;
    _operator: string | undefined;
    _operatorToken: Token | undefined;
    _startToken: Token | undefined;
    _endToken: Token | undefined;
    _value: T;
}
export interface Raw extends TokenObject {
    _raw: Node;
}
export type NumberUnit = '%' | '%%';
export type HOIPartial<T> = T extends Enum ? T : T extends undefined | string | number | StringIgnoreCase<string> | NumberLike | boolean | Raw ? T | undefined : T extends CustomMap<infer T1> ? CustomMap<HOIPartial<T1>> : T extends DetailValue<infer T1> ? DetailValue<HOIPartial<T1>> | undefined : T extends (infer T1)[] ? HOIPartial<HOIPartial<T1>>[] : {
    [K in keyof T]: T[K] extends Enum ? T[K] : T[K] extends CustomMap<infer T1> ? CustomMap<HOIPartial<T1>> : T[K] extends DetailValue<infer T1> ? DetailValue<HOIPartial<T1>> | undefined : T[K] extends (infer T1)[] ? HOIPartial<T1>[] : K extends ('_token' | '_index') ? T[K] | undefined : HOIPartial<T[K]> | undefined;
};
export type SchemaDef<T> = T extends boolean ? 'boolean' : T extends StringIgnoreCase<string> ? 'stringignorecase' : T extends string ? 'string' : T extends number ? 'number' : T extends NumberLike ? 'numberlike' : T extends Enum ? 'enum' : T extends Raw ? 'raw' : T extends CustomMap<infer T1> ? {
    _innerType: SchemaDef<T1>;
    _type: 'map';
} : T extends DetailValue<infer T1> ? {
    _innerType: SchemaDef<T1>;
    _type: 'detailvalue';
} : T extends (infer B)[] ? {
    _innerType: SchemaDef<B>;
    _type: 'array';
} : {
    [K in Exclude<keyof T, '_token' | '_index'>]: SchemaDef<T[K]>;
};
export interface Position {
    x: NumberLike;
    y: NumberLike;
}
export declare const positionSchema: SchemaDef<Position>;
export declare const variableRegex: RegExp;
export declare const variableRegexForScope: RegExp;
export declare function forEachNodeValue(node: Node, callback: (n: Node, index: number) => void): void;
export declare function isSymbolNode(value: NodeValue): value is SymbolNode;
export declare function convertNodeToJson<T>(node: Node, schemaDef: SchemaDef<T>, constants?: Record<string, NodeValue>): HOIPartial<T>;
export declare function toNumberLike(value: number): NumberLike;
export declare function parseNumberLike(value: string): NumberLike | undefined;
export declare function toStringAsSymbolIgnoreCase<T extends string>(value: T): StringIgnoreCase<T>;
