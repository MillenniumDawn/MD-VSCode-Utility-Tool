import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    modFileStatusContainer,
    pickedFirst,
    redrawSelectedModFileStatus,
    registerModFile,
    updateSelectedModFileStatus,
} from '../util/modfile';
import { uriToFilePathWhenPossible } from '../util/vsccommon';
import { clearParentModCache, resetParentModsForTest, setResolvedDependencies } from '../util/parentmods';
import { fireConfigurationChange, stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/modfile status item', () => {
    let config: Record<string, unknown> = {};
    let item: vscode.StatusBarItem;

    beforeEach(() => {
        stubVscode({ getConfiguration: () => config });
        clearParentModCache();
        item = {
            text: '',
            tooltip: '',
            command: undefined,
            show: () => undefined,
            hide: () => undefined,
            dispose: () => undefined,
        } as unknown as vscode.StatusBarItem;
        modFileStatusContainer.current = item;
    });

    afterEach(() => {
        modFileStatusContainer.current = null;
        restoreVscodeStubs();
        config = {};
        clearParentModCache();
    });

    it('counts the parents on the item and names them in the tooltip', () => {
        config = { parentModPaths: ['D:/mods/parent', 'D:/mods/grandparent'] };

        updateSelectedModFileStatus(vscode.Uri.file('D:/mods/sub/sub.mod'));

        assert.ok(item.text.endsWith('sub +2'), item.text);
        assert.ok(String(item.tooltip).includes('Extends: D:/mods/grandparent'), String(item.tooltip));
    });

    // A change to `parentModPaths` redraws the item; it must not turn a missing mod file back into
    // a healthy-looking one until the next real check.
    it('keeps the error marker across a redraw for a parent list change', () => {
        updateSelectedModFileStatus(vscode.Uri.file('D:/mods/sub/missing.mod'), true);
        assert.ok(item.text.startsWith('$(error) '), item.text);

        config = { parentModPaths: ['D:/mods/parent'] };
        clearParentModCache();
        redrawSelectedModFileStatus();

        assert.ok(item.text.startsWith('$(error) '), item.text);
        assert.ok(item.text.endsWith(' +1'), item.text);
        assert.ok(String(item.tooltip).startsWith('Error reading this file: '), String(item.tooltip));
    });

    it('counts the resolved dependencies as parents and names the ones that did not resolve', () => {
        config = { parentModPaths: ['D:/mods/parent'] };
        setResolvedDependencies([vscode.Uri.file('D:/workshop/123')], ['Gone Mod']);

        updateSelectedModFileStatus(vscode.Uri.file('D:/mods/sub/sub.mod'));

        assert.ok(item.text.endsWith('sub +2'), item.text);
        assert.ok(String(item.tooltip).includes('Extends: D:/workshop/123'), String(item.tooltip));
        assert.ok(String(item.tooltip).includes('Unresolved dependency: Gone Mod'), String(item.tooltip));
        resetParentModsForTest();
    });

    it('redraws the no-descriptor state as it was', () => {
        updateSelectedModFileStatus(undefined);
        const before = item.text;

        redrawSelectedModFileStatus();

        assert.strictEqual(item.text, before);
        assert.ok(item.text.includes('(No mod descriptor)'), item.text);
    });
});

describe('util/modfile configuration change', () => {
    let config: Record<string, unknown> = {};
    let errors: string[] = [];
    let registration: vscode.Disposable;

    async function until(condition: () => boolean, what: string): Promise<void> {
        for (let i = 0; i < 100 && !condition(); i++) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.ok(condition(), what);
    }

    beforeEach(() => {
        config = { modFile: '', parentModPaths: [] };
        errors = [];
        clearParentModCache();
        stubVscode({
            getConfiguration: () => config,
            stat: async () => { throw new Error('ENOENT'); },
            showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
        });
        registration = registerModFile();
    });

    afterEach(() => {
        registration.dispose();
        restoreVscodeStubs();
        clearParentModCache();
    });

    function item(): vscode.StatusBarItem {
        assert.ok(modFileStatusContainer.current, 'registerModFile creates the status bar item');
        return modFileStatusContainer.current!;
    }

    it('checks the new mod file when modFile changes', async () => {
        await until(() => item().text.includes('(No mod descriptor)'), 'the initial status is drawn');

        config = { ...config, modFile: 'D:/mods/missing/missing.mod' };
        fireConfigurationChange('mdHoi4Utilities.modFile');

        await until(() => item().text.startsWith('$(error) missing'), item().text);
        assert.ok(errors.some(message => message.includes('missing.mod')), errors.join('\n'));
    });

    it('redraws the parent count when parentModPaths changes', async () => {
        await until(() => item().text.includes('(No mod descriptor)'), 'the initial status is drawn');
        assert.ok(!item().text.endsWith(' +1'), item().text);

        config = { ...config, parentModPaths: ['D:/mods/parent'] };
        fireConfigurationChange('mdHoi4Utilities.parentModPaths');

        assert.ok(item().text.endsWith(' +1'), item().text);
    });
});

