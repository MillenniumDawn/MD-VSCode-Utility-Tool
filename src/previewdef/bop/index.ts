import { localize } from "../../util/i18n";
import * as vscode from "vscode";
import { renderBopFile } from "./contentbuilder";
import { matchPathEnd } from "../../util/nodecommon";
import { PreviewProviderDef } from "../previewmanager";
import { LoaderPreview } from "../loaderpreview";
import { BopLoader } from "./loader";
import { getFlags } from "../../util/featureflags";

function canPreviewBop(document: vscode.TextDocument): number | undefined {
	if (!getFlags().bopPreview) {
		return undefined;
	}

	const uri = document.uri;
	if (
		matchPathEnd(uri.toString().toLowerCase(), ["common", "bop", "*"]) &&
		uri.path.toLowerCase().endsWith(".txt")
	) {
		return 0;
	}

	// A BoP kept somewhere else still previews, as long as its first line inside the block is the
	// `initial_value` every balance of power opens with.
	const text = document.getText();
	return /^[ \t]*\w+[ \t]*=[ \t]*{\s*(?:#.*\s*)*initial_value\s*=/m.exec(text)?.index;
}

class BopPreview extends LoaderPreview<BopLoader> {
	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(
			uri,
			panel,
			(file, contentProvider) => new BopLoader(file, contentProvider),
			renderBopFile,
		);
	}

	// previewLocalisation changes the text in the payload; localisationIndex changes whether there
	// is any text to show; gfxIndex changes which side icons resolve.
	protected override get reloadOnConfigurationChange(): readonly string[] {
		return ["previewLocalisation", "localisationIndex", "gfxIndex"];
	}
}

export const bopPreviewDef: PreviewProviderDef = {
	type: "bop",
	displayName: () => localize("preview.type.bop", "Balance of power (common/bop/*.txt)"),
	isEnabled: () => getFlags().bopPreview,
	canPreview: canPreviewBop,
	previewConstructor: BopPreview,
};
