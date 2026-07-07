import * as vscode from 'vscode';
import { renderGfxFile } from './contentbuilder';
import { PreviewProviderDef } from '../previewmanager';
import { PreviewBase } from '../previewbase';
import { hashHtml, normalizeNoncesForHash, shouldReplaceHtml } from '../loaderpreview';

function canPreviewGfx(document: vscode.TextDocument) {
    const uri = document.uri;
    return uri.path.toLowerCase().endsWith('.gfx') ? 0 : undefined;
}

export class GfxPreview extends PreviewBase {
    private lastRenderHash: number | undefined = undefined;

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        const content = await renderGfxFile(document.getText(), document.uri, this.panel.webview);
        // PreviewBase assigns this html (first render / reload), so record its hash as the baseline.
        this.lastRenderHash = hashHtml(normalizeNoncesForHash(content));
        return content;
    }

    // Skip the webview.html teardown/reload when the nonce-normalized render is unchanged.
    protected async sendPartialUpdate(document: vscode.TextDocument): Promise<void> {
        const content = await renderGfxFile(document.getText(), document.uri, this.panel.webview);
        const hash = hashHtml(normalizeNoncesForHash(content));
        if (!shouldReplaceHtml(this.lastRenderHash, hash)) {
            return;
        }
        this.panel.webview.html = content;
        this.lastRenderHash = hash;
    }
}

export const gfxPreviewDef: PreviewProviderDef = {
    type: 'gfx',
    canPreview: canPreviewGfx,
    previewConstructor: GfxPreview,
};
