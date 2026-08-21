import * as vscode from 'vscode';
import { buildFocusTreeHtml, buildNoFocusTreeHtml, buildFocusTreeErrorHtml, buildFocusTreePayload, loadFocusTreesOnly, focusTreeGridBox, focusTreeXGridSize, FocusTreePayload } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { UpdateablePreviewBase, LoaderRender, LoaderRenderResult, RenderContentOptions } from '../updateablepreview';
import { PreviewProviderDef } from '../previewmanager';
import { FocusTreeLoader } from './loader';
import { FocusTree } from './schema';
import { getRelativePathInWorkspace, getDocumentByUri, getConfiguration } from '../../util/vsccommon';
import { localize } from '../../util/i18n';
import { loadingShellHtml } from '../../util/html';
import { withTimeout, TimeoutError } from '../../util/common';
import { error } from '../../util/debug';
import { useConditionInFocus, localisationIndex } from '../../util/featureflags';
import { computeStructuralFingerprint, computeIconSourceFingerprint, computeTreeStructuralFingerprint, computeTreeIconFingerprint } from './fingerprint';

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

// The shared in-place update machinery (the render fingerprint skip, the post-versus-assign
// decision, the loaded-page capability tracking and the hidden-panel html flush) lives in
// UpdateablePreviewBase; this preview supplies the render and the two things that are its own:
// a two-phase render (cheap structure first, expensive icons streamed in after) and a toolbar
// baked into the shell. Those map onto the base's sideFingerprint and shellFingerprint.
class FocusTreePreview extends UpdateablePreviewBase {
    private focusTreeLoader: FocusTreeLoader;
    private content: string | undefined;
    // Cheap object-level fingerprints of the last rendered trees, computed from the parsed FocusTree[]
    // before any HTML/style work. They drive the pre-render early-out; kept in lockstep with the
    // base's render fingerprint (seeded/reset at exactly the same points).
    private lastTreeStructural: string | undefined = undefined;
    private lastTreeIcon: string | undefined = undefined;
    // The fingerprints of the render currently being applied. Committed only once the base reports
    // it applied, mirroring the base's own rule that bookkeeping does not advance when the apply
    // throws -- otherwise a failed html assign would leave the early-out skipping every retry.
    private pendingTreeFingerprints: { structural: string; icon: string } | undefined = undefined;
    private lastGoodHadFocusTrees = false;
    // Bug #36: the most recent real-icon CSS pushed to the webview, re-posted when the webview is
    // reloaded (hide->show tears it down) or the panel becomes visible again. Tagged with the
    // generation it belongs to so a cache from a superseded load is never re-pushed.
    private lastPushedIconCss: string | undefined = undefined;
    private lastPushedIconGeneration = -1;
    // Serializes updates so two loads can never run concurrently against the same loader.
    private updateQueue: Promise<void> = Promise.resolve();
    // Generation token: each full (re)load bumps it so a slow background icon push from an earlier
    // load is dropped instead of overwriting a newer render.
    private iconRenderGeneration = 0;
    // Counts dependency changes. A dependency .gfx edit can swap a sprite's texturefile without
    // changing the structure or the icon identity (same GFX name -> same icon key), so neither
    // fingerprint would move; folding this into the side fingerprint is what forces the (expensive)
    // icon re-resolution in that case.
    private dependencyEpoch = 0;
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
                this.repostLatestUpdate();
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

    protected getLoadingShellHtml(): string {
        return loadingShellHtml(localize('focustree.loading.start', 'Preparing focus tree...'));
    }

    protected beforeRenderAssign(): void {
        // A full (re)load tears the page down: bump the generation so a slow background icon push
        // from the superseded render is dropped instead of overwriting the newer one, and re-arm the
        // ready signal before the replacement page can fire it.
        this.iconRenderGeneration++;
        this.webviewReady = new Promise<void>(resolve => { this.signalWebviewReady = resolve; });
    }

