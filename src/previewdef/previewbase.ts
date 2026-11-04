import type * as vscode from 'vscode';
import { host } from '../util/host';
import { localize } from '../util/i18n';
import { error, debug } from '../util/debug';
import { getDocumentByUri } from '../util/vsccommon';
import isEqual from 'lodash/isEqual';
import { isOffset, isOptionalOffset, isOptionalString, isRecord } from '../util/messageguards';
import { loadingShellHtml } from '../util/html';
import { openOrCopyHoiFile } from '../util/previewfileopener';
import { setPreviewOption } from '../util/previewoptions';
import { ConfigurationKey } from '../constants';
import { waitForRenderAck } from './renderack';

// One render request waiting to start: the document of the latest request in the group, whether
// any request in the group saw a dependency change, and the promise every caller settles with.
interface PendingChange {
    document: vscode.TextDocument;
    dependencyChanged: boolean;
    promise: Promise<void>;
}

export abstract class PreviewBase {
    private cachedDependencies: string[] | undefined = undefined;

    private dependencyChangedEmitter = new (host().EventEmitter)<string[]>();
    public onDependencyChanged = this.dependencyChangedEmitter.event;

    private disposeEmitter = new (host().EventEmitter)<undefined>();
    public onDispose = this.disposeEmitter.event;

    private disposed = false;
    // Everything subscribed on the panel. Released in dispose() so a closed panel stops holding
    // the preview (and its cached dependencies) through its emitters.
    protected readonly subscriptions: vscode.Disposable[] = [];
    protected panelInitialized = false;
    // Renders run one at a time, so a slow render can never land after a newer one and overwrite
    // it. A queued render reads the live document when it starts. Issue #670: the queue is also
    // bounded -- ordinary changes collapse into the single pending render below instead of one
    // task being enqueued per delivered change.
    private renderQueue: Promise<void> = Promise.resolve();
    // The render a group of ordinary change requests collapsed into, still waiting to start.
    private pendingChange: PendingChange | undefined;
    // An explicit full render (initializePanelContent, reload) that is queued but not started. A
    // change arriving while one is queued joins it instead of scheduling a partial update behind
    // it, so the render that eventually runs stays a full render.
    private pendingFullRender: PendingChange | undefined;
    private browserSmokeRenderedIds: string[] | undefined;
    private browserSmokeWaiter: ((ids: string[]) => void) | undefined;

    constructor(
        readonly uri: vscode.Uri,
        readonly panel: vscode.WebviewPanel,
        protected readonly browserSmoke = false,
    ) {
        this.registerEvents(panel);
    }

    public onDocumentChange(document: vscode.TextDocument, dependencyChanged = false): Promise<void> {
        // A full render is queued but not started: join it. It renders this document anyway, and a
        // partial update behind it would pay for a second render of the same state.
        if (this.pendingFullRender !== undefined) {
            this.pendingFullRender.document = document;
            this.pendingFullRender.dependencyChanged ||= dependencyChanged;
            return this.pendingFullRender.promise;
        }
        // First request of its group: it becomes the one pending render. Later requests join it
        // and settle with its promise; nothing further is enqueued while it waits.
        if (this.pendingChange === undefined) {
            const promise = this.renderQueue.then(() => this.runPendingChange());
            this.renderQueue = promise.catch(() => undefined);
            this.pendingChange = { document, dependencyChanged, promise };
            return promise;
        }
        this.pendingChange.document = document;
        this.pendingChange.dependencyChanged ||= dependencyChanged;
        return this.pendingChange.promise;
    }

    // Starts the render the pending group of change requests collapsed into.
    private async runPendingChange(): Promise<void> {
        const pending = this.pendingChange;
        this.pendingChange = undefined;
        // Consumed either way: after dispose the pending render must not start.
        if (pending === undefined || this.isDisposed) {
            return;
        }
        await this.renderDocument(pending.document, pending.dependencyChanged);
    }

    protected enqueueRender(task: () => Promise<void>): Promise<void> {
        const run = this.renderQueue.then(task);
        this.renderQueue = run.catch(() => undefined);
        return run;
    }

