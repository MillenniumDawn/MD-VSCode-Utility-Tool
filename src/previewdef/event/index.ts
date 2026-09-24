import { localize } from '../../util/i18n';
import * as vscode from 'vscode';
import { renderEventFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { EventsLoader } from './loader';
import { eventTreePreview } from '../../util/featureflags';

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
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new EventsLoader(file, contentProvider), renderEventFile);
    }

    // previewLocalisation changes the text in the payload; localisationIndex changes whether
    // there is any text to show and so whether the localisation toggle is offered at all;
    // gfxIndex changes which pictures resolve, and so whether the picture toggle is.
    protected override get reloadOnConfigurationChange(): readonly string[] {
        return ['previewLocalisation', 'localisationIndex', 'gfxIndex'];
    }
}

export const eventPreviewDef: PreviewProviderDef = {
    type: 'event',
    displayName: () => localize('preview.type.event', 'Event tree (events/*.txt)'),
    isEnabled: () => eventTreePreview,
    canPreview: canPreviewEvent,
    previewConstructor: EventPreview,
};