describe('util/modfile pickedFirst', () => {
    const item = (label: string, picked?: boolean): vscode.QuickPickItem => ({ label, picked });

    it('treats two picked rows as equal in both orders', () => {
        assert.strictEqual(pickedFirst(item('a', true), item('b', true)), 0);
        assert.strictEqual(pickedFirst(item('b', true), item('a', true)), 0);
    });

    it('puts a picked row before an unpicked one in both orders', () => {
        assert.strictEqual(pickedFirst(item('a', true), item('b')), -1);
        assert.strictEqual(pickedFirst(item('b'), item('a', true)), 1);
    });

    it('treats unset and false as the same', () => {
        assert.strictEqual(pickedFirst(item('a'), item('b', false)), 0);
    });

    it('keeps picked rows first in their original order', () => {
        const rows = [item('x'), item('p1', true), item('y', false), item('p2', true)];
        assert.deepStrictEqual(rows.sort(pickedFirst).map(r => r.label), ['p1', 'p2', 'x', 'y']);
    });
});

// A quoted modFile setting resolves fine everywhere else, so the picker has to treat it as the same
// mod rather than as an unknown one it appends a second time. Issue #455.
describe('util/modfile picker', () => {
    const folder = vscode.Uri.file('/ws/my_mod');
    const modPath = uriToFilePathWhenPossible(vscode.Uri.joinPath(folder, 'my_mod.mod'));
    let registration: vscode.Disposable;

    async function pickerRows(modFile: string, globalValue?: string): Promise<vscode.QuickPickItem[]> {
        const handlers: Record<string, (...args: any[]) => any> = {};
        let rows: vscode.QuickPickItem[] = [];
        stubVscode({
            registerCommand: (command, handler) => {
                handlers[command] = handler;
                return { dispose: () => undefined };
            },
            workspaceFolders: [{ uri: folder }],
            readDirectory: async () => [['my_mod.mod', 1]],
            showQuickPick: async (items: any) => { rows = items; return undefined; },
            getConfiguration: () => ({
                get: () => undefined,
                modFile,
                parentModPaths: [],
                update: () => Promise.resolve(),
                inspect: () => globalValue ? { globalValue } : undefined,
            }),
        });
        registration = registerModFile();
        await handlers['mdhoi4utilities.selectmodfile']!();
        return rows;
    }

    afterEach(() => {
        registration?.dispose();
        restoreVscodeStubs();
    });

    it('marks the workspace mod named by a quoted setting and lists it once', async () => {
        const rows = await pickerRows(`"${modPath}"`);

        const mods = rows.filter(r => r.detail !== undefined);
        assert.deepStrictEqual(mods.map(r => r.detail), [modPath]);
        assert.strictEqual(mods[0]!.picked, true);
    });

    it('shows a quoted setting outside the workspace without its quotes', async () => {
        const elsewhere = uriToFilePathWhenPossible(vscode.Uri.file('/mods/other/other.mod'));
        const rows = await pickerRows(`'${elsewhere}'`);

        const setting = rows.filter(r => r.description === 'Workspace setting');
        assert.deepStrictEqual(setting.map(r => [r.label, r.detail, r.picked]), [['other', elsewhere, true]]);
    });

    it('shows a quoted global setting with an unquoted name and path', async () => {
        const elsewhere = uriToFilePathWhenPossible(vscode.Uri.file('/mods/other/other.mod'));
        const rows = await pickerRows(`"${elsewhere}"`, `"${elsewhere}"`);

        const setting = rows.filter(r => r.description === 'Global setting');
        assert.deepStrictEqual(setting.map(r => [r.label, r.detail, r.picked]), [['other', elsewhere, true]]);
        assert.strictEqual(rows.filter(r => r.description === 'Workspace setting').length, 0);
    });
});
