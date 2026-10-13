import { localize } from "../../util/i18n";
import { renderIdeaFile } from "./contentbuilder";
import { definePreview } from "../definition";
import { loaderPreview } from "../loaderpreview";
import { IdeasLoader } from "./loader";

export const ideaPreviewDef = definePreview({
	type: "idea",
	displayName: () => localize("preview.type.idea", "Ideas (common/ideas/*.txt)"),
	// previewLocalisation changes the text in the payload; localisationIndex changes whether
	// there is any text to show, and so whether the localisation toggle is offered at all;
	// gfxIndex changes which icons resolve; ideaSwapIndex changes whether chains are found;
	// ideaPlaceholderIcon changes what an icon that does not resolve is drawn with;
	// modifierFormatFiles changes how modifier values read.
	previewConstructor: loaderPreview(IdeasLoader, renderIdeaFile, [
		"previewLocalisation",
		"localisationIndex",
		"gfxIndex",
		"ideaSwapIndex",
		"ideaPlaceholderIcon",
		"modifierFormatFiles",
	]),
});
