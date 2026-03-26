import * as vscode from "vscode";
export type Dependency = {
    type: string;
    path: string;
};
export declare function getDependenciesFromText(text: string): Dependency[];
export declare function registerScanReferencesCommand(): vscode.Disposable;
