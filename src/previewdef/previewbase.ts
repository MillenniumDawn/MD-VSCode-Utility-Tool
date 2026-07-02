import * as vscode from 'vscode';
import { localize } from '../util/i18n';
import { error, debug } from '../util/debug';
import { getDocumentByUri } from '../util/vsccommon';
import { isEqual } from 'lodash';
import { sendByMessage } from '../util/telemetry';
import { loadingShellHtml } from '../util/html';
import { openOrCopyHoiFile } from '../util/previewfileopener';

export abstract class PreviewBase {
    private cachedDependencies: string[] | undefined = undefined;

    private dependencyChangedEmitter = new vscode.EventEmitter<string[]>();
    public onDependencyChanged = this.dependencyChangedEmitter.event;

    private disposeEmitter = new vscode.EventEmitter<undefined>();
    public onDispose = this.disposeEmitter.event;

    private disposed = false;
    protected panelInitialized = false;

    constructor(
        readonly uri: vscode.Uri,
        readonly panel: vscode.WebviewPanel,
    ) {
        this.registerEvents(panel);
    }

    public async onDocumentChange(document: vscode.TextDocument): Promise<void> {
        try {
            if (!this.panelInitialized) {
                this.panel.webview.html = await this.getContent(document);
                this.panelInitialized = true;
            } else {
                await this.sendPartialUpdate(document);
            }
        } catch(e) {
            error(e);
        }
    }

    protected async sendPartialUpdate(document: vscode.TextDocument): Promise<void> {
        this.panel.webview.html = await this.getContent(document);
    }
    
    public dispose(): void {
        this.dependencyChangedEmitter.dispose();
        this.disposed = true;
        this.disposeEmitter.fire(undefined);
        this.disposeEmitter.dispose();
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    public async initializePanelContent(document: vscode.TextDocument): Promise<void> {
        this.panelInitialized = false;
        this.panel.webview.html = this.getLoadingShellHtml();
        await this.onDocumentChange(document);
    }

    protected getLoadingShellHtml(): string {
        return loadingShellHtml(localize('preview.loading', 'Loading preview...'));
    }

    protected registerEvents(panel: vscode.WebviewPanel): void {
        panel.webview.onDidReceiveMessage((msg) => {
            switch (msg.command) {
                case 'navigate':
                    if (msg.start !== undefined) {
                        if (msg.file === undefined) {
                            const document = getDocumentByUri(this.uri);
                            if (document === undefined) {
                                return;
                            }
        
                            vscode.window.showTextDocument(this.uri, {
                                selection: new vscode.Range(document.positionAt(msg.start), document.positionAt(msg.end)),
                                viewColumn: vscode.ViewColumn.One
                            });
                        } else {
                            this.openOrCopyFile(msg.file, msg.start, msg.end);
                        }
                    }
                    break;
                case 'telemetry':
                    sendByMessage(msg);
                    break;
                case 'reload':
                    this.reload();
                    break;
            }
        });
        
        panel.onDidDispose(() => {
            this.dispose();
        });
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
            viewColumn: vscode.ViewColumn.One,
            mustOpenFolderMessage: localize('preview.mustopenafolder', 'Must open a folder before opening "{0}".', file),
            selectFolderMessage: localize('preview.selectafolder', 'Select a folder to copy "{0}"', file),
            failedToOpenMessage: (errorMessage) => localize('preview.failedtoopen', 'Failed to open file "{0}": {1}.', file, errorMessage),
        });
    }

    protected reload() {
        const document = getDocumentByUri(this.uri);
        if (document === undefined) {
            return;
        }

        this.panelInitialized = false;
        this.onDocumentChange(document);
    }

    protected abstract getContent(document: vscode.TextDocument): Promise<string>;
}
