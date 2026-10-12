import * as assert from 'assert';
import * as vscode from 'vscode';
import { focusTreePreviewDef } from '../previewdef/focustree';
import { standardFocusTreeLayout } from '../previewdef/focustree/layout';

// The fingerprint functions themselves are tested in unit/previewdef/focustree/fingerprint.test.ts.
// This is the preview's cache of them, which needs a preview and so still runs through the stub.
describe('FocusTreePreview.treeFingerprintsFor', () => {
    function preview(): any {
        const panel = {
            webview: {
                html: '',
                cspSource: '',
                asWebviewUri: (u: unknown) => u,
                postMessage: () => Promise.resolve(true),
                onDidReceiveMessage: () => ({ dispose() { /* noop */ } }),
            },
            visible: true,
            onDidChangeViewState: () => ({ dispose() { /* noop */ } }),
            onDidDispose: () => ({ dispose() { /* noop */ } }),
        };
        return new (focusTreePreviewDef as any).previewConstructor(vscode.Uri.file('/tmp/tree.txt'), panel);
    }

    it('fingerprints one parse once per render and again after the render state is reset', () => {
        // The early-out check and the render result both ask for the fingerprints of the same
        // parsed trees; serialising every tree twice per keystroke was the cost.
        const p = preview();
        const trees = [{ id: 'tree', focuses: { a: { id: 'a', x: 0, y: 0 } } }];
        const other = [{ id: 'tree', focuses: { a: { id: 'a', x: 1, y: 0 } } }];

        const first = p.treeFingerprintsFor(trees, standardFocusTreeLayout);
        assert.strictEqual(p.treeFingerprintsFor(trees, standardFocusTreeLayout), first);
        assert.notStrictEqual(p.treeFingerprintsFor(other, standardFocusTreeLayout), first);
        assert.notStrictEqual(p.treeFingerprintsFor(trees, standardFocusTreeLayout), first);
        assert.deepStrictEqual(p.treeFingerprintsFor(trees, standardFocusTreeLayout), first);

        p.resetStructureState();
        const again = p.treeFingerprintsFor(trees, standardFocusTreeLayout);
        assert.notStrictEqual(again, first);
        assert.deepStrictEqual(again, first);
        p.dispose();
    });
});
