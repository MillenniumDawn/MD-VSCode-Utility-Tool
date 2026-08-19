import * as assert from 'assert';
import { hsvToRgb, slice, clipNumber, withTimeout, mapLimit, forceError, arrayToMap, TimeoutError, UserError, randomString, debounceByInput, memoizeWithTtl, jsonForScript } from '../util/common';

describe('util/common', function () {
    describe('arrayToMap', function () {
        it('maps items by key', function () {
            const items = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
            const map = arrayToMap(items, 'id');
            assert.strictEqual((map as any)['a'].v, 1);
            assert.strictEqual((map as any)['b'].v, 2);
        });

        it('supports value selector', function () {
            const items = [{ id: 'a', v: 1 }];
            const map = arrayToMap(items, 'id', x => x.v);
            assert.strictEqual((map as any)['a'], 1);
        });
    });

    describe('hsvToRgb', function () {
        it('produces red', function () {
            const c = hsvToRgb(0, 1, 1);
            assert.deepStrictEqual(c, { r: 255, g: 0, b: 0 });
        });

        it('produces black when value is 0', function () {
            const c = hsvToRgb(0.5, 1, 0);
            assert.deepStrictEqual(c, { r: 0, g: 0, b: 0 });
        });

        it('produces white when saturation is 0 and value is 1', function () {
            const c = hsvToRgb(0.3, 0, 1);
            assert.deepStrictEqual(c, { r: 255, g: 255, b: 255 });
        });
    });

    describe('slice', function () {
        it('returns empty array for undefined input', function () {
            assert.deepStrictEqual(slice(undefined as any, 0, 2), []);
        });

        it('returns standard slice for positive start', function () {
            assert.deepStrictEqual(slice([1, 2, 3, 4], 1, 3), [2, 3]);
        });

        it('handles negative start', function () {
            assert.deepStrictEqual(slice([10, 20, 30], -2, -1), [20]);
        });

        it('returns empty when end <= start with negative start', function () {
            assert.deepStrictEqual(slice([1, 2, 3], -2, -3), []);
        });
    });

    describe('clipNumber', function () {
        it('returns value when inside range', function () {
            assert.strictEqual(clipNumber(5, 0, 10), 5);
        });

        it('clips to min', function () {
            assert.strictEqual(clipNumber(-3, 0, 10), 0);
        });

        it('clips to max', function () {
            assert.strictEqual(clipNumber(15, 0, 10), 10);
        });
    });

    describe('withTimeout', function () {
        it('resolves when promise finishes first', async function () {
            const result = await withTimeout(Promise.resolve(42), 100);
            assert.strictEqual(result, 42);
        });

        it('rejects with TimeoutError when timed out', async function () {
            try {
                await withTimeout(new Promise(() => {}), 10);
                assert.fail('should have rejected');
            } catch (e) {
                assert.ok(e instanceof TimeoutError);
            }
        });

        it('uses custom onTimeout error', async function () {
            try {
                await withTimeout(new Promise(() => {}), 10, () => new Error('custom'));
                assert.fail('should have rejected');
            } catch (e) {
                assert.strictEqual((e as Error).message, 'custom');
            }
        });
    });

    describe('mapLimit', function () {
        it('returns results in input order', async function () {
            const items = [3, 1, 2];
            const results = await mapLimit(items, 2, async (n, i) => n + i);
            assert.deepStrictEqual(results, [3, 2, 4]);
        });

        it('respects concurrency limit', async function () {
            let running = 0;
            let maxRunning = 0;
            const items = [1, 2, 3, 4];
            await mapLimit(items, 2, async () => {
                running++;
                maxRunning = Math.max(maxRunning, running);
                await new Promise(r => setTimeout(r, 5));
                running--;
            });
            assert.strictEqual(maxRunning, 2);
        });
    });

    describe('forceError', function () {
        it('returns Error instances unchanged', function () {
            const err = new Error('foo');
            assert.strictEqual(forceError(err), err);
        });

        it('returns UserError instances unchanged', function () {
            const err = new UserError('foo');
            assert.strictEqual(forceError(err), err);
        });

        it('wraps strings', function () {
            const err = forceError('foo');
            assert.strictEqual(err.message, 'foo');
        });

        it('wraps plain objects', function () {
            const err = forceError({ foo: 1 });
            assert.ok(err instanceof Error);
        });
    });

    describe('randomString', function () {
        it('returns a string of the requested length', function () {
            assert.strictEqual(randomString(0).length, 0);
            assert.strictEqual(randomString(16).length, 16);
            assert.strictEqual(randomString(64).length, 64);
        });

        it('uses the provided charset when one is supplied', function () {
            const s = randomString(8, 'ab');
            assert.ok(/^[ab]{8}$/.test(s), `expected only a/b characters, got ${s}`);
        });

        it('produces different strings on consecutive calls', function () {
            // A 32-char default charset has 62^32 possible values; the chance of collision is
            // astronomical, but the test is here to guard against accidentally returning a
            // constant.
            assert.notStrictEqual(randomString(32), randomString(32));
        });
    });

    describe('arrayToMap', function () {
        it('throws when the key is neither string nor number', function () {
            const items = [{ key: { foo: 1 } }];
            assert.throws(() => arrayToMap(items, 'key' as any));
        });
    });

    describe('memoizeWithTtl', function () {
        // A hand-driven clock so the TTL boundary is exercised deterministically, with no sleeps.
        function fakeClock(start = 0) {
            let t = start;
            return { now: () => t, advance: (ms: number) => { t += ms; } };
        }

        it('returns the memoized value within the TTL without recomputing', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async (k: string) => { calls++; return `${k}:${calls}`; }, { ttl: 500, now: clock.now });

            const a = await memo('x');
            clock.advance(499);
            const b = await memo('x');

            assert.strictEqual(a, 'x:1');
            assert.strictEqual(b, 'x:1');
            assert.strictEqual(calls, 1);
        });

        it('recomputes once the TTL has elapsed', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async (k: string) => { calls++; return `${k}:${calls}`; }, { ttl: 500, now: clock.now });

            const a = await memo('x');
            clock.advance(500);
            const b = await memo('x');

            assert.strictEqual(a, 'x:1');
            assert.strictEqual(b, 'x:2');
            assert.strictEqual(calls, 2);
        });

        it('keys are independent', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async (k: string) => { calls++; return `${k}:${calls}`; }, { ttl: 500, now: clock.now });

            await memo('a');
            await memo('b');
            await memo('a');

            assert.strictEqual(calls, 2);
        });

        it('does not memoize rejections', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async () => { calls++; throw new Error('boom'); }, { ttl: 500, now: clock.now });

            await assert.rejects(memo('x'), /boom/);
            // Still within the TTL, but the failure was evicted so the next call retries.
            await assert.rejects(memo('x'), /boom/);
            assert.strictEqual(calls, 2);
        });

        it('clear() drops all entries so the next call recomputes within the TTL', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async (k: string) => { calls++; return `${k}:${calls}`; }, { ttl: 500, now: clock.now });

            const a = await memo('x');
            memo.clear();
            const b = await memo('x'); // still inside the TTL, but the memo was cleared

            assert.strictEqual(a, 'x:1');
            assert.strictEqual(b, 'x:2');
            assert.strictEqual(calls, 2);
        });

        it('bounds the map to maxSize, recomputing the evicted oldest key', async function () {
            const clock = fakeClock();
            let calls = 0;
            const memo = memoizeWithTtl(async (k: string) => { calls++; return k; }, { ttl: 10_000, now: clock.now, maxSize: 2 });

            await memo('a'); // calls=1
            clock.advance(1);
            await memo('b'); // calls=2
            clock.advance(1);
            await memo('c'); // calls=3, evicts 'a'
            await memo('c'); // cached, no call
            await memo('a'); // 'a' evicted -> calls=4

            assert.strictEqual(calls, 4);
        });
    });

    describe('debounceByInput', function () {
        // The debouncer uses lodash debounce under the hood, which schedules via
        // setTimeout(0) when wait is 0. We have to wait for at least one macrotask
        // tick before the wrapped function fires. The margin is generous so the
        // test stays reliable under heavy CI load.
        function nextTick(): Promise<void> {
            return new Promise(resolve => setTimeout(resolve, 50));
        }

        it('coalesces calls with the same key into a single deferred call', async function () {
            let calls = 0;
            const fn = debounceByInput(
                (...args: number[]) => { calls++; return args.reduce((a, b) => a + b, 0); },
                (...args: number[]) => args.join(','),
                0,
            );

            fn(1, 2);
            fn(1, 2);
            await nextTick();

            assert.strictEqual(calls, 1);

            // After the debounce fires, the cache is cleared so a new call with the
            // same key runs again.
            fn(1, 2);
            await nextTick();
            assert.strictEqual(calls, 2);
        });

        it('runs separate debouncers for different keys', async function () {
            let calls = 0;
            const fn = debounceByInput(
                (v: number) => { calls++; return v * 2; },
                (v: number) => String(v),
                0,
            );

            fn(1);
            fn(2);
            await nextTick();
            assert.strictEqual(calls, 2);
        });
    });

    describe('jsonForScript', function () {
        it('escapes a closing script tag so it cannot end the inline script', function () {
            const json = jsonForScript({ text: '</script><img src=x>' });
            assert.ok(!json.includes('</script'), json);
            assert.strictEqual(JSON.parse(json).text, '</script><img src=x>');
        });

        it('escapes the line separators that are legal JSON but not legal JavaScript', function () {
            const json = jsonForScript({ text: '\u2028\u2029' });
            assert.ok(!json.includes('\u2028'), json);
            assert.strictEqual(JSON.parse(json).text, '\u2028\u2029');
        });

        it('leaves ordinary values exactly as JSON.stringify writes them', function () {
            const value = { a: 1, b: ['x', null], c: 'plain text' };
            assert.strictEqual(jsonForScript(value), JSON.stringify(value));
        });
    });
});
