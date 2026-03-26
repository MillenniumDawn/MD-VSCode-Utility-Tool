import * as vscode from 'vscode';
import { EventsLoader } from './loader';
export declare function renderEventFile(loader: EventsLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
