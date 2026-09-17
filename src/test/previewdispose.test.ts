import * as assert from 'assert';
import * as vscode from 'vscode';
import { PreviewBase } from '../previewdef/previewbase';
import { UpdateablePreviewBase, LoaderRender } from '../previewdef/updateablepreview';
import { focusTreePreviewDef } from '../previewdef/focustree';
import { WorldMap } from '../previewdef/worldmap/worldmap';

// Issue #180: every subscription a preview takes on its panel is released when the preview is
// disposed, so a closed panel stops holding the preview through its emitters.

interface CountedPanel {
    panel: any;
    disposed: Record<string, number>;
    firePanelDispose: () => void;
}

function countedPanel(): CountedPanel {
    const disposed: Record<string, number> = { message: 0, viewState: 0, panelDispose: 0 };
    let onPanelDispose: (() => void) | undefined;
    const counted = (key: string) => ({ dispose() { disposed[key]++; } });
    const panel = {
        webview: {
            html: '',
            cspSource: '',
            asWebviewUri: (u: unknown) => u,
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage: () => counted('message'),
        },
        visible: true,
        onDidChangeViewState: () => counted('viewState'),
        onDidDispose: (h: () => void) => { onPanelDispose = h; return counted('panelDispose'); },
    };
    return { panel, disposed, firePanelDispose: () => onPanelDispose?.() };
}

describe('previewdef preview disposal (issue #180)', () => {
    class BasePreview extends PreviewBase {
        protected getContent(): Promise<string> {
            return Promise.resolve('');
        }
    }

    class UpdateablePreview extends UpdateablePreviewBase {
        protected renderContent(): Promise<LoaderRender | null> {
            return Promise.resolve('');
        }
    }

    it('PreviewBase releases the message and panel-dispose subscriptions', () => {
        const { panel, disposed } = countedPanel();
        const preview = new BasePreview(vscode.Uri.file('/tmp/a.txt'), panel);

        assert.deepStrictEqual(disposed, { message: 0, viewState: 0, panelDispose: 0 });
        preview.dispose();
        assert.deepStrictEqual(disposed, { message: 1, viewState: 0, panelDispose: 1 });
    });

    it('disposing twice releases each subscription once', () => {
        const { panel, disposed, firePanelDispose } = countedPanel();
        const preview = new BasePreview(vscode.Uri.file('/tmp/a.txt'), panel);

        firePanelDispose();
        preview.dispose();
        assert.deepStrictEqual(disposed, { message: 1, viewState: 0, panelDispose: 1 });
        assert.strictEqual(preview.isDisposed, true);
    });

    it('UpdateablePreviewBase also releases its view-state subscription', () => {
        const { panel, disposed, firePanelDispose } = countedPanel();
        new UpdateablePreview(vscode.Uri.file('/tmp/a.txt'), panel);

        firePanelDispose();
        assert.deepStrictEqual(disposed, { message: 1, viewState: 1, panelDispose: 1 });
    });

    it('FocusTreePreview releases its own message and view-state subscriptions too', () => {
        const { panel, disposed } = countedPanel();
        const preview = new (focusTreePreviewDef as any).previewConstructor(vscode.Uri.file('/tmp/tree.txt'), panel);

        preview.dispose();
        assert.deepStrictEqual(disposed, { message: 2, viewState: 2, panelDispose: 1 });
    });

    it('WorldMap releases the subscriptions initialize() took', () => {
        const { panel, disposed } = countedPanel();
        const worldMap = new WorldMap(panel);
        (worldMap as any).renderWorldMap = () => '';
        worldMap.initialize();

        assert.deepStrictEqual(disposed, { message: 0, viewState: 0, panelDispose: 0 });
        worldMap.dispose();
        assert.deepStrictEqual(disposed, { message: 1, viewState: 1, panelDispose: 0 });
        assert.strictEqual(worldMap.panel, undefined);
    });
});
