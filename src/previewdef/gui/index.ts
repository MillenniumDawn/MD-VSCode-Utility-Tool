import * as vscode from 'vscode';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { GuiFileLoader } from './loader';
import { renderGuiFile } from './contentbuilder';

function canPreviewGui(document: vscode.TextDocument) {
    const uri = document.uri;
    return uri.path.toLowerCase().endsWith('.gui') ? 0 : undefined;
}

class GuiPreview extends LoaderPreview<GuiFileLoader> {
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new GuiFileLoader(file, contentProvider), renderGuiFile);
    }
}

export const guiPreviewDef: PreviewProviderDef = {
    type: 'gui',
    canPreview: canPreviewGui,
    previewConstructor: GuiPreview,
};
