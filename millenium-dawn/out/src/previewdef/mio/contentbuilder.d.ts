import * as vscode from 'vscode';
import { Image } from '../../util/image/imagecache';
import { MioLoader } from './loader';
export declare function renderMioFile(loader: MioLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
export declare function getTraitIcon(name: string, gfxFiles: string[]): Promise<Image | undefined>;
