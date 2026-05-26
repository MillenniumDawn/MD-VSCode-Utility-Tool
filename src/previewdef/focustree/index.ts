import * as vscode from 'vscode';
import { renderFocusTreeFile, buildFocusTreePayload, FocusTreePayload, FocusTreeUpdatePayload, ToolbarFlags } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { getRelativePathInWorkspace } from '../../util/vsccommon';

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
        // Build payload first while content is set; second loader.load() inside renderFocusTreeFile
        // returns from cache (shouldReload = false, hash matches), so this is cheap.
        const payload = await buildFocusTreePayload(this.focusTreeLoader);
        if (payload) {
            this.lastCssFingerprint = payload.cssFingerprint;
            this.lastToolbarFlags = payload.toolbarFlags;
        } else {
            this.lastCssFingerprint = undefined;
            this.lastToolbarFlags = undefined;
        }
        const result = await renderFocusTreeFile(this.focusTreeLoader, document.uri, this.panel.webview);
        this.content = undefined;
        return result;
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
