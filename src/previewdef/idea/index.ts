import * as vscode from "vscode";
import { renderIdeaFile } from "./contentbuilder";
import { matchPathEnd } from "../../util/nodecommon";
import { PreviewProviderDef } from "../previewmanager";
import { LoaderPreview } from "../loaderpreview";
import { IdeasLoader } from "./loader";
import { ideaPreview } from "../../util/featureflags";
import { ConfigurationKey } from "../../constants";

function canPreviewIdea(document: vscode.TextDocument) {
	if (!ideaPreview) {
		return undefined;
	}

	const uri = document.uri;
	if (
		matchPathEnd(uri.toString().toLowerCase(), ["common", "ideas", "*"]) &&
		uri.path.toLowerCase().endsWith(".txt")
	) {
		return 0;
	}

	// An ideas file kept somewhere else still previews, as long as it opens with the `ideas` block
	// the game reads. Anchored to the start of a line so a stray `swap_ideas = {` in a focus file
	// does not claim the preview.
	const text = document.getText();
	return /^\s*ideas\s*=\s*{/m.exec(text)?.index;
}

class IdeaPreview extends LoaderPreview<IdeasLoader> {
	private configurationHandler: vscode.Disposable;

	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(
			uri,
			panel,
			(file, contentProvider) => new IdeasLoader(file, contentProvider),
			renderIdeaFile,
		);
		this.configurationHandler = vscode.workspace.onDidChangeConfiguration((e) => {
			// previewLocalisation changes the text in the payload; localisationIndex changes whether
			// there is any text to show, and so whether the localisation toggle is offered at all;
			// gfxIndex changes which icons resolve; ideaSwapIndex changes whether chains are found.
			if (
				e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`) ||
				e.affectsConfiguration(`${ConfigurationKey}.localisationIndex`) ||
				e.affectsConfiguration(`${ConfigurationKey}.gfxIndex`) ||
				e.affectsConfiguration(`${ConfigurationKey}.ideaSwapIndex`)
			) {
				this.reload();
			}
		});
	}

	public dispose(): void {
		super.dispose();
		this.configurationHandler.dispose();
	}
}

export const ideaPreviewDef: PreviewProviderDef = {
	type: "idea",
	canPreview: canPreviewIdea,
	previewConstructor: IdeaPreview,
};
