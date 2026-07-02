import * as vscode from 'vscode';
import { renderEventFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { EventsLoader } from './loader';
import { eventTreePreview } from '../../util/featureflags';
import { ConfigurationKey } from '../../constants';

function canPreviewEvent(document: vscode.TextDocument) {
    if (!eventTreePreview) {
        return undefined;
    }

    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['events', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    const text = document.getText();
    return /(country_event|news_event|unit_leader_event|state_event|operative_leader_event)\s*=\s*{/.exec(text)?.index;
}

class EventPreview extends LoaderPreview<EventsLoader> {
    private configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new EventsLoader(file, contentProvider), renderEventFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)) {
                this.reload();
            }
        });
    }

    public dispose(): void {
        super.dispose();
        this.configurationHandler.dispose();
    }
}

export const eventPreviewDef: PreviewProviderDef = {
    type: 'event',
    canPreview: canPreviewEvent,
    previewConstructor: EventPreview,
};
