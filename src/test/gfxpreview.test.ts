import * as assert from 'assert';
import * as vscode from 'vscode';
import { GfxPreview } from '../previewdef/gfx';

// GfxPreview hardcodes renderGfxFile, so instead of the pure-decision harness LoaderPreview uses,
// these drive the real instance through onDocumentChange with a stub panel and count webview.html
// writes: an identical re-render must skip the reassign, a changed one must reassign.

describe('previewdef/gfx GfxPreview hash-skip', () => {
    function makePreview() {
        let htmlSetCount = 0;
        let lastAssignedHtml: string | undefined;
        const webview = {
            get html() { return lastAssignedHtml ?? ''; },
            set html(v: string) { htmlSetCount++; lastAssignedHtml = v; },
            onDidReceiveMessage: () => ({ dispose() { /* no-op */ } }),
            asWebviewUri: (u: unknown) => u,
            cspSource: '',
        };
        const panel = {
            webview,
            onDidDispose: () => ({ dispose() { /* no-op */ } }),
        };
        const preview = new GfxPreview(vscode.Uri.file('/tmp/x.gfx'), panel as any);
        return { preview, get htmlSetCount() { return htmlSetCount; } };
    }

    it('assigns on first render and skips an identical re-render', async () => {
        const h = makePreview();
        const document = { getText: () => '', uri: vscode.Uri.file('/tmp/x.gfx') };

        await h.preview.onDocumentChange(document as any); // first render -> assign
        assert.strictEqual(h.htmlSetCount, 1);

        await h.preview.onDocumentChange(document as any); // identical render -> skip
        assert.strictEqual(h.htmlSetCount, 1);
    });

    it('reassigns when the render changed', async () => {
        const h = makePreview();
        const docA = { getText: () => '', uri: vscode.Uri.file('/tmp/a.gfx') };
        const docB = { getText: () => '', uri: vscode.Uri.file('/tmp/b.gfx') };

        await h.preview.onDocumentChange(docA as any); // first render -> assign
        assert.strictEqual(h.htmlSetCount, 1);

        await h.preview.onDocumentChange(docB as any); // different previewed-file uri -> reassign
        assert.strictEqual(h.htmlSetCount, 2);
    });
});
