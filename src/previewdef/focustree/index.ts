import * as vscode from 'vscode';
import { buildFocusTreeHtml, buildNoFocusTreeHtml, buildFocusTreeErrorHtml, buildFocusTreePayload, loadFocusTreesOnly, focusTreeGridBox, focusTreeXGridSize, FocusTreePayload, FocusTreeUpdatePayload, ToolbarFlags } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewBase } from '../previewbase';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { FocusTree } from './schema';
import { getRelativePathInWorkspace, getDocumentByUri, getConfiguration } from '../../util/vsccommon';
import { localize } from '../../util/i18n';
import { loadingShellHtml } from '../../util/html';
import { withTimeout, TimeoutError } from '../../util/common';
import { error } from '../../util/debug';
import { useConditionInFocus, localisationIndex } from '../../util/featureflags';
import { computeStructuralFingerprint, computeIconSourceFingerprint, computeTreeStructuralFingerprint, computeTreeIconFingerprint, decideFocusTreeUpdate, FocusTreeFingerprints } from './fingerprint';

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
        a.hasInlayWindows === b.hasInlayWindows &&
        a.hasWarnings === b.hasWarnings;
}

class FocusTreePreview extends PreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private content: string | undefined;
    // Fingerprints of the last rendered structure-only payload. structuralFingerprint drives the
    // in-place `update`; iconSourceFingerprint drives the (expensive) icon re-resolution + re-push.
    private lastStructuralFingerprint: string | undefined = undefined;
    private lastIconSourceFingerprint: string | undefined = undefined;
    // Cheaper object-level fingerprints of the last rendered trees, computed from the parsed FocusTree[]
    // before any HTML/style work. They drive the pre-render early-out in sendPartialUpdate; kept in
    // lockstep with the rendered fingerprints above (seeded/reset at exactly the same points).
    private lastTreeStructural: string | undefined = undefined;
    private lastTreeIcon: string | undefined = undefined;
    private lastToolbarFlags: ToolbarFlags | undefined = undefined;
    private lastGoodHadFocusTrees = false;
    // Bug #36: the most recent real-icon CSS pushed to the webview, re-posted when the webview is
    // reloaded (hide->show tears it down) or the panel becomes visible again. Tagged with the
    // generation it belongs to so a cache from a superseded load is never re-pushed.
    private lastPushedIconCss: string | undefined = undefined;
    private lastPushedIconGeneration = -1;
    // An in-place `update` post patches the DOM but never refreshes the stored panel.webview.html,
    // so a hide->show reload (no retainContextWhenHidden) restores the pre-update structure. Cache
    // the last posted update and re-post it when the reloaded webview signals `ready`, tagged with
    // the generation so a full reload (which bumps the generation and re-renders fresh html that
    // already embeds the current structure) invalidates it.
    private lastUpdateMessage: (FocusTreeUpdatePayload & { type: string }) | undefined = undefined;
    private lastUpdateGeneration = -1;
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
                // Bug #36: the webview re-posts `ready` after VS Code reloads it (e.g. on hide->show),
                // which drops both the in-place structural update and the pushed icon CSS. Restore the
                // update first (it rebuilds #focustreeplaceholder) then the icon CSS: #ft-progressive-icons
                // lives outside that element and survives the rebuild, so this mirrors a fresh load
                // (structure, then icons stream in) and both orders would in fact work.
                this.repushCachedUpdate();
                this.repushCachedIconStyles();
            }
        });
        // Belt-and-suspenders for bug #36: also restore icons when the panel becomes visible again.
        this.panel.onDidChangeViewState(() => {
            if (this.panel.visible) {
                this.repushCachedIconStyles();
            }
        });
    }

    private repushCachedIconStyles(): void {
        if (this.lastPushedIconCss !== undefined && this.lastPushedIconGeneration === this.iconRenderGeneration && !this.isDisposed) {
            this.panel.webview.postMessage({ type: 'iconStyles', css: this.lastPushedIconCss });
        }
    }

    private repushCachedUpdate(): void {
        if (this.lastUpdateMessage !== undefined && this.lastUpdateGeneration === this.iconRenderGeneration && !this.isDisposed) {
            this.panel.webview.postMessage(this.lastUpdateMessage);
        }
    }

    private fingerprintsFor(payload: FocusTreePayload): FocusTreeFingerprints {
        // Always computed from a structure-only payload so the same edit fingerprints identically
        // whether or not the (real-icon) background pass has run.
        const styleRecords = (payload.styleTable as any).records as Record<string, string>;
        return {
            structural: computeStructuralFingerprint({
                focusTrees: payload.focusTrees,
                renderedFocus: payload.renderedFocus,
                renderedInlayWindows: payload.renderedInlayWindows,
                gridBox: payload.gridBox,
                useConditionInFocus: payload.useConditionInFocus,
                xGridSize: payload.xGridSize,
                styleRecords,
            }),
            iconSource: computeIconSourceFingerprint(styleRecords),
        };
    }

    // Object-level fingerprints of the parsed trees. gridBox/useConditionInFocus/xGridSize are static, so
    // sourcing them from the shared const here reproduces the exact values a full payload carries, letting
    // the early-out compare against a baseline seeded from structure.focusTrees without a payload in hand.
    // The live localisation config (index flag + preview language) is folded in too so that a config flip,
    // which refreshes the module flag but does NOT reload the preview, moves the hash and blocks a stale
    // skip. Read once here per call so the early-out compare and the baseline seed use the same values.
    private treeFingerprintsFor(focusTrees: FocusTree[]): { structural: string; icon: string } {
        return {
            structural: computeTreeStructuralFingerprint({
                focusTrees,
                gridBox: focusTreeGridBox,
                useConditionInFocus,
                xGridSize: focusTreeXGridSize,
                localisationIndex,
                previewLocalisation: getConfiguration().previewLocalisation ?? '',
            }),
            icon: computeTreeIconFingerprint(focusTrees),
        };
    }

    public onDocumentChange(document: vscode.TextDocument, dependencyChanged = false): Promise<void> {
        // Chain onto the previous update so renders are serialized. By the time a queued
        // render runs it reads the live document text, coalescing intermediate edits.
        const run = this.updateQueue.then(() => super.onDocumentChange(document, dependencyChanged));
        this.updateQueue = run.catch(() => undefined);
        return run;
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const generation = ++this.iconRenderGeneration;
        // A full (re)render embeds the current structure directly in the returned html, so any cached
        // in-place update belongs to a superseded page and must never be re-posted over this render.
        this.lastUpdateMessage = undefined;
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
                const fingerprints = this.fingerprintsFor(structure);
                this.lastStructuralFingerprint = fingerprints.structural;
                this.lastIconSourceFingerprint = fingerprints.iconSource;
                const treeFingerprints = this.treeFingerprintsFor(structure.focusTrees);
                this.lastTreeStructural = treeFingerprints.structural;
                this.lastTreeIcon = treeFingerprints.icon;
                this.lastToolbarFlags = structure.toolbarFlags;
                this.lastGoodHadFocusTrees = true;
                // Phase 2 (background): resolve the real focus icons and stream their CSS into the
                // already-visible preview. No hard timeout: slow icons fill in when ready.
                void this.pushIconStyles(generation);
                return buildFocusTreeHtml(structure, this.panel.webview, document.uri);
            }

            this.lastStructuralFingerprint = undefined;
            this.lastIconSourceFingerprint = undefined;
            this.lastTreeStructural = undefined;
            this.lastTreeIcon = undefined;
            this.lastToolbarFlags = undefined;
            this.lastGoodHadFocusTrees = false;
            return buildNoFocusTreeHtml(this.panel.webview, document.uri);
        } catch (e) {
            // Timeout or unexpected failure: show a recoverable panel with a Reload button
            // instead of leaving the user stuck on a dead loading spinner.
            error(e);
            // The error page carries no update listener, so reset the structure state (mirroring the
            // no-tree branch above). Clearing lastToolbarFlags makes the next edit take the full-reload
            // path via the toolbar-flags mismatch instead of posting into a listener-less page or
            // skipping forever on a stale fingerprint. (lastUpdateMessage was already cleared on entry.)
            this.lastStructuralFingerprint = undefined;
            this.lastIconSourceFingerprint = undefined;
            this.lastTreeStructural = undefined;
            this.lastTreeIcon = undefined;
            this.lastToolbarFlags = undefined;
            this.lastGoodHadFocusTrees = false;
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
            const css = full.styleTable.toRawCss();
            this.lastPushedIconCss = css;
            this.lastPushedIconGeneration = generation;
            this.panel.webview.postMessage({ type: 'iconStyles', css });
        } catch (e) {
            error(e);
        }
    }

    protected getLoadingShellHtml(): string {
        return loadingShellHtml(localize('focustree.loading.start', 'Preparing focus tree...'));
    }

    protected async sendPartialUpdate(document: vscode.TextDocument, dependencyChanged = false): Promise<void> {
        if (!this.panel.visible) {
            // A hidden panel silently drops posted messages and never refreshes the stored
            // webview.html, so an in-place update would be lost while its advanced fingerprint made
            // later identical edits skip forever, and a re-show would restore stale structure. Take
            // the full-reload path: getContent writes webview.html directly (works while hidden) and
            // re-derives the fingerprints; its phase-2 icon push waits on webviewReady, which fires
            // from the `ready` handler when the panel is shown and the reloaded webview loads.
            this.panelInitialized = false;
            await super.onDocumentChange(document);
            return;
        }
        this.content = document.getText();
        try {
            // Object-level early-out (bug #37): parse the focus trees only and, before paying for any
            // per-focus HTML/style rendering, skip when the parsed structure and icon set are both
            // unchanged. loadFocusTreesOnly shares the loader's content-hash cache, so the fall-through
            // buildFocusTreePayload reuses this same parse -- there is no double parse.
            let trees: FocusTree[] | null = null;
            try {
                trees = await withTimeout(loadFocusTreesOnly(this.focusTreeLoader), focusTreeRenderTimeout);
            } catch (e) {
                // A slow/stuck object-level load must not throw; drop the early-out and let the existing
                // structure pass (with its own timeout handling) take over.
                error(e);
                trees = null;
            }
            if (trees !== null && !dependencyChanged && !localisationIndex &&
                this.lastTreeStructural !== undefined && this.lastTreeIcon !== undefined) {
                const treeFingerprints = this.treeFingerprintsFor(trees);
                if (treeFingerprints.structural === this.lastTreeStructural && treeFingerprints.icon === this.lastTreeIcon) {
                    // Unchanged parsed structure + icon set and no dependency changed => the focuses and
                    // icons already on screen are current, so we can skip the whole render (mirrors the
                    // post-render skip below). !dependencyChanged is required: a dependency (resolved icon
                    // bytes, .gfx sprite swap, .gui window) alters the render without touching the FocusTree
                    // objects, so its fingerprint would not move. !localisationIndex is required because with
                    // the localisation index on, renderFocus embeds resolved loc text that changes when a
                    // .yml is edited, and .yml files are not focus-loader dependencies (so a loc edit never
                    // arrives as dependencyChanged) -- the object fingerprint cannot see it, so we must not
                    // early-out in that mode. (See task-07 report.)
                    this.lastGoodHadFocusTrees = true;
                    return;
                }
            }

            // Cheap structure-only pass: the rendered focus/inlay HTML is identical to a full render,
            // only the styleTable's icon CSS differs. That lets us fingerprint the change without
            // paying for the expensive DDS->PNG icon resolution on every keystroke (bug #37).
            let structure: FocusTreePayload | null = null;
            try {
                structure = await withTimeout(
                    buildFocusTreePayload(this.focusTreeLoader, undefined, { resolveIcons: false }),
                    focusTreeRenderTimeout,
                );
            } catch (e) {
                // Slow/stuck transient render: keep the current preview rather than flipping to
                // an error or empty state. A later edit (or reload) will refresh it.
                error(e);
                return;
            }

            if (structure === null) {
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

            if (!toolbarFlagsEqual(structure.toolbarFlags, this.lastToolbarFlags)) {
                // The toolbar lives in the baked-in shell, not in the updatable content, so a
                // change to which toggles it shows needs a full HTML reload.
                this.panelInitialized = false;
                await super.onDocumentChange(document);
                return;
            }

            const fingerprints = this.fingerprintsFor(structure);
            const previous: FocusTreeFingerprints | undefined =
                this.lastStructuralFingerprint === undefined || this.lastIconSourceFingerprint === undefined
                    ? undefined
                    : { structural: this.lastStructuralFingerprint, iconSource: this.lastIconSourceFingerprint };
            const decision = decideFocusTreeUpdate(previous, fingerprints);

            // A dependency .gfx edit can swap a sprite's texturefile without changing the structure
            // or the icon identity (same GFX name -> same icon key), so neither fingerprint moves.
            // previewmanager re-invokes us with our OWN document even for a dependency change, so the
            // document identity can't flag it; the dependencyChanged signal, threaded from the
            // subscription path, is what forces the (expensive) icon re-resolution in that case.
            const forceIcons = dependencyChanged;

            if (!decision.postUpdate && !decision.pushIcons && !forceIcons) {
                // Nothing the webview renders changed (the common while-typing case): skip entirely.
                this.lastGoodHadFocusTrees = true;
                return;
            }

            this.lastStructuralFingerprint = fingerprints.structural;
            this.lastIconSourceFingerprint = fingerprints.iconSource;
            const treeFingerprints = this.treeFingerprintsFor(structure.focusTrees);
            this.lastTreeStructural = treeFingerprints.structural;
            this.lastTreeIcon = treeFingerprints.icon;
            this.lastToolbarFlags = structure.toolbarFlags;
            this.lastGoodHadFocusTrees = true;

            if (decision.postUpdate) {
                const updateMsg: FocusTreeUpdatePayload & { type: string } = {
                    type: 'update',
                    focusTrees: structure.focusTrees,
                    renderedFocus: structure.renderedFocus,
                    renderedInlayWindows: structure.renderedInlayWindows,
                    gridBox: structure.gridBox,
                    useConditionInFocus: structure.useConditionInFocus,
                    xGridSize: structure.xGridSize,
                };
                this.panel.webview.postMessage(updateMsg);
                this.lastUpdateMessage = updateMsg;
            }

            if (decision.pushIcons || forceIcons) {
                await this.repushResolvedIconStyles();
            }

            // Re-tag the cached update with the current generation (bumped by repushResolvedIconStyles
            // if it ran) so it stays in lockstep with the icon cache and a later full reload, which
            // bumps the generation, invalidates it. The cached update still reflects the current
            // structure here: a full reload would have cleared it, and decision.postUpdate === false
            // only when the structure is unchanged from the last render.
            if (this.lastUpdateMessage !== undefined) {
                this.lastUpdateGeneration = this.iconRenderGeneration;
            }
        } finally {
            this.content = undefined;
        }
    }

    /**
     * Icon identities changed: resolve the real icons and refresh the pushed CSS. Awaited (not
     * backgrounded) so it stays on the update queue and never runs a second concurrent load against
     * the loader. The `#ft-progressive-icons` element the CSS lands in survives the webview's
     * in-place DOM rebuild, so this needs no full reload.
     */
    private async repushResolvedIconStyles(): Promise<void> {
        let full: FocusTreePayload | null = null;
        try {
            full = await withTimeout(buildFocusTreePayload(this.focusTreeLoader), focusTreeRenderTimeout);
        } catch (e) {
            // Slow icon pass: keep the previously pushed icons rather than blanking them.
            error(e);
            return;
        }
        if (!full || this.isDisposed) {
            return;
        }
        // Advance the generation so a still-in-flight background pushIconStyles from an earlier load
        // fails its post-await guard instead of overwriting this newer icon CSS (and the cache).
        // The bump + tag + post run without an await between them, so the older push can only post
        // before the bump (then this fresh post lands after it) or drop after seeing the new value.
        const generation = ++this.iconRenderGeneration;
        const css = full.styleTable.toRawCss();
        this.lastPushedIconCss = css;
        this.lastPushedIconGeneration = generation;
        this.panel.webview.postMessage({ type: 'iconStyles', css });
    }
}

export const focusTreePreviewDef: PreviewProviderDef = {
    type: 'focustree',
    canPreview: canPreviewFocusTree,
    previewConstructor: FocusTreePreview,
};
