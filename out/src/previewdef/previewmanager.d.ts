import * as vscode from 'vscode';
import { PreviewBase } from './previewbase';
export type PreviewProviderDef = PreviewProviderDefNormal | PreviewProviderDefAlternative;
interface PreviewProviderDefNormal {
    type: string;
    canPreview(document: vscode.TextDocument): number | undefined;
    previewContructor: new (uri: vscode.Uri, panel: vscode.WebviewPanel) => PreviewBase;
}
interface PreviewProviderDefAlternative {
    type: string;
    canPreview(document: vscode.TextDocument): number | undefined;
    onPreview(document: vscode.TextDocument): Promise<void>;
}
export declare class PreviewManager implements vscode.WebviewPanelSerializer {
    private _previews;
    private _previewProviders;
    private _previewProvidersMap;
    private _updateSubscriptions;
    register(): vscode.Disposable;
    deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any): Promise<void>;
    private showPreview;
    private onCloseTextDocument;
    private onChangeTextDocument;
    private updateHoi4PreviewContextValue;
    private showPreviewImpl;
    private findPreviewProvider;
    private addPreviewToSubscription;
    private removePreviewFromSubscription;
    private getPreviewItemsNeedsUpdate;
    private updatePreviewItemsInSubscription;
    private updatePreviewItem;
}
export declare const previewManager: PreviewManager;
export {};
