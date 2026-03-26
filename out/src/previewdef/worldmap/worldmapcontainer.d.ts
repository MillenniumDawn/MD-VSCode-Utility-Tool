import * as vscode from 'vscode';
export declare class WorldMapContainer implements vscode.WebviewPanelSerializer {
    private worldMap;
    register(): vscode.Disposable;
    openPreview(): Promise<void>;
    deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any): Promise<void>;
    private openWorldMapView;
    private onChangeTextDocument;
    private onCloseTextDocument;
}
