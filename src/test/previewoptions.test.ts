import * as assert from 'assert';
import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { getPreviewOptions, setPreviewOption } from '../util/previewoptions';
import { PreviewBase } from '../previewdef/previewbase';

// A fake globalState, recording what was written so a message can be traced end to end.
function fakeContext(initial: Record<string, unknown> = {}) {
    const store: Record<string, unknown> = { ...initial };
    return {
        store,
        context: {
            globalState: {
                get: (key: string) => store[key],
                update: (key: string, value: unknown) => { store[key] = value; return Promise.resolve(); },
            },
        } as unknown as vscode.ExtensionContext,
    };
}

describe('util/previewoptions', () => {
    afterEach(() => {
        contextContainer.current = null;
    });

    it('reads back what was written, under its own prefix', () => {
        const { store, context } = fakeContext();
        contextContainer.current = context;

        setPreviewOption('mio.showGrid', true);

        assert.strictEqual(store['previewOption.mio.showGrid'], true);
        assert.deepStrictEqual(getPreviewOptions(['mio.showGrid']), { 'mio.showGrid': true });
    });

    // The default belongs to the toggle in the webview, so a key nothing was stored for is left out
    // rather than filled in here -- two answers to the same question is how they drift apart.
    it('leaves out a key nothing has been stored for', () => {
        contextContainer.current = fakeContext({ 'previewOption.mio.showGrid': false }).context;

        assert.deepStrictEqual(
            getPreviewOptions(['mio.showGrid', 'mio.showOverlaps']),
            { 'mio.showGrid': false });
    });

    // Every preview renders through this, including in tests and before activation has run.
    it('is quiet when there is no extension context', () => {
        assert.deepStrictEqual(getPreviewOptions(['mio.showGrid']), {});
        assert.doesNotThrow(() => setPreviewOption('mio.showGrid', true));
    });
});

describe('previewdef/previewbase setPreviewOption message', () => {
    class TestPreview extends PreviewBase {
        protected getContent(): Promise<string> {
            return Promise.resolve('');
        }
    }

    function makePreview() {
        let handler: ((msg: any) => void) | undefined;
        const panel = {
            webview: {
                onDidReceiveMessage: (h: (msg: any) => void) => { handler = h; return { dispose() { /* no-op */ } }; },
            },
            onDidDispose: () => ({ dispose() { /* no-op */ } }),
        };
        new TestPreview(vscode.Uri.file('/tmp/mio.txt'), panel as any);
        assert.ok(handler, 'expected the preview to subscribe to webview messages');
        return handler!;
    }

    afterEach(() => {
        contextContainer.current = null;
    });

    it('stores the toggle the webview reports', () => {
        const { store, context } = fakeContext();
        contextContainer.current = context;

        makePreview()({ command: 'setPreviewOption', key: 'mio.showGrid', value: true });

        assert.strictEqual(store['previewOption.mio.showGrid'], true);
    });

    it('ignores a message carrying no key', () => {
        const { store, context } = fakeContext();
        contextContainer.current = context;

        makePreview()({ command: 'setPreviewOption', value: true });

        assert.deepStrictEqual(store, {});
    });
});
