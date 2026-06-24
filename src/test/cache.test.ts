import * as assert from 'assert';
import { Cache, PromiseCache } from '../util/cache';

// All caches register a cleanup interval; track them so we can dispose after each test and not
// leave timers keeping the process alive.
const created: { dispose(): void }[] = [];
function track<T extends { dispose(): void }>(cache: T): T {
    created.push(cache);
    return cache;
}
function keys(cache: object): string[] {
    return Object.keys((cache as any)._cache).sort();
}
const tick = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => {
    while (created.length) {
        created.pop()!.dispose();
    }
});

describe('Cache', () => {
    it('returns the factory value and caches it', () => {
        let calls = 0;
        const cache = track(new Cache<number>({ factory: () => ++calls, life: 60_000 }));

        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(calls, 1);
    });

    it('does not consult expireWhenChange within nonExpireLife', () => {
        let calls = 0;
        let token = 0;
        const cache = track(new Cache<number>({
            factory: () => ++calls,
            // A changing token would normally force a refetch, but the nonExpireLife window
            // short-circuits the check entirely (this is why opened/dirty files must bypass the
            // file-content cache rather than rely on a changing token).
            expireWhenChange: () => ++token,
            life: 60_000,
            nonExpireLife: 10_000,
        }));

        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(calls, 1);
    });

    it('refetches every get when nonExpireLife is 0 and the token changes', () => {
        let calls = 0;
        let token = 0;
        const cache = track(new Cache<number>({
            factory: () => ++calls,
            expireWhenChange: () => ++token,
            life: 60_000,
            nonExpireLife: 0,
        }));

        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(cache.get('a'), 2);
        assert.strictEqual(calls, 2);
    });

    it('reuses the cached value while the token is unchanged', () => {
        let calls = 0;
        const cache = track(new Cache<number>({
            factory: () => ++calls,
            expireWhenChange: () => 'stable',
            life: 60_000,
            nonExpireLife: 0,
        }));

        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(cache.get('a'), 1);
        assert.strictEqual(calls, 1);
    });

    it('evicts the least recently used entry past maxSize', () => {
        const cache = track(new Cache<string>({ factory: key => key, life: 60_000, maxSize: 2 }));

        cache.get('a');
        cache.get('b');
        cache.get('c');

        assert.deepStrictEqual(keys(cache), ['b', 'c']);
    });

    it('keeps recently accessed entries when evicting', () => {
        const cache = track(new Cache<string>({
            factory: key => key,
            life: 60_000,
            maxSize: 2,
            nonExpireLife: 10_000,
        }));

        cache.get('a');
        cache.get('b');
        cache.get('a'); // touch 'a' so 'b' is now the least recently used
        cache.get('c');

        assert.deepStrictEqual(keys(cache), ['a', 'c']);
    });

    it('evicts by total weight when maxBytes and weigher are set', () => {
        const cache = track(new Cache<string>({
            factory: key => key.repeat(10), // each value weighs 10
            weigher: value => value.length,
            life: 60_000,
            maxBytes: 25,
        }));

        cache.get('a'); // 10
        cache.get('b'); // 20
        cache.get('c'); // 30 -> over 25, evict LRU 'a'

        assert.deepStrictEqual(keys(cache), ['b', 'c']);
    });

    it('remove() deletes a single entry', () => {
        let calls = 0;
        const cache = track(new Cache<number>({ factory: () => ++calls, life: 60_000 }));

        assert.strictEqual(cache.get('a'), 1);
        cache.remove('a');
        assert.deepStrictEqual(keys(cache), []);
        assert.strictEqual(cache.get('a'), 2);
        assert.strictEqual(calls, 2);
    });

    it('clear() empties the cache', () => {
        const cache = track(new Cache<string>({ factory: key => key, life: 60_000 }));

        cache.get('a');
        cache.get('b');
        cache.clear();

        assert.deepStrictEqual(keys(cache), []);
    });

    it('does not schedule a cleanup interval when life is 0', () => {
        // life: 0 opts out of the cleanup interval, so no timer is scheduled.
        const cache = track(new Cache<string>({ factory: key => key, life: 0 }));
        assert.strictEqual((cache as any)._intervalToken, null);
    });

    it('dispose() empties the cache and is safe to call twice', () => {
        const cache = new Cache<number>({ factory: () => 1, life: 60_000 });
        cache.get('a');
        assert.ok((cache as any)._intervalToken, 'expected an interval to be scheduled');

        cache.dispose();
        assert.deepStrictEqual(keys(cache), []);
        assert.doesNotThrow(() => cache.dispose());
    });

    it('tryClean evicts entries whose lastAccess is older than life', () => {
        const cache = track(new Cache<string>({ factory: key => key, life: 1000 }));
        cache.get('stale');
        cache.get('fresh');

        (cache as any)._cache['stale'].lastAccess = Date.now() - 5000;
        (cache as any).tryClean();

        assert.deepStrictEqual(keys(cache), ['fresh']);
    });

    it('evicts when either maxSize or maxBytes is exceeded', () => {
        // Both limits set; maxBytes is the binding one here.
        const cache = track(new Cache<string>({
            factory: key => key.repeat(10), // each value weighs 10
            weigher: value => value.length,
            life: 60_000,
            maxSize: 5,
            maxBytes: 25,
        }));

        cache.get('a');
        cache.get('b');
        cache.get('c'); // 30 -> over 25, evict LRU 'a'

        assert.deepStrictEqual(keys(cache), ['b', 'c']);
    });

    it('treats an undefined weigher result as zero weight', () => {
        const cache = track(new Cache<string>({
            factory: key => key,
            weigher: () => undefined as unknown as number,
            life: 60_000,
            maxBytes: 5,
        }));

        cache.get('a');
        cache.get('b');
        cache.get('c');

        // Every weight is 0, so the byte limit is never exceeded and nothing is evicted.
        assert.deepStrictEqual(keys(cache), ['a', 'b', 'c']);
    });
});

