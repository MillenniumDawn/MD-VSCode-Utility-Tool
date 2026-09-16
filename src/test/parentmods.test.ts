import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    checkParentModPaths,
    clearParentModCache,
    getParentModUris,
    getUnresolvedDependencies,
    normalizeParentModPathSetting,
    onDidChangeParentMods,
    publishParentMods,
    resetParentModsForTest,
    setResolvedDependencies,
} from '../util/parentmods';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/parentmods', () => {
    // Same arrangement as installpath.test.ts: the stub's getConfiguration has no
    // `parentModPaths` accessor, so point it at a local object the tests rewrite.
    let config: Record<string, unknown> = {};

    beforeEach(() => {
        stubVscode({ getConfiguration: () => config });
        resetParentModsForTest();
    });

    afterEach(() => {
        restoreVscodeStubs();
        config = {};
        resetParentModsForTest();
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

        it('reads a lone string as the one entry it was meant to be, not one parent per character', () => {
            config = { parentModPaths: 'D:\\hand\\typed' };

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:\\hand\\typed']);
        });

        it('is empty for a value of any other shape', () => {
            config = { parentModPaths: 42 };
            assert.deepStrictEqual(getParentModUris(), []);

            clearParentModCache();
            config = { parentModPaths: { path: 'D:/obj' } };
            assert.deepStrictEqual(getParentModUris(), []);
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

    // The `.mod` dependencies come after the setting: an explicit folder is the one the user chose,
    // and it must win the lookup over the registry's copy of the same mod.
    describe('resolved dependencies', () => {
        it('follow the setting entries, in their own order', () => {
            config = { parentModPaths: ['D:/explicit'] };
            setResolvedDependencies([vscode.Uri.file('D:/second'), vscode.Uri.file('D:/first')], []);

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:/explicit', 'D:/second', 'D:/first']);
        });

        it('are dropped when the setting already lists the folder, whichever slashes and case it used', () => {
            config = { parentModPaths: ['d:\\Mods\\Parent'] };
            setResolvedDependencies([vscode.Uri.file('D:/mods/parent'), vscode.Uri.file('D:/other')], []);

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['d:\\Mods\\Parent', 'D:/other']);
        });

        it('survive a clear of the cached list, which a setting change causes', () => {
            config = { parentModPaths: [] };
            setResolvedDependencies([vscode.Uri.file('D:/resolved')], ['Missing Mod']);
            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:/resolved']);

            config = { parentModPaths: ['D:/added'] };
            clearParentModCache();

            assert.deepStrictEqual(getParentModUris().map(u => u.fsPath), ['D:/added', 'D:/resolved']);
            assert.deepStrictEqual(getUnresolvedDependencies(), ['Missing Mod']);
        });
    });

    describe('publishParentMods', () => {
        it('tells the listeners once per change of the list, not once per call', () => {
            let heard = 0;
            onDidChangeParentMods(() => { heard++; });
            config = { parentModPaths: ['D:/a'] };

            assert.strictEqual(publishParentMods(), true);
            assert.strictEqual(publishParentMods(), false);
            setResolvedDependencies([vscode.Uri.file('D:/b')], []);
            assert.strictEqual(publishParentMods(), true);
            setResolvedDependencies([vscode.Uri.file('D:/b')], ['x']);
            assert.strictEqual(publishParentMods(), false);

            assert.strictEqual(heard, 2);
        });

        it('stays quiet for an empty list that was empty before', () => {
            let heard = 0;
            onDidChangeParentMods(() => { heard++; });
            config = { parentModPaths: [] };

            assert.strictEqual(publishParentMods(), false);
            assert.strictEqual(heard, 0);
        });

        it('stops telling a listener that was disposed', () => {
            let heard = 0;
            const subscription = onDidChangeParentMods(() => { heard++; });
            config = { parentModPaths: ['D:/a'] };
            publishParentMods();
            subscription.dispose();
            config = { parentModPaths: ['D:/b'] };
            clearParentModCache();
            publishParentMods();

            assert.strictEqual(heard, 1);
        });
    });

    // Shared with the index cache namespace, which used to `.filter` the raw value: on a string that
    // threw, was swallowed, and dropped modFile from the namespace along with it.
    describe('normalizeParentModPathSetting', () => {
        it('reads an array, a lone string, and anything else', () => {
            assert.deepStrictEqual(normalizeParentModPathSetting(['D:/a', '', 7, 'D:/b']), ['D:/a', 'D:/b']);
            assert.deepStrictEqual(normalizeParentModPathSetting('D:/a'), ['D:/a']);
            assert.deepStrictEqual(normalizeParentModPathSetting('   '), []);
            assert.deepStrictEqual(normalizeParentModPathSetting(undefined), []);
            assert.deepStrictEqual(normalizeParentModPathSetting(null), []);
            assert.deepStrictEqual(normalizeParentModPathSetting({ 0: 'D:/a' }), []);
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

        it('leaves the resolved dependencies alone: they were checked to be folders when resolved', async () => {
            config = { parentModPaths: [] };
            setResolvedDependencies([vscode.Uri.file('D:\resolved')], []);
            stubVscode({ stat: () => Promise.reject(new Error('ENOENT')) });
            const messages = recordErrorMessages();

            await checkParentModPaths();

            assert.deepStrictEqual(messages, []);
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
