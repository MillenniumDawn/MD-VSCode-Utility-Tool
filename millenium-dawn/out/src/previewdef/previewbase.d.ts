import * as vscode from 'vscode';
export declare abstract class PreviewBase {
    readonly uri: vscode.Uri;
    readonly panel: vscode.WebviewPanel;
    private cachedDependencies;
    private dependencyChangedEmitter;
    onDependencyChanged: vscode.Event<string[]>;
    private disposeEmitter;
    onDispose: vscode.Event<undefined>;
    private disposed;
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel);
    onDocumentChange(document: vscode.TextDocument): Promise<void>;
    dispose(): void;
    get isDisposed(): boolean;
    initializePanelContent(document: vscode.TextDocument): Promise<void>;
    protected registerEvents(panel: vscode.WebviewPanel): void;
    protected updateDependencies(dependencies: string[]): void;
    protected openOrCopyFile(file: string, start: number | undefined, end: number | undefined): Promise<void>;
    protected reload(): void;
    protected abstract getContent(document: vscode.TextDocument): Promise<string>;
}
