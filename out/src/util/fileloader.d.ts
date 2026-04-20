import * as vscode from 'vscode';
import { SchemaDef, HOIPartial } from '../hoiformat/schema';
export declare function clearDlcZipCache(): Promise<void>;
export declare function getFilePathFromMod(relativePath: string): Promise<vscode.Uri | undefined>;
export declare function getFilePathFromModOrHOI4(relativePath: string, options?: {
    mod?: boolean;
    hoi4?: boolean;
}): Promise<vscode.Uri | undefined>;
export declare function isHoiFileOpened(path: vscode.Uri): boolean;
export declare function getHoiOpenedFileOriginalUri(path: vscode.Uri): vscode.Uri;
export declare function isHoiFileFromDlc(path: vscode.Uri): boolean;
export declare function getHoiDlcFileOriginalUri(path: vscode.Uri): {
    uri: vscode.Uri;
    entryPath: string;
};
export declare function hoiFileExpiryToken(relativePath: string): Promise<string>;
export declare function expiryToken(realPath: vscode.Uri | undefined): Promise<string>;
export declare function readFileFromPath(realPath: vscode.Uri, relativePath?: string): Promise<[Buffer, vscode.Uri]>;
export declare function readFileFromModOrHOI4(relativePath: string, options?: {
    mod?: boolean;
    hoi4?: boolean;
}): Promise<[Buffer, vscode.Uri]>;
export declare function readFileFromModOrHOI4AsJson<T>(relativePath: string, schema: SchemaDef<T>): Promise<HOIPartial<T>>;
export declare function listFilesFromModOrHOI4(relativePath: string, options?: {
    mod?: boolean;
    hoi4?: boolean;
    recursively?: boolean;
}): Promise<string[]>;
