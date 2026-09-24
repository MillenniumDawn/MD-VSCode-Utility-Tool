import { localize } from '../../util/i18n';
import * as vscode from 'vscode';
import { renderTechnologyFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { TechnologyTreeLoader } from './loader';
import { technologyCountryOption } from './countryicons';
import { getDocumentByUri } from '../../util/vsccommon';

function canPreviewTechnology(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'technologies', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    const text = document.getText();
    return /(technologies)\s*=\s*{/.exec(text)?.index;
}

class TechnologyTreePreview extends LoaderPreview<TechnologyTreeLoader> {
    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new TechnologyTreeLoader(file, contentProvider), renderTechnologyFile);
    }

    // technologyCountryIcons decides whether there is a country dropdown at all and whether
    // the loader builds the lists behind it; gfxIndex decides whether those lists can be read
    // and whether the dropdown's warning shows; technologyGfxRoots changes which gfx files the
    // icons resolve against; localisationIndex and previewLocalisation change every label and
    // the name-mode warning.
    protected get reloadOnConfigurationChange(): readonly string[] {
        return [
            'technologyCountryIcons',
            'technologyGfxRoots',
            'gfxIndex',
            'localisationIndex',
            'previewLocalisation',
        ];
    }

    // The tree is rendered on this side, so picking a country is not something the page can apply on
    // its own. Re-render once the choice is stored -- the render reads it back from there -- and let
    // it go out as an in-place update, so zoom, scroll, the selected folder and the name mode all
    // survive the change.
    protected async onPreviewOptionSet(key: string, value: unknown): Promise<void> {
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

export const technologyPreviewDef: PreviewProviderDef = {
    type: 'technology',
    displayName: () => localize('preview.type.technology', 'Technology tree (common/technologies/*.txt)'),
    canPreview: canPreviewTechnology,
    previewConstructor: TechnologyTreePreview,
};
