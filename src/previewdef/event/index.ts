import { localize } from '../../util/i18n';
import { renderEventFile } from './contentbuilder';
import { definePreview } from '../definition';
import { loaderPreview } from '../loaderpreview';
import { EventsLoader } from './loader';

export const eventPreviewDef = definePreview({
    type: 'event',
    displayName: () => localize('preview.type.event', 'Event tree (events/*.txt)'),
    // previewLocalisation changes the text in the payload; localisationIndex changes whether
    // there is any text to show and so whether the localisation toggle is offered at all;
    // gfxIndex changes which pictures resolve, and so whether the picture toggle is.
    previewConstructor: loaderPreview(EventsLoader, renderEventFile, ['previewLocalisation', 'localisationIndex', 'gfxIndex']),
});
