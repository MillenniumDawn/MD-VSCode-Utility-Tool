import * as vscode from 'vscode';
interface ContextContainer {
    current: vscode.ExtensionContext | null;
    contextValue: Record<string, unknown>;
}
export declare function registerContextContainer(context: vscode.ExtensionContext): vscode.Disposable;
export declare const contextContainer: ContextContainer;
export declare function setVscodeContext(key: string, value: unknown): void;
export {};
