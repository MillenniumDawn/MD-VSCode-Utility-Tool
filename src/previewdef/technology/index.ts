import { localize } from '../../util/i18n';
import { renderTechnologyFile } from './contentbuilder';
import { definePreview } from '../definition';
import { loaderPreview } from '../loaderpreview';
import { TechnologyTreeLoader } from './loader';
import { technologyCountryOption } from './countryicons';
import { getDocumentByUri } from '../../util/vsccommon';

// technologyCountryIcons decides whether there is a country dropdown at all and whether
// the loader builds the lists behind it; gfxIndex decides whether those lists can be read
// and whether the dropdown's warning shows; technologyGfxRoots changes which gfx files the
// icons resolve against; localisationIndex and previewLocalisation change every label and
// the name-mode warning.
class TechnologyTreePreview extends loaderPreview(TechnologyTreeLoader, renderTechnologyFile, [
    'technologyCountryIcons',
    'technologyGfxRoots',
    'gfxIndex',
    'localisationIndex',
    'previewLocalisation',
]) {
    // The tree is rendered on this side, so picking a country is not something the page can apply on
    // its own. Re-render once the choice is stored -- the render reads it back from there -- and let
    // it go out as an in-place update, so zoom, scroll, the selected folder and the name mode all
    // survive the change.
    protected override async onPreviewOptionSet(key: string, value: unknown): Promise<void> {
        await super.onPreviewOptionSet(key, value);
        if (key !== technologyCountryOption) {
            return;
        }

        const document = getDocumentByUri(this.uri);
        if (document) {
            await this.onDocumentChange(document);
        }
    }
}

export const technologyPreviewDef = definePreview({
    type: 'technology',
    displayName: () => localize('preview.type.technology', 'Technology tree (common/technologies/*.txt)'),
    previewConstructor: TechnologyTreePreview,
});
