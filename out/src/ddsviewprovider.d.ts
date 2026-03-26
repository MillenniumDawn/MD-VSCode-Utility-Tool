/// <reference types="node" />
/// <reference types="node" />
import * as vscode from 'vscode';
import { PNG } from 'pngjs';
declare abstract class CommonViewProvider implements vscode.CustomReadonlyEditorProvider {
    openCustomDocument(uri: vscode.Uri): Promise<{
        uri: vscode.Uri;
        dispose: () => void;
    }>;
    resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void>;
    protected abstract onOpen(): void;
    protected abstract getPng(buffer: Buffer): PNG;
}
export declare class DDSViewProvider extends CommonViewProvider {
    protected onOpen(): void;
    protected getPng(buffer: Buffer): PNG;
}
export declare class TGAViewProvider extends CommonViewProvider {
    protected onOpen(): void;
    protected getPng(buffer: Buffer): PNG;
}
export {};
