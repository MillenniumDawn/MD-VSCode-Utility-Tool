import * as assert from 'assert';
import * as vscode from 'vscode';
import { cacheNamespaceFor, computeStaleFiles, getFileMtimes } from '../util/indexCache';
import { restoreVscodeStubs, stubVscode } from './_vscode_stub';

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

        it('normalizes mod path identity for the host platform', () => {
            const upper = cacheNamespaceFor('D:\\Mods\\Alpha.mod', []);
            const lower = cacheNamespaceFor('d:/mods/alpha.mod', []);
            if (process.platform === 'win32') {
                assert.strictEqual(upper, lower);
            } else {
                assert.notStrictEqual(upper, lower);
            }
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

        it('gives two parent mod lists two different namespaces', () => {
            assert.notStrictEqual(
                cacheNamespaceFor(undefined, ['file:///ws'], ['d:/mods/parent']),
                cacheNamespaceFor(undefined, ['file:///ws'], ['d:/mods/other']),
            );
            assert.notStrictEqual(
                cacheNamespaceFor(undefined, ['file:///ws']),
                cacheNamespaceFor(undefined, ['file:///ws'], ['d:/mods/parent']),
            );
        });

        it('changes when the parent mods are reordered, because the order is the precedence', () => {
            assert.notStrictEqual(
                cacheNamespaceFor(undefined, ['file:///ws'], ['d:/a', 'd:/b']),
                cacheNamespaceFor(undefined, ['file:///ws'], ['d:/b', 'd:/a']),
            );
        });

        it('normalizes parent path identity for the host platform and skips blanks', () => {
            const upper = cacheNamespaceFor(undefined, [], ['D:\\Mods\\Parent', '', '  ']);
            const lower = cacheNamespaceFor(undefined, [], ['d:/mods/parent']);
            if (process.platform === 'win32') {
                assert.strictEqual(upper, lower);
            } else {
                assert.notStrictEqual(upper, lower);
            }
            assert.strictEqual(
                cacheNamespaceFor(undefined, ['file:///ws'], []),
                cacheNamespaceFor(undefined, ['file:///ws']),
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

    describe('getFileMtimes', () => {
        afterEach(() => restoreVscodeStubs());

        it('stats through a bounded pool, keeps input order and drops what cannot be resolved', async () => {
            const paths = Array.from({ length: 100 }, (_, i) => `f${i}.txt`);
            let inFlight = 0;
            let peak = 0;
            stubVscode({
                stat: async (uri: any) => {
                    inFlight++;
                    peak = Math.max(peak, inFlight);
                    await new Promise(resolve => setTimeout(resolve, 1));
                    inFlight--;
                    return { type: vscode.FileType.File, mtime: Number(String(uri.path).match(/f(\d+)/)![1]), ctime: 0, size: 0 };
                },
            });
            const resolveUri = async (relativePath: string) => {
                if (relativePath === 'f7.txt') {
                    throw new Error('unreadable');
                }
                return relativePath === 'f3.txt' ? undefined : vscode.Uri.file('/root/' + relativePath);
            };

            const result = await getFileMtimes(paths, resolveUri);

            assert.ok(peak > 1, `peak ${peak}`);
            assert.ok(peak <= 32, `peak ${peak}`);
            assert.deepStrictEqual([...result.keys()], paths.filter(p => p !== 'f3.txt' && p !== 'f7.txt'));
            assert.strictEqual(result.get('f42.txt'), 42);
        });
    });
});
