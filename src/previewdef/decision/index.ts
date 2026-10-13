import { localize } from "../../util/i18n";
import { renderDecisionFile } from "./contentbuilder";
import { definePreview } from "../definition";
import { loaderPreview } from "../loaderpreview";
import { DecisionsLoader } from "./loader";

export const decisionPreviewDef = definePreview({
	type: "decision",
	displayName: () => localize("preview.type.decision", "Decisions (common/decisions/*.txt)"),
	// previewLocalisation changes the text in the payload; localisationIndex changes whether
	// there is any text to show, and so whether the localisation toggle is offered at all;
	// gfxIndex changes which icons resolve, and which sprites a rendered scripted GUI can draw;
	// decisionGfxFiles changes which .gfx files an icon the index cannot place is looked up in;
	// modifierFormatFiles changes how modifier values read.
	previewConstructor: loaderPreview(DecisionsLoader, renderDecisionFile, [
		"previewLocalisation",
		"localisationIndex",
		"gfxIndex",
		"decisionGfxFiles",
		"modifierFormatFiles",
	]),
});
