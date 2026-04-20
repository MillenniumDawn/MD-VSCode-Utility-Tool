import * as vscode from 'vscode';
import { PromiseCache } from './cache';
export declare const modFileStatusContainer: {
    current: vscode.StatusBarItem | null;
};
export declare const workspaceModFilesCache: PromiseCache<vscode.Uri[]>;
export declare function registerModFile(): vscode.Disposable;
export declare function updateSelectedModFileStatus(modFile: vscode.Uri | undefined, error?: boolean): void;