    private async renderDocument(document: vscode.TextDocument, dependencyChanged: boolean, throwOnError = false): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        try {
            if (!this.panelInitialized) {
                const html = await this.getContent(document, dependencyChanged);
                if (this.isDisposed) {
                    return;
                }
                this.panel.webview.html = html;
                this.panelInitialized = true;
            } else {
                await this.sendPartialUpdate(document, dependencyChanged);
            }
        } catch(e) {
            error(e);
            if (throwOnError) {
                throw e;
            }
        }
    }

    protected async sendPartialUpdate(document: vscode.TextDocument, _dependencyChanged = false): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        const html = await this.getContent(document);
        if (this.isDisposed) {
            return;
        }
        this.panel.webview.html = html;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        host().Disposable.from(...this.subscriptions).dispose();
        this.subscriptions.length = 0;
        this.dependencyChangedEmitter.dispose();
        this.disposed = true;
        this.disposeEmitter.fire(undefined);
        this.disposeEmitter.dispose();
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    // Schedules an explicit full render: initializePanelContent and reload. Ordinary changes that
    // arrive while it is queued join it instead of scheduling a partial update behind it, so a
    // coalescing change never demotes a requested full render, and every caller in the group
    // settles with the full render's promise.
    private scheduleFullRender(
        document: vscode.TextDocument,
        dependencyChanged: boolean,
        run: (document: vscode.TextDocument, dependencyChanged: boolean) => Promise<void>,
    ): Promise<void> {
        const pending: PendingChange = { document, dependencyChanged, promise: Promise.resolve() };
        const promise = this.renderQueue.then(() => {
            // A later full render queued behind this one owns the record; this task still renders
            // with what was joined into it before it started.
            if (this.pendingFullRender === pending) {
                this.pendingFullRender = undefined;
            }
            if (this.isDisposed) {
                return;
            }
            return run(pending.document, pending.dependencyChanged);
        });
        this.renderQueue = promise.catch(() => undefined);
        pending.promise = promise;
        this.pendingFullRender = pending;
        return promise;
    }

    public initializePanelContent(document: vscode.TextDocument): Promise<void> {
        return this.scheduleFullRender(document, false, (latest, dependencyChanged) => {
            if (this.isDisposed) {
                return Promise.resolve();
            }
            this.panelInitialized = false;
            this.panel.webview.html = this.getLoadingShellHtml();
            return this.renderDocument(latest, dependencyChanged, this.browserSmoke);
        });
    }

    protected getLoadingShellHtml(): string {
        return loadingShellHtml(localize('preview.loading', 'Loading preview...'));
    }

    /**
     * Settings whose change makes this preview's rendered page stale, without the `mdHoi4Utilities.`
     * prefix. A getter rather than a field: registerEvents runs from the constructor, before a
     * subclass's field initializers have, and a field would still be undefined there.
     */
    protected get reloadOnConfigurationChange(): readonly string[] {
        return [];
    }

    /**
     * Whether a configuration-driven reload has to force the loader session. Almost always yes: a
     * setting change does not move the document's hash, so without it the loader answers from its
     * cache and the page repaints exactly what it had. A preview that reads its settings while
     * rendering, rather than through a loader, can leave this false.
     */
    protected get configurationChangeForcesReload(): boolean {
        return true;
    }

    protected registerEvents(panel: vscode.WebviewPanel): void {
        // The page is the extension's own, but its messages are still input: the shape is
        // checked here, once, so nothing below reads a field it did not verify.
        this.subscriptions.push(panel.webview.onDidReceiveMessage((msg: unknown) => {
            if (!isRecord(msg)) {
                return;
            }
            switch (msg.command) {
                case 'browserSmokeRendered':
                    if (this.browserSmoke && Array.isArray(msg.ids) && msg.ids.every((id) => typeof id === 'string')) {
                        this.browserSmokeRenderedIds = msg.ids;
                        this.browserSmokeWaiter?.(msg.ids);
                        this.browserSmokeWaiter = undefined;
                    }
                    break;
                case 'navigate':
                    if (isOffset(msg.start) && isOptionalOffset(msg.end) && isOptionalString(msg.file)) {
                        if (msg.file === undefined) {
                            const document = getDocumentByUri(this.uri);
                            if (document === undefined) {
                                return;
                            }

                            void host().window.showTextDocument(this.uri, {
                                selection: new (host().Range)(document.positionAt(msg.start), document.positionAt(msg.end ?? msg.start)),
                                viewColumn: host().ViewColumn.One
                            });
                        } else {
                            void this.openOrCopyFile(msg.file, msg.start, msg.end);
                        }
                    }
                    break;
                case 'reload':
                    this.reload();
                    break;
                // A toolbar toggle the reader flipped. Held on this side because the webview's own
                // state dies with the panel; see previewoptions.ts.
                case 'setPreviewOption':
                    if (typeof msg.key === 'string') {
                        void this.onPreviewOptionSet(msg.key, msg.value);
                    }
                    break;
            }
        }));

        this.subscriptions.push(panel.onDidDispose(() => {
            this.dispose();
        }));

        // registerFeatureFlags subscribes to this same event during activation, long before any
        // preview exists, and VS Code fires listeners in subscription order -- so the module flags
        // a render reads are already refreshed by the time this runs.
        const keys = this.reloadOnConfigurationChange;
        if (keys.length > 0) {
            this.subscriptions.push(host().workspace.onDidChangeConfiguration(e => {
                if (keys.some(key => e.affectsConfiguration(`${ConfigurationKey}.${key}`))) {
                    this.reload(this.configurationChangeForcesReload);
                }
            }));
        }
    }

    /** Wait for the opt-in browser smoke's post-DOM-mount acknowledgement. */
    public waitForBrowserSmokeRender(timeoutMs = 10000): Promise<string[]> {
        if (!this.browserSmoke) {
            return Promise.reject(new Error('Browser smoke render acknowledgement was not enabled'));
        }
        if (this.browserSmokeRenderedIds !== undefined) {
            return Promise.resolve(this.browserSmokeRenderedIds);
        }
        const ack = new Promise<string[]>((resolve) => {
            this.browserSmokeWaiter = resolve;
        });
        return waitForRenderAck(ack, timeoutMs).finally(() => {
            this.browserSmokeWaiter = undefined;
        });
    }

    /**
     * Persists a toolbar option the page just changed. Most previews draw the option themselves and
     * need nothing more; one whose content is rendered on this side overrides this to re-render
     * after the write, which is why the write is awaited rather than fired and forgotten.
     */
    protected async onPreviewOptionSet(key: string, value: unknown): Promise<void> {
        await setPreviewOption(key, value);
    }

    protected updateDependencies(dependencies: string[]): void {
        if (this.cachedDependencies === undefined || !isEqual(this.cachedDependencies, dependencies)) {
            this.dependencyChangedEmitter.fire(dependencies);
            debug("dependencies: ", this.uri.toString(), JSON.stringify(dependencies));
        }

        this.cachedDependencies = dependencies;
    }

    protected async openOrCopyFile(file: string, start: number | undefined, end: number | undefined): Promise<void> {
        await openOrCopyHoiFile(file, start, end, {
            viewColumn: host().ViewColumn.One,
            mustOpenFolderMessage: localize('preview.mustopenafolder', 'Must open a folder before opening "{0}".', file),
            selectFolderMessage: localize('preview.selectafolder', 'Select a folder to copy "{0}"', file),
            failedToOpenMessage: (errorMessage) => localize('preview.failedtoopen', 'Failed to open file "{0}": {1}.', file, errorMessage),
        });
    }

    // `dependencyChanged` forces the loader session the re-render runs in. A reload triggered by
    // something other than the document -- a setting change -- does not move the document's hash, so
    // without it a loader answers from its cache and the page repaints exactly what it had.
    protected reload(dependencyChanged = false) {
        const document = getDocumentByUri(this.uri);
        if (document === undefined) {
            return;
        }

        // The reset runs inside the queue: set now, a render in flight would set it back on
        // finishing and this full reload would go out as a partial update.
        void this.scheduleFullRender(document, dependencyChanged, (latest, dependencyChanged) => {
            this.panelInitialized = false;
            return this.renderDocument(latest, dependencyChanged);
        });
    }

    protected abstract getContent(document: vscode.TextDocument, dependencyChanged?: boolean): Promise<string>;
}
