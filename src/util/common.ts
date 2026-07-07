import { debounce, DebounceSettings } from 'lodash';

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

export function arrayToMap<T, K extends keyof T>(items: T[], key: K):
    T[K] extends string ? Record<string, T> : T[K] extends number ? Record<number, T> : never;
export function arrayToMap<T, K extends keyof T, V>(items: T[], key: K, valueSelector: (value: T) => V):
    T[K] extends string ? Record<string, V> : T[K] extends number ? Record<number, V> : never;
export function arrayToMap<T, K extends keyof T, V = T>(items: T[], key: K, valueSelector?: (value: T) => V):
    T[K] extends string ? Record<string, V | T> : T[K] extends number ? Record<number, V | T> : never {
    const result: Record<string | number, V | T> = {};
    for (const item of items) {
        const id = item[key];
        if (typeof id !== 'string' && typeof id !== 'number') {
            throw new Error('key of arrayToMap must be a string or number type');
        }
        result[id] = valueSelector ? valueSelector(item) : item;
    }

    return result as any;
}

export function hsvToRgb(h: number, s: number, v: number): Record<'r'|'g'|'b', number> {
    var r: number, g: number, b: number, i: number, f: number, p: number, q: number, t: number;
    h = clipNumber(h, 0, 1);
    s = clipNumber(s, 0, 1);
    v = clipNumber(v, 0, 1);
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return {
        r: Math.round(r! * 255),
        g: Math.round(g! * 255),
        b: Math.round(b! * 255)
    };
}

export function slice<T>(array: T[] | undefined, start: number, end: number): T[] {
    if (!array) {
        return [];
    }

    const len = array.length;
    let realStart = start;
    if (realStart < 0) {
        realStart = len + realStart;
    }
    if (realStart < 0) {realStart = 0;}

    let realEnd = end;
    if (realEnd < 0) {
        realEnd = len + realEnd;
    }

    if (realEnd <= realStart) {
        return [];
    }
    return array.slice(realStart, realEnd);
}

export function debounceByInput<TI extends any[], TO>(func: (...input: TI) => TO, keySelector: (...input: TI) => string, wait?: number, debounceSettings?: DebounceSettings): (...input: TI) => TO {
    const cachedMethods: Record<string, (input: TI) => TO> = {};
    
    function result(...input: TI): TO {
        const key = keySelector(...input);
        const method = cachedMethods[key];
        if (method) {
            return method(input);
        }

        const newMethod = debounce((input2) => {
            delete cachedMethods[key];
            return func(...input2);
        }, wait, debounceSettings);
        cachedMethods[key] = newMethod;
        return newMethod(input);
    }

    return result;
}

export function randomString(length: number, charset: string | undefined = undefined): string {
    var result = '';
    var characters = charset ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (let i = 0; i < length; i++ ) {
       result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

export function clipNumber(value: number, min: number, max: number): number {
    if (value < min) { return min; }
    if (value > max) { return max; }
    return value;
}

/**
 * Races a promise against a timeout. If the timeout fires first, `onTimeout` is called
 * (e.g. to surface a "still working" state) and the returned promise rejects with the
 * value `onTimeout` returns, or a default TimeoutError. The original promise keeps running
 * so a slow-but-not-stuck load can still finish in the background.
 */
export class TimeoutError extends Error {
    constructor(message: string = 'Operation timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => Error | void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) { return; }
            settled = true;
            const err = onTimeout?.() ?? new TimeoutError(`Operation timed out after ${ms}ms`);
            reject(err);
        }, ms);

        promise.then(
            value => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` callbacks concurrently.
 * Keeps the event loop responsive when each callback does heavy synchronous work
 * (e.g. DDS->PNG image conversion) under memory pressure. Results preserve input order.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    if (items.length === 0) {
        return results;
    }

    const effectiveLimit = Math.max(1, Math.min(limit, items.length));
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) {
                return;
            }
            results[index] = await fn(items[index], index);
        }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < effectiveLimit; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return results;
}

/**
 * Wraps an async, single-string-keyed function with a short-lived per-key memo. Within `ttl`
 * milliseconds of a key's last computation the memoized promise is returned as-is; after the TTL
 * the value is recomputed. Collapses IO bursts (e.g. the hundreds of fs.stat calls a single
 * preview render makes while re-checking the same files' expiry tokens) without a background
 * timer. Rejections are not memoized, so a transient failure is retried on the next call. The
 * map is bounded: over `maxSize`, expired entries are pruned first and then the oldest.
 * `now` is injectable for tests. The returned function exposes `.clear()` to drop every memoized
 * entry (e.g. when the workspace or config changes invalidate all resolutions at once).
 */
export function memoizeWithTtl<T>(
    fn: (key: string) => Promise<T>,
    options: { ttl: number; maxSize?: number; now?: () => number },
): ((key: string) => Promise<T>) & { clear: () => void } {
    const { ttl } = options;
    const maxSize = options.maxSize ?? 500;
    const now = options.now ?? (() => Date.now());
    const entries = new Map<string, { value: Promise<T>; time: number }>();

    const memoized = (key: string): Promise<T> => {
        const current = now();
        const existing = entries.get(key);
        if (existing && current - existing.time < ttl) {
            return existing.value;
        }

        const value = fn(key);
        const entry = { value, time: current };
        // Re-insert at the end so Map iteration order tracks recency for eviction below.
        entries.delete(key);
        entries.set(key, entry);

        value.catch(() => {
            if (entries.get(key) === entry) {
                entries.delete(key);
            }
        });

        if (entries.size > maxSize) {
            for (const [k, e] of entries) {
                if (current - e.time >= ttl) {
                    entries.delete(k);
                }
            }
            while (entries.size > maxSize) {
                const oldest = entries.keys().next().value as string | undefined;
                if (oldest === undefined) {
                    break;
                }
                entries.delete(oldest);
            }
        }

        return value;
    };

    return Object.assign(memoized, { clear: () => entries.clear() });
}

export class UserError extends Error {
    constructor (message: string) {
      super(message);
      this.name = 'UserError';
    }
}

export function forceError(e: unknown): Error {
    if (e instanceof Error || e instanceof UserError) {
        return e;
    }

    if (typeof e === 'string') {
        return new Error(e.toString());
    }

    return new Error();
}
