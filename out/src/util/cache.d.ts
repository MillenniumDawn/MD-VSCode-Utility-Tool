export interface CacheOptions<V> {
    factory(key: string): V;
    expireWhenChange?(key: string, cachedValue: V): any;
    life: number;
    nonExpireLife?: number;
}
export interface PromiseCacheOptions<V> extends CacheOptions<Promise<V>> {
    expireWhenChange?(key: string, cachedValue: Promise<V>): Promise<any> | any;
}
interface CacheEntry<V> {
    value: V;
    expiryToken: any;
    lastAccess: number;
}
export declare class Cache<V> {
    protected readonly options: CacheOptions<V>;
    protected _cache: Record<string, CacheEntry<V>>;
    private _intervalToken;
    constructor(options: CacheOptions<V>);
    get(key?: string): V;
    remove(key?: string): void;
    clear(): void;
    dispose(): void;
    private tryClean;
}
export declare class PromiseCache<V> extends Cache<Promise<V>> {
    constructor(options: PromiseCacheOptions<V>);
    get(key?: string): Promise<V>;
}
export {};
