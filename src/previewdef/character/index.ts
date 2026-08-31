import * as vscode from "vscode";
import { renderCharacterFile } from "./contentbuilder";
import { matchPathEnd } from "../../util/nodecommon";
import { PreviewProviderDef } from "../previewmanager";
import { LoaderPreview } from "../loaderpreview";
import { CharactersLoader } from "./loader";
import { characterPreview } from "../../util/featureflags";
import { ConfigurationKey } from "../../constants";

function canPreviewCharacter(document: vscode.TextDocument) {
	if (!characterPreview) {
		return undefined;
	}

	const uri = document.uri;
	if (
		matchPathEnd(uri.toString().toLowerCase(), ["common", "characters", "*"]) &&
		uri.path.toLowerCase().endsWith(".txt")
	) {
		return 0;
	}

	// A characters file kept somewhere else still previews, as long as it opens with the
	// `characters` block the game reads. Anchored to the start of a line so a `characters = {`
	// nested inside an effect does not claim the preview.
	const text = document.getText();
	return /^\s*characters\s*=\s*{/m.exec(text)?.index;
}

class CharacterPreview extends LoaderPreview<CharactersLoader> {
	private configurationHandler: vscode.Disposable;

	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(
			uri,
			panel,
			(file, contentProvider) => new CharactersLoader(file, contentProvider),
			renderCharacterFile,
		);
		this.configurationHandler = vscode.workspace.onDidChangeConfiguration((e) => {
			// previewLocalisation changes the text in the payload; localisationIndex changes whether
			// there is any text to show, and so whether the localisation toggle is offered at all;
			// gfxIndex changes which of the GFX_-named portraits resolve.
			if (
				e.affectsConfiguration(`${ConfigurationKey}.previewLocalisation`) ||
				e.affectsConfiguration(`${ConfigurationKey}.localisationIndex`) ||
				e.affectsConfiguration(`${ConfigurationKey}.gfxIndex`)
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

export const characterPreviewDef: PreviewProviderDef = {
	type: "character",
	canPreview: canPreviewCharacter,
	previewConstructor: CharacterPreview,
};
