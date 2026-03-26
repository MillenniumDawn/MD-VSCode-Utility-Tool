/// <reference types="node" />
/// <reference types="node" />
import * as vscode from 'vscode';
export declare function getConfiguration(): vscode.WorkspaceConfiguration & {
    readonly installPath: string;
    readonly loadDlcContents: boolean;
    readonly modFile: string;
    readonly featureFlags: string[];
    readonly enableSupplyArea: boolean;
    readonly previewLocalisation: "Brazilian Portuguese" | "Simplified Chinese" | "English" | "French" | "German" | "Japanese" | "Polish" | "Russian" | "Spanish";
    readonly inlayWindowGfxRoots: string[];
};
export declare function getDocumentByUri(uri: vscode.Uri): vscode.TextDocument | undefined;
export declare function getRelativePathInWorkspace(uri: vscode.Uri): string;
export declare function isFileScheme(uri: vscode.Uri): boolean;
export declare function ensureFileScheme(uri: vscode.Uri): void;
export declare function isSameUri(uriA: vscode.Uri, uriB: vscode.Uri): boolean;
export declare function getLastModifiedAsync(path: vscode.Uri): Promise<number>;
export declare function readDir(dir: vscode.Uri): Promise<string[]>;
export declare function readDirFiles(dir: vscode.Uri): Promise<string[]>;
export declare function readDirFilesRecursively(dir: vscode.Uri): Promise<string[]>;
export declare function readFile(path: vscode.Uri): Promise<Buffer>;
export declare function writeFile(path: vscode.Uri, buffer: Buffer): Promise<void>;
export declare function mkdirs(path: vscode.Uri): Promise<void>;
export declare function isFile(path: vscode.Uri): Promise<boolean>;
export declare function isDirectory(path: vscode.Uri): Promise<boolean>;
export declare function dirUri(uri: vscode.Uri): vscode.Uri;
export declare function basename(uri: vscode.Uri, ext?: string): string;
export declare function fileOrUriStringToUri(path: string): vscode.Uri | undefined;
export declare function uriToFilePathWhenPossible(uri: vscode.Uri): string;
export declare function getLanguageIdInYml(): string;
