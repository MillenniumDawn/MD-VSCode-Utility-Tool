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
        // life: 0 is the opt-out signal for the cleanup interval. If a regression makes
        // the interval unconditional, the timer would keep the test process alive and
        // mask the bug only on --exit runs. Track the cache but assert no interval was
        // scheduled by checking the internal token.
        const cache = track(new Cache<string>({ factory: key => key, life: 0 }));
        assert.strictEqual((cache as any)._intervalToken, null);
    });

    it('dispose() clears the cache and the cleanup interval', () => {
        // dispose() must clear the interval it scheduled in the constructor; if a
        // regression swaps clearInterval back to clearTimeout (or skips the call), the
        // interval timer would keep the process alive and any test that leaks the cache
        // would hang. We assert the observable side effect: the cache is empty after
        // dispose, and a second dispose call is a no-op (proves the token was actually
        // cleared, not just held in a stale object).
        const cache = new Cache<number>({ factory: () => 1, life: 60_000 });
        cache.get('a');
        assert.deepStrictEqual(keys(cache), ['a']);
        const intervalToken = (cache as any)._intervalToken;
        assert.ok(intervalToken, 'expected an interval to be scheduled');

        cache.dispose();
        assert.deepStrictEqual(keys(cache), []);

        // A second dispose must not throw. If the implementation only called clearInterval
        // once and stashed the token without re-clearing, a regression that double-disposes
        // (e.g. via a try/finally that always runs) would hit clearInterval on a stale token.
        assert.doesNotThrow(() => cache.dispose());
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
});
