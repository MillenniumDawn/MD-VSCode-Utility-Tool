import * as vscode from 'vscode';
export declare function registerGfxIndex(): vscode.Disposable;
export declare function getGfxContainerFile(gfxName: string | undefined): Promise<string | undefined>;
export declare function getGfxContainerFiles(gfxNames: (string | undefined)[]): Promise<string[]>;
