import * as vscode from 'vscode';
import { PreviewBase } from './previewbase';
import { Loader } from '../util/loader/loader';
import { getRelativePathInWorkspace } from '../util/vsccommon';

// Shared base for the event/gui/mio/technology previews. They only differ in which
// loader they build and which render function turns it into HTML, so the constructor
// wiring and the getContent template live here once.
//
// sendPartialUpdate hashes the freshly rendered content and skips touching the webview
// when it matches the last render. A webview.html assignment tears the page down and
// rebuilds it (blank flash, lost scroll/zoom), so on a debounced edit that produces
// identical output we now do nothing.
//
// When the render function returns structured update parts (a preview that supports it),
// a change is pushed in place via an `updateBody` postMessage while the panel is visible
// instead of reassigning the html. Previews whose render returns a plain string keep the
// old full-reassign behaviour (the fallback), and a hidden panel also reassigns so the
// stored html the webview reloads from on show is never stale.

// The in-place update message the webview applies without a full reload. A preview opts in
// by returning it from its render function; `data` is the preview-specific globals the
// webview re-renders from (kept generic so LoaderPreview stays agnostic).
export interface LoaderUpdateMessage {
    styleCss?: string;
    bodyHtml?: string;
    data?: Record<string, unknown>;
}

export interface LoaderRenderResult {
    html: string;
    update?: LoaderUpdateMessage;
}

export type LoaderRender = string | LoaderRenderResult;

export function normalizeRender(rendered: LoaderRender): LoaderRenderResult {
    return typeof rendered === 'string' ? { html: rendered } : rendered;
}

// Stable serialization of the update payload for change detection. Unlike the full html
// (which carries fresh random CSP nonces per render and so never hashes equal), the update
// parts are deterministic for identical input, so hashing them makes the skip actually fire.
export function serializeUpdate(update: LoaderUpdateMessage): string {
    return JSON.stringify(update);
}

export type LoaderUpdateAction =
    | { kind: 'skip'; hash: number }
    | { kind: 'post'; message: LoaderUpdateMessage & { type: 'updateBody' }; hash: number }
    | { kind: 'assign'; html: string; hash: number };

// Pure decision for what to do with a fresh render given the last render's hash and whether
// the panel is visible: skip (unchanged), post an in-place update (changed, update-capable,
// visible), or assign the full html (changed but no update support, or hidden panel).
export function decideLoaderRender(rendered: LoaderRenderResult, lastRenderHash: number | undefined, visible: boolean): LoaderUpdateAction {
    const hash = rendered.update ? hashHtml(serializeUpdate(rendered.update)) : hashHtml(rendered.html);
    if (!shouldReplaceHtml(lastRenderHash, hash)) {
        return { kind: 'skip', hash };
    }
    if (rendered.update && visible) {
        return { kind: 'post', message: { type: 'updateBody', ...rendered.update }, hash };
    }
    return { kind: 'assign', html: rendered.html, hash };
}

export abstract class LoaderPreview<TLoader extends Loader<unknown, unknown>> extends PreviewBase {
    private readonly loader: TLoader;
    private content: string | undefined;
    private lastRenderHash: number | undefined = undefined;
    // The most recent full html. Kept so a panel that received in-place updates while visible
    // can be flushed back to a current html when it is hidden (see the view-state handler),
    // avoiding a stale reload on the next show.
    private latestHtml: string | undefined = undefined;
    private htmlPropertyStale = false;

    constructor(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        createLoader: (file: string, contentProvider: () => Promise<string>) => TLoader,
        private readonly render: (loader: TLoader, uri: vscode.Uri, webview: vscode.Webview) => Promise<LoaderRender>,
    ) {
        super(uri, panel);
        this.loader = createLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.loader.onLoadDone(r => this.updateDependencies(r.dependencies));
        // Without retainContextWhenHidden the webview is torn down when hidden and reloaded from
        // panel.webview.html on show. In-place updates don't touch that property, so flush the
        // latest html into it when the panel goes hidden to keep the next show current.
        this.panel.onDidChangeViewState(() => {
            if (!this.panel.visible && this.htmlPropertyStale && this.latestHtml !== undefined) {
                this.panel.webview.html = this.latestHtml;
                this.htmlPropertyStale = false;
            }
        });
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const rendered = normalizeRender(await this.render(this.loader, document.uri, this.panel.webview));
        this.content = undefined;
        this.lastRenderHash = rendered.update ? hashHtml(serializeUpdate(rendered.update)) : hashHtml(rendered.html);
        this.latestHtml = rendered.html;
        this.htmlPropertyStale = false;
        return rendered.html;
    }

    protected async sendPartialUpdate(document: vscode.TextDocument): Promise<void> {
        this.content = document.getText();
        const rendered = normalizeRender(await this.render(this.loader, document.uri, this.panel.webview));
        this.content = undefined;

        const decision = decideLoaderRender(rendered, this.lastRenderHash, this.panel.visible);
        this.lastRenderHash = decision.hash;
        if (decision.kind === 'skip') {
            return;
        }

        this.latestHtml = rendered.html;
        if (decision.kind === 'post') {
            this.panel.webview.postMessage(decision.message);
            // The html property still holds the pre-update document; mark it for flush on hide.
            this.htmlPropertyStale = true;
        } else {
            this.panel.webview.html = decision.html;
            this.htmlPropertyStale = false;
        }
    }
}

// fnv1a, mirrored from ContentLoader in src/util/loader/loader.ts (private there).
export function hashHtml(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 16777619) >>> 0;
    }
    return h;
}

// Replace the webview HTML only when there is no prior render or the hash changed.
export function shouldReplaceHtml(lastHash: number | undefined, newHash: number): boolean {
    return lastHash === undefined || lastHash !== newHash;
}
