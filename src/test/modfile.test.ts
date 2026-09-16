import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    modFileStatusContainer,
    redrawSelectedModFileStatus,
    updateSelectedModFileStatus,
} from '../util/modfile';
import { clearParentModCache } from '../util/parentmods';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

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

    it('redraws the no-descriptor state as it was', () => {
        updateSelectedModFileStatus(undefined);
        const before = item.text;

        redrawSelectedModFileStatus();

        assert.strictEqual(item.text, before);
        assert.ok(item.text.includes('(No mod descriptor)'), item.text);
    });
});
