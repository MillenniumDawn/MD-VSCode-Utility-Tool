import { localize } from "../../util/i18n";
import * as vscode from "vscode";
import { renderDecisionFile } from "./contentbuilder";
import { matchPathEnd } from "../../util/nodecommon";
import { PreviewProviderDef } from "../previewmanager";
import { LoaderPreview } from "../loaderpreview";
import { DecisionsLoader } from "./loader";
import { decisionPreview } from "../../util/featureflags";

function canPreviewDecision(document: vscode.TextDocument) {
	if (!decisionPreview) {
		return undefined;
	}

	const uri = document.uri;
	// `["common", "decisions", "*"]` matches the three trailing segments, so a file under
	// common/decisions/categories is not claimed here: the category definitions are a different
	// format and are read as a dependency of a decisions file rather than previewed on their own.
	//
	// Returning 0 also settles the overlap with the event preview. A decisions file very often calls
	// `country_event = { ... }` from a complete_effect, which is what the event preview matches on,
	// and it answers with the offset of that match -- always greater than zero. findPreviewProvider
	// takes the lowest number, so the decision preview wins and the file no longer opens as an empty
	// event graph.
	if (
		matchPathEnd(uri.toString().toLowerCase(), ["common", "decisions", "*"]) &&
		uri.path.toLowerCase().endsWith(".txt")
	) {
		return 0;
	}

	return undefined;
}

class DecisionPreview extends LoaderPreview<DecisionsLoader> {
	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(
			uri,
			panel,
			(file, contentProvider) => new DecisionsLoader(file, contentProvider),
			renderDecisionFile,
		);
	}

	// previewLocalisation changes the text in the payload; localisationIndex changes whether
	// there is any text to show, and so whether the localisation toggle is offered at all;
	// gfxIndex changes which icons resolve, and which sprites a rendered scripted GUI can draw.
	protected override get reloadOnConfigurationChange(): readonly string[] {
		return ["previewLocalisation", "localisationIndex", "gfxIndex"];
	}
}

export const decisionPreviewDef: PreviewProviderDef = {
	type: "decision",
	displayName: () => localize("preview.type.decision", "Decisions (common/decisions/*.txt)"),
	isEnabled: () => decisionPreview,
	canPreview: canPreviewDecision,
	previewConstructor: DecisionPreview,
};
