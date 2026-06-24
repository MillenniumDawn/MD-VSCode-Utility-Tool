import * as vscode from 'vscode';
import { buildFocusTreeHtml, buildNoFocusTreeHtml, buildFocusTreeErrorHtml, buildFocusTreePayload, FocusTreePayload, FocusTreeUpdatePayload, ToolbarFlags } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getRelativePathInWorkspace, getDocumentByUri } from '../../util/vsccommon';
import { localize } from '../../util/i18n';
import { loadingShellHtml } from '../../util/html';
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
    if (a === undefined || b === undefined) {return a === b;}
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
    // Generation token: each full (re)load bumps it so a slow background icon push from an earlier
    // load is dropped instead of overwriting a newer render.
    private iconRenderGeneration = 0;
    // Resolves when the webview signals it has rendered the structure and can accept icon CSS.
    private webviewReady: Promise<void> = Promise.resolve();
    private signalWebviewReady: () => void = () => {};

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        // Read from the live document so a parallel update clearing `this.content` can never
        // make the loader parse an empty string (which used to flip the preview to "No focus tree").
        this.focusTreeLoader = new FocusTreeLoader(
            getRelativePathInWorkspace(this.uri),
            () => Promise.resolve(getDocumentByUri(this.uri)?.getText() ?? this.content ?? ''),
        );
        this.focusTreeLoader.onLoadDone(r => this.updateDependencies(r.dependencies));
        this.panel.webview.onDidReceiveMessage(msg => {
            if (msg?.command === 'ready') {
                this.signalWebviewReady();
            }
        });
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
        const generation = ++this.iconRenderGeneration;
        this.webviewReady = new Promise<void>(resolve => { this.signalWebviewReady = resolve; });
        const progress = (message: string, current?: number, total?: number) => {
            this.panel.webview.postMessage({ type: 'progress', message, current, total });
        };
        this.focusTreeLoader.setProgressListener(progress);
        try {
            // Phase 1 (cheap): render the focus-tree structure with placeholder icons so the tree
            // appears immediately even when the (slow) DDS->PNG icon conversion would blow the
            // render budget. The timeout now only guards this fast structural pass. (plan Stap 3)
            const structure = await withTimeout(
                buildFocusTreePayload(this.focusTreeLoader, progress, { resolveIcons: false }),
                focusTreeRenderTimeout,
                () => {
                    progress(localize('focustree.loading.slow', 'Still working on a heavy focus tree...'));
                    return new TimeoutError();
                },
            );
            if (structure) {
                this.lastCssFingerprint = structure.cssFingerprint;
                this.lastToolbarFlags = structure.toolbarFlags;
                this.lastGoodHadFocusTrees = true;
                // Phase 2 (background): resolve the real focus icons and stream their CSS into the
                // already-visible preview. No hard timeout: slow icons fill in when ready.
                void this.pushIconStyles(generation);
                return buildFocusTreeHtml(structure, this.panel.webview, document.uri);
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

    /**
     * Resolves the real focus-icon images (the expensive DDS->PNG pass) in the background and
     * streams the resulting CSS into the already-rendered structure via an `iconStyles` message.
     * Waits for the webview's `ready` signal so the message is never dropped, and drops itself if a
     * newer load superseded it (generation mismatch) or the panel was disposed.
     */
    private async pushIconStyles(generation: number): Promise<void> {
        try {
            const full = await buildFocusTreePayload(this.focusTreeLoader);
            if (!full || generation !== this.iconRenderGeneration || this.isDisposed) {
                return;
            }
            await this.webviewReady;
            if (generation !== this.iconRenderGeneration || this.isDisposed) {
                return;
            }
            // Record the real-icon fingerprint so a later partial update that doesn't change icons
            // can use the fast in-place update path instead of forcing a full reload.
            this.lastCssFingerprint = full.cssFingerprint;
            this.lastToolbarFlags = full.toolbarFlags;
            this.panel.webview.postMessage({ type: 'iconStyles', css: full.styleTable.toRawCss() });
        } catch (e) {
            error(e);
        }
    }

    protected getLoadingShellHtml(): string {
        return loadingShellHtml(localize('focustree.loading.start', 'Preparing focus tree...'));
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
