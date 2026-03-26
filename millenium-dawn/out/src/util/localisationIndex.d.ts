import * as vscode from 'vscode';
export declare function registerLocalisationIndex(): vscode.Disposable;
export declare function getLocalisedTextQuick(localisationKey: string | undefined): Promise<string | undefined>;
export declare function getLocalisedText(localisationKey: string | undefined, language: string): Promise<string | undefined>;