    protected async onRenderApplied(_rendered: LoaderRenderResult, assigned: boolean, sideChanged: boolean): Promise<void> {
        if (this.pendingTreeFingerprints !== undefined) {
            this.lastTreeStructural = this.pendingTreeFingerprints.structural;
            this.lastTreeIcon = this.pendingTreeFingerprints.icon;
            this.pendingTreeFingerprints = undefined;
        }
        if (assigned) {
            // The page reloaded with placeholder icons baked into its html. Resolve the real ones in
            // the background and stream them in; not awaited, so the tree stays on screen meanwhile.
            void this.pushIconStyles(this.iconRenderGeneration);
            return;
        }
        if (sideChanged) {
            // The structure was patched in place (or was unchanged) but the icon set moved. Awaited,
            // not backgrounded, so it stays on the update queue and never runs a second concurrent
            // load against the loader.
            await this.repushResolvedIconStyles();
        }
    }

    protected async renderContent(
        document: vscode.TextDocument,
        uri: vscode.Uri,
        webview: vscode.Webview,
        options: RenderContentOptions,
    ): Promise<LoaderRender | null> {
        if (options.dependencyChanged) {
            this.dependencyEpoch++;
        }
        this.pendingTreeFingerprints = undefined;
        this.content = document.getText();
        // Progress is only reported for a full render: a partial update patches a tree that is
        // already on screen, so its spinner would be noise.
        const progress = options.partial ? undefined : (message: string, current?: number, total?: number) => {
            this.panel.webview.postMessage({ type: 'progress', message, current, total });
        };
        this.focusTreeLoader.setProgressListener(progress);
        try {
            if (options.partial && await this.unchangedBeforeRender(options.dependencyChanged)) {
                return null;
            }

            // Phase 1 (cheap): render the focus-tree structure with placeholder icons so the tree
            // appears immediately even when the (slow) DDS->PNG icon conversion would blow the
            // render budget. The rendered focus/inlay HTML is identical to a full render, only the
            // styleTable's icon CSS differs, so the change detection below costs no icon work.
            let structure: FocusTreePayload | null;
            try {
                structure = await withTimeout(
                    buildFocusTreePayload(this.focusTreeLoader, progress, { resolveIcons: false }),
                    focusTreeRenderTimeout,
                    options.partial ? undefined : () => {
                        progress?.(localize('focustree.loading.slow', 'Still working on a heavy focus tree...'));
                        return new TimeoutError();
                    },
                );
            } catch (e) {
                error(e);
                if (options.partial) {
                    // Slow/stuck transient render: keep the current preview rather than flipping to
                    // an error or empty state. A later edit (or reload) will refresh it.
                    return null;
                }
                // Timeout or unexpected failure: show a recoverable panel with a Reload button
                // instead of leaving the user stuck on a dead loading spinner. The error page carries
                // no update listener, so resetting the structure state makes the next edit take the
                // full-reload path instead of posting into a listener-less page.
                this.resetStructureState();
                return buildFocusTreeErrorHtml(webview, uri, e);
            }

            if (structure === null) {
                if (options.partial && this.lastGoodHadFocusTrees) {
                    // Transient empty result (e.g. mid-save race or in-progress edit). Keep the
                    // last good render instead of showing "No focus tree".
                    return null;
                }
                this.resetStructureState();
                return buildNoFocusTreeHtml(webview, uri);
            }

            return this.renderResultFor(structure, webview, uri);
        } finally {
            this.focusTreeLoader.setProgressListener(undefined);
            this.content = undefined;
        }
    }

