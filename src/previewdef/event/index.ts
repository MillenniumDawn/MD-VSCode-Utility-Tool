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
            // previewLocalisation changes the text in the payload; localisationIndex changes whether
            // there is any text to show and so whether the localisation toggle is offered at all;
            // gfxIndex changes which pictures resolve, and so whether the picture toggle is.
            //
            // registerFeatureFlags subscribes to this same event during activation, long before any
            // preview exists, and VS Code fires listeners in subscription order -- so the module
            // flags graph.ts reads are already refreshed by the time this runs.
            if (e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`) ||
                e.affectsConfiguration(`${ConfigurationKey}.localisationIndex`) ||
                e.affectsConfiguration(`${ConfigurationKey}.gfxIndex`)) {
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
