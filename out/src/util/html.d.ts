import * as vscode from 'vscode';
import { StyleTable } from './styletable';
export interface DynamicScript {
    content: string;
}
export interface NonceOnly {
    nonce: string;
}
export declare function html(webview: vscode.Webview, body: string, scripts: (string | DynamicScript)[], styles?: (string | StyleTable | DynamicScript | NonceOnly)[]): string;
export declare function htmlEscape(unsafe: string): string;
