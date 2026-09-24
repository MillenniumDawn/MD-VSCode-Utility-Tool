import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    modFileStatusContainer,
    redrawSelectedModFileStatus,
    registerModFile,
    updateSelectedModFileStatus,
} from '../util/modfile';
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
