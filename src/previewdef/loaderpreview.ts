import * as vscode from 'vscode';
import { PreviewBase } from './previewbase';
import { Loader } from '../util/loader/loader';
import { getRelativePathInWorkspace } from '../util/vsccommon';

// Shared base for the event/gui/mio/technology previews. They only differ in which
// loader they build and which render function turns it into HTML, so the constructor
// wiring and the getContent template live here once.
//
// sendPartialUpdate hashes the freshly rendered HTML and skips reassigning
// panel.webview.html when it matches the last render. A webview.html assignment tears
// the page down and rebuilds it (blank flash, lost scroll), so on a debounced edit that
// produces identical output we now do nothing instead.
export abstract class LoaderPreview<TLoader extends Loader<unknown, unknown>> extends PreviewBase {
    private readonly loader: TLoader;
    private content: string | undefined;
    private lastHtmlHash: number | undefined = undefined;

    constructor(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        createLoader: (file: string, contentProvider: () => Promise<string>) => TLoader,
        private readonly render: (loader: TLoader, uri: vscode.Uri, webview: vscode.Webview) => Promise<string>,
    ) {
        super(uri, panel);
        this.loader = createLoader(getRelativePathInWorkspace(this.uri), () => Promise.resolve(this.content ?? ''));
        this.loader.onLoadDone(r => this.updateDependencies(r.dependencies));
    }

    protected async getContent(document: vscode.TextDocument): Promise<string> {
        this.content = document.getText();
        const result = await this.render(this.loader, document.uri, this.panel.webview);
        this.content = undefined;
        this.lastHtmlHash = hashHtml(result);
        return result;
    }

    protected async sendPartialUpdate(document: vscode.TextDocument): Promise<void> {
        this.content = document.getText();
        const html = await this.render(this.loader, document.uri, this.panel.webview);
        this.content = undefined;

        const hash = hashHtml(html);
        if (!shouldReplaceHtml(this.lastHtmlHash, hash)) {
            return;
        }
        this.lastHtmlHash = hash;
        this.panel.webview.html = html;
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
