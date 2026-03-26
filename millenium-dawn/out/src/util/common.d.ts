import { DebounceSettings } from 'lodash';
export interface NumberSize {
    width: number;
    height: number;
}
export interface NumberPosition {
    x: number;
    y: number;
}
export interface Warning<T> {
    text: string;
    source: T;
}
export declare function arrayToMap<T, K extends keyof T>(items: T[], key: K): T[K] extends string ? Record<string, T> : T[K] extends number ? Record<number, T> : never;
export declare function arrayToMap<T, K extends keyof T, V>(items: T[], key: K, valueSelector: (value: T) => V): T[K] extends string ? Record<string, V> : T[K] extends number ? Record<number, V> : never;
export declare function hsvToRgb(h: number, s: number, v: number): Record<'r' | 'g' | 'b', number>;
export declare function slice<T>(array: T[] | undefined, start: number, end: number): T[];
export declare function debounceByInput<TI extends any[], TO>(func: (...input: TI) => TO, keySelector: (...input: TI) => string, wait?: number, debounceSettings?: DebounceSettings): (...input: TI) => TO;
export declare function randomString(length: number, charset?: string | undefined): string;
export declare function clipNumber(value: number, min: number, max: number): number;
export declare class UserError extends Error {
    constructor(message: string);
}
export declare function forceError(e: unknown): Error;
