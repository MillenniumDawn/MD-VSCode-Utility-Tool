import * as assert from 'assert';
import { cacheNamespaceFor, computeStaleFiles } from '../util/indexCache';

describe('util/indexCache', () => {
    describe('cacheNamespaceFor', () => {
        it('gives two mods opened from the same folder two different namespaces', () => {
            assert.notStrictEqual(
                cacheNamespaceFor('d:/mods/alpha.mod', ['file:///ws']),
                cacheNamespaceFor('d:/mods/beta.mod', ['file:///ws']),
            );
        });

        it('gives two workspace folders two different namespaces', () => {
            assert.notStrictEqual(
                cacheNamespaceFor(undefined, ['file:///alpha']),
                cacheNamespaceFor(undefined, ['file:///beta']),
            );
        });

        it('is unchanged when the same folders arrive in a different order', () => {
            assert.strictEqual(
                cacheNamespaceFor(undefined, ['file:///a', 'file:///b']),
                cacheNamespaceFor(undefined, ['file:///b', 'file:///a']),
            );
        });

        it('reads the same mod file whichever slashes and case it is written with', () => {
            assert.strictEqual(
                cacheNamespaceFor('D:\\Mods\\Alpha.mod', []),
                cacheNamespaceFor('d:/mods/alpha.mod', []),
            );
        });

        it('treats an unset, empty and whitespace-only mod file as the same', () => {
            const none = cacheNamespaceFor(undefined, ['file:///ws']);
            assert.strictEqual(cacheNamespaceFor('', ['file:///ws']), none);
            assert.strictEqual(cacheNamespaceFor('   ', ['file:///ws']), none);
        });

        it('still names a namespace when there is no mod file and no folder', () => {
            const namespace = cacheNamespaceFor(undefined, []);
            assert.strictEqual(namespace, cacheNamespaceFor(undefined, []));
            assert.match(namespace, /^[0-9a-f]{16}$/);
        });

        it('is sixteen hex characters whatever the inputs are', () => {
            assert.match(cacheNamespaceFor('a'.repeat(500), ['file:///ws']), /^[0-9a-f]{16}$/);
            assert.match(cacheNamespaceFor('\u00e9\u4e2d', []), /^[0-9a-f]{16}$/);
        });

        it('does not collapse a folder set into the same namespace as one of its members', () => {
            assert.notStrictEqual(
                cacheNamespaceFor(undefined, ['file:///a']),
                cacheNamespaceFor(undefined, ['file:///a', 'file:///b']),
            );
        });
    });

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
