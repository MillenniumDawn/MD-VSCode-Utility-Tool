import * as assert from 'assert';
import * as vscode from 'vscode';
import { checkParentModPaths, clearParentModCache, getParentModUris } from '../util/parentmods';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/parentmods', () => {
    // Same arrangement as installpath.test.ts: the stub's getConfiguration has no
    // `parentModPaths` accessor, so point it at a local object the tests rewrite.
    let config: Record<string, unknown> = {};

    beforeEach(() => {
        stubVscode({ getConfiguration: () => config });
        clearParentModCache();
    });

    afterEach(() => {
        restoreVscodeStubs();
        config = {};
        clearParentModCache();
    });

    describe('getParentModUris', () => {
        it('keeps the setting order, because it is the search order', () => {
            config = { parentModPaths: ['D:\\second', 'D:\\first'] };

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\second', 'D:\\first']);
        });

        it('normalizes each entry like modFile: quotes stripped, whitespace trimmed', () => {
            config = { parentModPaths: ['"D:\\Quoted Mod"', '  D:\\Spaced  ', "'D:\\Single'"] };

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\Quoted Mod', 'D:\\Spaced', 'D:\\Single']);
        });

        it('drops blank entries rather than resolving them anywhere', () => {
            config = { parentModPaths: ['', '   ', '""', 'D:\\real', 42] };

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\real']);
        });

        it('is empty when the setting is missing', () => {
            config = {};

            assert.deepStrictEqual(getParentModUris(), []);
        });

        it('caches the list until the cache is cleared', () => {
            config = { parentModPaths: ['D:\\a'] };
            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\a']);

            config = { parentModPaths: ['D:\\b'] };
            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\a']);

            clearParentModCache();
            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\b']);
        });
    });

    describe('checkParentModPaths', () => {
        function recordErrorMessages(): string[] {
            const messages: string[] = [];
            stubVscode({ showErrorMessage: (message: string) => { messages.push(message); return Promise.resolve(undefined); } });
            return messages;
        }

        it('reports each path that is not a directory, once, by its normalized form', async () => {
            config = { parentModPaths: ['"D:\\missing"', 'D:\\present', 'D:\\isfile'] };
            stubVscode({
                stat: (uri: vscode.Uri) => {
                    if (uri.fsPath === 'D:\\present') {
                        return Promise.resolve({ type: vscode.FileType.Directory, mtime: 0, ctime: 0, size: 0 });
                    }
                    if (uri.fsPath === 'D:\\isfile') {
                        return Promise.resolve({ type: vscode.FileType.File, mtime: 0, ctime: 0, size: 0 });
                    }
                    return Promise.reject(new Error('ENOENT'));
                },
            });
            const messages = recordErrorMessages();

            await checkParentModPaths();

            assert.strictEqual(messages.length, 2);
            assert.ok(messages[0].includes('D:\\missing'), messages[0]);
            assert.ok(!messages[0].includes('"'), messages[0]);
            assert.ok(messages[1].includes('D:\\isfile'), messages[1]);
        });

        it('stays silent when nothing is configured', async () => {
            config = { parentModPaths: [] };
            stubVscode({ stat: () => Promise.reject(new Error('ENOENT')) });
            const messages = recordErrorMessages();

            await checkParentModPaths();

            assert.deepStrictEqual(messages, []);
        });
    });
});
