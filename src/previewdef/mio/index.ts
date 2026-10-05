import { localize } from '../../util/i18n';
import * as vscode from 'vscode';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { matchPathEnd } from '../../util/nodecommon';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';
import { copyTreeWarnings } from '../focustree/warningreport';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { error } from '../../util/debug';

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
        // The copy button posts the warnings of the organization on screen; the host writes the
        // clipboard, which a webview cannot reach reliably on its own.
        this.subscriptions.push(this.panel.webview.onDidReceiveMessage(msg => {
            if (msg?.command === 'copyWarnings') {
                const none = localize('miopreview.copywarnings.none', 'This organization has no warnings.');
                void copyTreeWarnings(msg, getRelativePathInWorkspace(this.uri), none).catch(error);
            }
        }));
    }

    // localisationIndex and previewLocalisation change every trait and organization name;
    // gfxIndex changes which trait icons resolve.
    protected override get reloadOnConfigurationChange(): readonly string[] {
        return ['localisationIndex', 'previewLocalisation', 'gfxIndex'];
    }
}

export const mioPreviewDef: PreviewProviderDef = {
    type: 'mio',
    displayName: () => localize('preview.type.mio', 'Military industrial organization (common/military_industrial_organization/organizations/*.txt)'),
    canPreview: canPreviewMio,
    previewConstructor: MioPreview,
};
