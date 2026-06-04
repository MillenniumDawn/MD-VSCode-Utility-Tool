import * as vscode from 'vscode';
import { buildFocusTreeHtml, buildNoFocusTreeHtml, buildFocusTreeErrorHtml, buildFocusTreePayload, FocusTreePayload, FocusTreeUpdatePayload, ToolbarFlags } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getRelativePathInWorkspace, getDocumentByUri } from '../../util/vsccommon';
import { localize } from '../../util/i18n';
import { htmlEscape } from '../../util/html';
import { withTimeout, TimeoutError } from '../../util/common';
import { error } from '../../util/debug';

// A render taking longer than this is treated as stuck. The underlying load keeps running
// in the background, but the user gets a recoverable panel instead of an endless spinner.
const focusTreeRenderTimeout = 60 * 1000;

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
    private lastGoodHadFocusTrees = false;
    // Serializes updates so two loads can never run concurrently against the same loader.
    private updateQueue: Promise<void> = Promise.resolve();

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        // Read from the live document so a parallel update clearing `this.content` can never
        // make the loader parse an empty string (which used to flip the preview to "No focus tree").
        this.focusTreeLoader = new FocusTreeLoader(
            getRelativePathInWorkspace(this.uri),
            () => Promise.resolve(getDocumentByUri(this.uri)?.getText() ?? this.content ?? ''),
        );
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }

    public onDocumentChange(document: vscode.TextDocument): Promise<void> {
        // Chain onto the previous update so renders are serialized. By the time a queued
        // render runs it reads the live document text, coalescing intermediate edits.
        const run = this.updateQueue.then(() => super.onDocumentChange(document));
        this.updateQueue = run.catch(() => undefined);
        return run;
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const progress = (message: string, current?: number, total?: number) => {
            this.panel.webview.postMessage({ type: 'progress', message, current, total });
        };
        this.focusTreeLoader.setProgressListener(progress);
        try {
            const payload = await withTimeout(
                buildFocusTreePayload(this.focusTreeLoader, progress),
                focusTreeRenderTimeout,
                () => {
                    progress(localize('focustree.loading.slow', 'Still working on a heavy focus tree...'));
                    return new TimeoutError();
                },
            );
            if (payload) {
                this.lastCssFingerprint = payload.cssFingerprint;
                this.lastToolbarFlags = payload.toolbarFlags;
                this.lastGoodHadFocusTrees = true;
                return buildFocusTreeHtml(payload, this.panel.webview, document.uri);
            }

            this.lastCssFingerprint = undefined;
            this.lastToolbarFlags = undefined;
            this.lastGoodHadFocusTrees = false;
            return buildNoFocusTreeHtml(this.panel.webview, document.uri);
        } catch (e) {
            // Timeout or unexpected failure: show a recoverable panel with a Reload button
            // instead of leaving the user stuck on a dead loading spinner.
            error(e);
            return buildFocusTreeErrorHtml(this.panel.webview, document.uri, e);
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
            payload = await withTimeout(buildFocusTreePayload(this.focusTreeLoader), focusTreeRenderTimeout);
        } catch (e) {
            // Slow/stuck transient render: keep the current preview rather than flipping to
            // an error or empty state. A later edit (or reload) will refresh it.
            error(e);
            return;
        } finally {
            this.content = undefined;
        }

        if (payload === null) {
            if (this.lastGoodHadFocusTrees) {
                // Transient empty result (e.g. mid-save race or in-progress edit). Keep the
                // last good render instead of showing "No focus tree".
                return;
            }
            // No good render yet and the file is genuinely empty: do a full reload so the
            // "No focus tree" panel is shown. Use the base (non-queued) method to avoid
            // deadlocking on the update queue we are already running inside.
            this.panelInitialized = false;
            await super.onDocumentChange(document);
            return;
        }

        if (
            payload.cssFingerprint !== this.lastCssFingerprint ||
            !toolbarFlagsEqual(payload.toolbarFlags, this.lastToolbarFlags)
        ) {
            // Structure changed (styles/toolbar): fall back to a full HTML reload.
            this.panelInitialized = false;
            await super.onDocumentChange(document);
            return;
        }

        this.lastCssFingerprint = payload.cssFingerprint;
        this.lastToolbarFlags = payload.toolbarFlags;
        this.lastGoodHadFocusTrees = true;

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