    /**
     * Object-level early-out (bug #37): parse the focus trees only and, before paying for any
     * per-focus HTML/style rendering, report unchanged when the parsed structure and icon set both
     * match the last render. loadFocusTreesOnly shares the loader's content-hash cache, so the
     * fall-through buildFocusTreePayload reuses this same parse -- there is no double parse.
     */
    private async unchangedBeforeRender(dependencyChanged: boolean): Promise<boolean> {
        let trees: FocusTree[] | null = null;
        try {
            trees = await withTimeout(loadFocusTreesOnly(this.focusTreeLoader), focusTreeRenderTimeout);
        } catch (e) {
            // A slow/stuck object-level load must not throw; drop the early-out and let the existing
            // structure pass (with its own timeout handling) take over.
            error(e);
            return false;
        }
        if (trees === null || dependencyChanged || localisationIndex ||
            this.lastTreeStructural === undefined || this.lastTreeIcon === undefined) {
            // !dependencyChanged is required: a dependency (resolved icon bytes, .gfx sprite swap,
            // .gui window) alters the render without touching the FocusTree objects, so its
            // fingerprint would not move. !localisationIndex is required because with the localisation
            // index on, renderFocus embeds resolved loc text that changes when a .yml is edited, and
            // .yml files are not focus-loader dependencies (so a loc edit never arrives as
            // dependencyChanged) -- the object fingerprint cannot see it. (See task-07 report.)
            return false;
        }
        const treeFingerprints = this.treeFingerprintsFor(trees);
        if (treeFingerprints.structural !== this.lastTreeStructural || treeFingerprints.icon !== this.lastTreeIcon) {
            return false;
        }
        // Unchanged parsed structure + icon set and no dependency changed => the focuses and icons
        // already on screen are current, so the whole render can be skipped.
        this.lastGoodHadFocusTrees = true;
        return true;
    }

    /**
     * Turns a structure-only payload into the base's render result. The html is the full page (a
     * cheap string assembly over the payload that is already built, which the base needs so a hidden
     * panel can be flushed back to current content), the update is what a visible page is patched
     * with, and the three fingerprints are the change detection:
     *  - `fingerprint` covers everything the rendered page shows, including the styleTable records
     *    that never reach the webview as payload. Always computed from a structure-only payload so
     *    the same edit fingerprints identically whether or not the icon pass has run.
     *  - `shellFingerprint` is the toolbar, which lives in the baked-in shell rather than in the
     *    updatable content, so a change to which toggles it shows needs a full html reload.
     *  - `sideFingerprint` is the icon identity set plus the dependency epoch: when it moves the
     *    base calls back into onRenderApplied and the real icons are re-resolved and re-pushed.
     */
    private renderResultFor(structure: FocusTreePayload, webview: vscode.Webview, uri: vscode.Uri): LoaderRenderResult {
        const styleRecords = (structure.styleTable as any).records as Record<string, string>;
        this.pendingTreeFingerprints = this.treeFingerprintsFor(structure.focusTrees);
        this.lastGoodHadFocusTrees = true;
        return {
            html: buildFocusTreeHtml(structure, webview, uri),
            update: {
                data: {
                    focusTrees: structure.focusTrees,
                    renderedFocus: structure.renderedFocus,
                    renderedInlayWindows: structure.renderedInlayWindows,
                    gridBox: structure.gridBox,
                    useConditionInFocus: structure.useConditionInFocus,
                    xGridSize: structure.xGridSize,
                },
            },
            fingerprint: computeStructuralFingerprint({
                focusTrees: structure.focusTrees,
                renderedFocus: structure.renderedFocus,
                renderedInlayWindows: structure.renderedInlayWindows,
                gridBox: structure.gridBox,
                useConditionInFocus: structure.useConditionInFocus,
                xGridSize: structure.xGridSize,
                styleRecords,
            }),
            shellFingerprint: JSON.stringify(structure.toolbarFlags),
            sideFingerprint: JSON.stringify([computeIconSourceFingerprint(styleRecords), this.dependencyEpoch]),
        };
    }

    private resetStructureState(): void {
        this.lastTreeStructural = undefined;
        this.lastTreeIcon = undefined;
        this.pendingTreeFingerprints = undefined;
        this.lastGoodHadFocusTrees = false;
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

    /**
     * Icon identities changed on a page that was NOT reloaded: resolve the real icons and refresh
     * the pushed CSS. The `#ft-progressive-icons` element the CSS lands in survives the webview's
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
