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

    // gfxIndex changes which sprites the window can draw; localisationIndex and
    // previewLocalisation change the text inside it.
    protected get reloadOnConfigurationChange(): readonly string[] {
        return ['gfxIndex', 'localisationIndex', 'previewLocalisation'];
    }
}

export const guiPreviewDef: PreviewProviderDef = {
    type: 'gui',
    canPreview: canPreviewGui,
    previewConstructor: GuiPreview,
};
