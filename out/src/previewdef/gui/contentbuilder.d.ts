import * as vscode from 'vscode';
import { GuiFileLoader } from "./loader";
export declare function renderGuiFile(loader: GuiFileLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
