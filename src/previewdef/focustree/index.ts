import * as vscode from 'vscode';
import { renderFocusTreeFile, buildFocusTreePayload, FocusTreePayload, FocusTreeUpdatePayload, ToolbarFlags } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { localize } from '../../util/i18n';
import { htmlEscape } from '../../util/html';

function canPreviewFocusTree(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'national_focus', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    return undefined;
}

function toolbarFlagsEqual(a: ToolbarFlags | undefined, b: ToolbarFlags | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.hasCustomTitlebar === b.hasCustomTitlebar &&
        a.hasFocusOverlay === b.hasFocusOverlay &&
        a.hasInlayWindows === b.hasInlayWindows;
}

class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private content: string | undefined;
    private lastCssFingerprint: string | undefined = undefined;
    private lastToolbarFlags: ToolbarFlags | undefined = undefined;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        this.focusTreeLoader = new FocusTreeLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const progress = (message: string, current?: number, total?: number) => {
            this.panel.webview.postMessage({ type: 'progress', message, current, total });
        };
        this.focusTreeLoader.setProgressListener(progress);
        try {
            // Build payload first while content is set; second loader.load() inside renderFocusTreeFile
            // returns from cache (shouldReload = false, hash matches), so this is cheap.
            const payload = await buildFocusTreePayload(this.focusTreeLoader, progress);
            if (payload) {
                this.lastCssFingerprint = payload.cssFingerprint;
                this.lastToolbarFlags = payload.toolbarFlags;
            } else {
                this.lastCssFingerprint = undefined;
                this.lastToolbarFlags = undefined;
            }
            const result = await renderFocusTreeFile(this.focusTreeLoader, document.uri, this.panel.webview, progress);
            return result;
        } finally {
            this.focusTreeLoader.setProgressListener(undefined);
            this.content = undefined;
        }
    }

    protected getLoadingShellHtml(): string {
        const initialText = htmlEscape(localize('focustree.loading.start', 'Preparing focus tree...'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
    .ft-loading {
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px;
        font: 13px var(--vscode-font-family);
        color: var(--vscode-foreground);
    }
    .ft-spinner {
        width: 32px; height: 32px;
        border-radius: 50%;
        border: 3px solid var(--vscode-progressBar-background, var(--vscode-foreground, #888));
        border-top-color: transparent;
        animation: ft-spin 0.9s linear infinite;
    }
    .ft-status { opacity: 0.85; text-align: center; max-width: 80%; }
    .ft-counter { opacity: 0.6; margin-left: 6px; font-variant-numeric: tabular-nums; }
    @keyframes ft-spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="ft-loading" role="status" aria-live="polite">
    <div class="ft-spinner" aria-hidden="true"></div>
    <div class="ft-status"><span id="loading-message">${initialText}</span><span id="loading-counter" class="ft-counter"></span></div>
</div>
<script>
(function () {
    var msgEl = document.getElementById('loading-message');
    var counterEl = document.getElementById('loading-counter');
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.type !== 'progress') return;
        if (typeof data.message === 'string' && msgEl) {
            msgEl.textContent = data.message;
        }
        if (counterEl) {
            if (typeof data.current === 'number' && typeof data.total === 'number' && data.total > 0) {
                counterEl.textContent = '(' + data.current + '/' + data.total + ')';
            } else {
                counterEl.textContent = '';
            }
        }
    });
})();
</script>
</body>
</html>`;
    }

    protected async sendPartialUpdate(document: vscode.TextDocument): Promise<void> {
        this.content = document.getText();
        let payload: FocusTreePayload | null = null;
        try {
            payload = await buildFocusTreePayload(this.focusTreeLoader);
        } finally {
            this.content = undefined;
        }

        if (
            payload === null ||
            payload.cssFingerprint !== this.lastCssFingerprint ||
            !toolbarFlagsEqual(payload.toolbarFlags, this.lastToolbarFlags)
        ) {
            // Fall back to full HTML reload
            this.panelInitialized = false;
            await this.onDocumentChange(document);
            return;
        }

        this.lastCssFingerprint = payload.cssFingerprint;
        this.lastToolbarFlags = payload.toolbarFlags;

        const updateMsg: FocusTreeUpdatePayload & { type: string } = {
            type: 'update',
            focusTrees: payload.focusTrees,
            renderedFocus: payload.renderedFocus,
            renderedInlayWindows: payload.renderedInlayWindows,
            gridBox: payload.gridBox,
            useConditionInFocus: payload.useConditionInFocus,
            xGridSize: payload.xGridSize,
        };
        this.panel.webview.postMessage(updateMsg);
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewContructor: FocusTreePreview,
};
