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
            await this.sendPartialUpdate(document);
        }
    }
}

export const technologyPreviewDef: PreviewProviderDef = {
    type: 'technology',
    canPreview: canPreviewTechnology,
    previewConstructor: TechnologyTreePreview,
};
