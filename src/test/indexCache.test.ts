import * as assert from 'assert';
import { computeStaleFiles } from '../util/indexCache';

describe('util/indexCache', () => {
    describe('computeStaleFiles', () => {
        it('returns three empty lists for an empty manifest and empty current mtimes', () => {
            const result = computeStaleFiles(
                { version: 1, entries: [] },
                new Map(),
            );
            assert.deepStrictEqual(result, { stale: [], removed: [], added: [] });
        });

        it('marks files whose mtime changed as stale', () => {
            const result = computeStaleFiles(
                { version: 1, entries: [{ filePath: 'a.txt', mtime: 100 }] },
                new Map([['a.txt', 200]]),
            );
            assert.deepStrictEqual(result.stale, ['a.txt']);
            assert.deepStrictEqual(result.removed, []);
            assert.deepStrictEqual(result.added, []);
        });

        it('does not mark files whose mtime is unchanged as stale', () => {
            const result = computeStaleFiles(
                { version: 1, entries: [{ filePath: 'a.txt', mtime: 100 }] },
                new Map([['a.txt', 100]]),
            );
            assert.deepStrictEqual(result, { stale: [], removed: [], added: [] });
        });

        it('marks files that disappeared from the current set as removed', () => {
            const result = computeStaleFiles(
                {
                    version: 1,
                    entries: [
                        { filePath: 'a.txt', mtime: 100 },
                        { filePath: 'b.txt', mtime: 100 },
                    ],
                },
                new Map([['a.txt', 100]]),
            );
            assert.deepStrictEqual(result.removed, ['b.txt']);
            assert.deepStrictEqual(result.stale, []);
            assert.deepStrictEqual(result.added, []);
        });

        it('marks files that appear for the first time as added', () => {
            const result = computeStaleFiles(
                { version: 1, entries: [{ filePath: 'a.txt', mtime: 100 }] },
                new Map([
                    ['a.txt', 100],
                    ['c.txt', 200],
                ]),
            );
            assert.deepStrictEqual(result.added, ['c.txt']);
        });

        it('handles a mix of all three categories in one call', () => {
            const result = computeStaleFiles(
                {
                    version: 1,
                    entries: [
                        { filePath: 'unchanged.txt', mtime: 100 },
                        { filePath: 'changed.txt', mtime: 100 },
                        { filePath: 'removed.txt', mtime: 100 },
                    ],
                },
                new Map([
                    ['unchanged.txt', 100],
                    ['changed.txt', 200],
                    ['added.txt', 200],
                ]),
            );
            assert.deepStrictEqual(result.stale.sort(), ['changed.txt']);
            assert.deepStrictEqual(result.removed, ['removed.txt']);
            assert.deepStrictEqual(result.added, ['added.txt']);
        });
    });
});