describe('PromiseCache', () => {
    it('dedupes concurrent gets into a single factory call', async () => {
        let calls = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => { calls++; await tick(); return 42; },
            life: 60_000,
        }));

        const [a, b] = await Promise.all([cache.get('k'), cache.get('k')]);
        assert.strictEqual(a, 42);
        assert.strictEqual(b, 42);
        assert.strictEqual(calls, 1);
    });

    it('does not cache values that resolve to undefined', async () => {
        const cache = track(new PromiseCache<number | undefined>({
            factory: async () => undefined,
            life: 60_000,
        }));

        assert.strictEqual(await cache.get('k'), undefined);
        await tick();
        assert.deepStrictEqual(keys(cache), []);
    });

    it('does not cache rejected promises', async () => {
        let calls = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => { calls++; throw new Error('boom'); },
            life: 60_000,
        }));

        await assert.rejects(cache.get('k'), /boom/);
        await tick();
        assert.deepStrictEqual(keys(cache), []);

        await assert.rejects(cache.get('k'), /boom/);
        assert.strictEqual(calls, 2);
    });

    it('evicts by resolved weight once promises settle', async () => {
        const cache = track(new PromiseCache<string>({
            factory: async key => key.repeat(10), // each resolves to weight 10
            weigher: value => value.length,
            life: 60_000,
            maxBytes: 25,
        }));

        await cache.get('a');
        await cache.get('b');
        await cache.get('c'); // total 30 once weighed -> evict LRU 'a'
        await tick();

        assert.deepStrictEqual(keys(cache), ['b', 'c']);
    });

    it('remove() forces the next get to re-invoke the factory', async () => {
        let calls = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => ++calls,
            life: 60_000,
        }));

        assert.strictEqual(await cache.get('a'), 1);
        cache.remove('a');
        assert.strictEqual(await cache.get('a'), 2);
        assert.strictEqual(calls, 2);
    });

    it('clear() empties the cache', async () => {
        const cache = track(new PromiseCache<number>({
            factory: async key => key.length,
            life: 60_000,
        }));

        await cache.get('aa');
        await cache.get('bbb');
        cache.clear();

        assert.deepStrictEqual(keys(cache), []);
    });

    it('serves from cache within nonExpireLife without consulting expireWhenChange', async () => {
        let calls = 0;
        let tokenCalls = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => ++calls,
            expireWhenChange: () => ++tokenCalls,
            life: 60_000,
            nonExpireLife: 10_000,
        }));

        await cache.get('a');
        await cache.get('a');

        assert.strictEqual(calls, 1);
        assert.strictEqual(tokenCalls, 1); // consulted once at creation, skipped on the in-window hit
    });

    it('reuses the cached promise while the expiry token is unchanged', async () => {
        let calls = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => ++calls,
            expireWhenChange: () => 'stable',
            life: 60_000,
            nonExpireLife: 0,
        }));

        assert.strictEqual(await cache.get('a'), 1);
        assert.strictEqual(await cache.get('a'), 1);
        assert.strictEqual(calls, 1);
    });

    it('refetches when the expiry token changes', async () => {
        let calls = 0;
        let token = 0;
        const cache = track(new PromiseCache<number>({
            factory: async () => ++calls,
            expireWhenChange: () => ++token,
            life: 60_000,
            nonExpireLife: 0,
        }));

        assert.strictEqual(await cache.get('a'), 1);
        assert.strictEqual(await cache.get('a'), 2);
        assert.strictEqual(calls, 2);
    });
});
