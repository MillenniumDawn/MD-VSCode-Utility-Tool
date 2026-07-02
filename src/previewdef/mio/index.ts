import * as vscode from 'vscode';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { matchPathEnd } from '../../util/nodecommon';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';

function canPreviewMio(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'military_industrial_organization', 'organizations', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    return undefined;
}

class MioPreview extends LoaderPreview<MioLoader> {
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new MioLoader(file, contentProvider), renderMioFile);
    }
}

export const mioPreviewDef: PreviewProviderDef = {
    type: 'mio',
    canPreview: canPreviewMio,
    previewConstructor: MioPreview,
};
