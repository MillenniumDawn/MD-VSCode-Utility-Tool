import * as vscode from 'vscode';
import { TechnologyTreeLoader } from './loader';
export declare function renderTechnologyFile(loader: TechnologyTreeLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
