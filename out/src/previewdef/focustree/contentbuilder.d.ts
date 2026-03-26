import * as vscode from 'vscode';
import { Image } from '../../util/image/imagecache';
import { FocusTreeLoader } from './loader';
export declare function renderFocusTreeFile(loader: FocusTreeLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
export declare function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined>;
