import * as vscode from 'vscode';
export declare class WorldMap {
    panel: vscode.WebviewPanel | undefined;
    private worldMapLoader;
    private worldMapDependencies;
    private cachedWorldMap;
    private lastRequestedExportUri;
    constructor(panel: vscode.WebviewPanel);
    initialize(): void;
    onDocumentChange: (uri: vscode.Uri) => void;
    dispose(): void;
    private renderWorldMap;
    private onMessage;
    private sendMapData;
    private progressReporter;
    private sendProvinceMapSummaryToWebview;
    private openFile;
    private sendDifferences;
    private fillMessageForItem;
    private postMessageToWebview;
    private requestExportMap;
    private exportMap;
}
