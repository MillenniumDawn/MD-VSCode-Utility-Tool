import * as vscode from 'vscode';
import { FocusTree } from './schema';
import { Image } from '../../util/image/imagecache';
import { HOIPartial } from '../../hoiformat/schema';
import { GridBoxType } from '../../hoiformat/gui';
import { FocusTreeLoader } from './loader';
import { StyleTable } from '../../util/styletable';
export interface FocusTreeUpdatePayload {
    focusTrees: FocusTree[];
    renderedFocus: Record<string, string>;
    renderedInlayWindows: Record<string, string>;
    gridBox: HOIPartial<GridBoxType>;
    useConditionInFocus: boolean;
    xGridSize: number;
}
export interface FocusTreePayload extends FocusTreeUpdatePayload {
    styleTable: StyleTable;
    styleNonce: string;
    toolbarFlags: ToolbarFlags;
    cssFingerprint: string;
}
export type { ToolbarFlags };
export declare function buildFocusTreePayload(loader: FocusTreeLoader): Promise<FocusTreePayload | null>;
export declare function renderFocusTreeFile(loader: FocusTreeLoader, uri: vscode.Uri, webview: vscode.Webview): Promise<string>;
interface ToolbarFlags {
    hasCustomTitlebar: boolean;
    hasFocusOverlay: boolean;
    hasInlayWindows: boolean;
}
export declare function getFocusIcon(name: string, gfxFiles: string[]): Promise<Image | undefined>;
