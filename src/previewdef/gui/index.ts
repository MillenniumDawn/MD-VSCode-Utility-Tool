import { localize } from '../../util/i18n';
import { definePreview } from '../definition';
import { loaderPreview } from '../loaderpreview';
import { GuiFileLoader } from './loader';
import { renderGuiFile } from './contentbuilder';

export const guiPreviewDef = definePreview({
    type: 'gui',
    displayName: () => localize('preview.type.gui', 'Interface window (*.gui)'),
    // gfxIndex changes which sprites the window can draw; localisationIndex and
    // previewLocalisation change the text inside it.
    previewConstructor: loaderPreview(GuiFileLoader, renderGuiFile, ['gfxIndex', 'localisationIndex', 'previewLocalisation']),
});
