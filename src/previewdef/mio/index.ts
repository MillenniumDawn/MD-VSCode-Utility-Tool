import { localize } from '../../util/i18n';
import type * as vscode from 'vscode';
import { definePreview } from '../definition';
import { loaderPreview } from '../loaderpreview';
import { MioLoader } from './loader';
import { renderMioFile } from './contentbuilder';
import { copyTreeWarnings } from '../focustree/warningreport';
import { getRelativePathInWorkspace } from '../../util/vsccommon';
import { error } from '../../util/debug';

// localisationIndex and previewLocalisation change every trait and organization name;
// gfxIndex changes which trait icons resolve.
class MioPreview extends loaderPreview(MioLoader, renderMioFile, ['localisationIndex', 'previewLocalisation', 'gfxIndex']) {
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel);
        // The copy button posts the warnings of the organization on screen; the host writes the
        // clipboard, which a webview cannot reach reliably on its own.
        this.subscriptions.push(this.panel.webview.onDidReceiveMessage(msg => {
            if (msg?.command === 'copyWarnings') {
                const none = localize('miopreview.copywarnings.none', 'This organization has no warnings.');
                void copyTreeWarnings(msg, getRelativePathInWorkspace(this.uri), none).catch(error);
            }
        }));
    }
}

export const mioPreviewDef = definePreview({
    type: 'mio',
    displayName: () => localize('preview.type.mio', 'Military industrial organization (common/military_industrial_organization/organizations/*.txt)'),
    previewConstructor: MioPreview,
});
