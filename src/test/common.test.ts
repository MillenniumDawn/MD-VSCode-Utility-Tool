import * as assert from 'assert';
import { hsvToRgb, slice, clipNumber, withTimeout, mapLimit, forceError, arrayToMap, TimeoutError, UserError } from '../util/common';

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
            assert.deepStrictEqual(slice([10, 20, 30], -2, 0), [20]);
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
});
