import * as vscode from 'vscode';
import { renderTechnologyFile } from './contentbuilder';
import { matchPathEnd } from '../../util/nodecommon';
import { PreviewProviderDef } from '../previewmanager';
import { LoaderPreview } from '../loaderpreview';
import { TechnologyTreeLoader } from './loader';
import { technologyCountryOption } from './countryicons';
import { getDocumentByUri } from '../../util/vsccommon';
import { ConfigurationKey } from '../../constants';

function canPreviewTechnology(document: vscode.TextDocument) {
    const uri = document.uri;
    if (matchPathEnd(uri.toString().toLowerCase(), ['common', 'technologies', '*']) && uri.path.toLowerCase().endsWith('.txt')) {
        return 0;
    }

    const text = document.getText();
    return /(technologies)\s*=\s*{/.exec(text)?.index;
}

class TechnologyTreePreview extends LoaderPreview<TechnologyTreeLoader> {
    private configurationHandler: vscode.Disposable;

    constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
        super(uri, panel, (file, contentProvider) => new TechnologyTreeLoader(file, contentProvider), renderTechnologyFile);
        this.configurationHandler = vscode.workspace.onDidChangeConfiguration(e => {
            // technologyCountryIcons decides whether there is a country dropdown at all and whether
            // the loader builds the lists behind it; gfxIndex decides whether those lists can be read
            // and whether the dropdown's warning shows; technologyGfxRoots changes which gfx files the
            // icons resolve against; localisationIndex and previewLocalisation change every label and
            // the name-mode warning.
            //
            // All of those are settled either in the baseline html, which an in-place update cannot
            // patch, or inside the loader's postLoad -- which answers from a cache keyed on this
            // document's content, and a setting change does not move that. So a full reload, forced.
            if (e.affectsConfiguration(`${ConfigurationKey}.technologyCountryIcons`) ||
                e.affectsConfiguration(`${ConfigurationKey}.technologyGfxRoots`) ||
                e.affectsConfiguration(`${ConfigurationKey}.gfxIndex`) ||
                e.affectsConfiguration(`${ConfigurationKey}.localisationIndex`) ||
                e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`)) {
                this.reload(true);
            }
        });
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

    public dispose(): void {
        super.dispose();
        this.configurationHandler.dispose();
    }
}

export const technologyPreviewDef: PreviewProviderDef = {
    type: 'technology',
    canPreview: canPreviewTechnology,
    previewConstructor: TechnologyTreePreview,
};
