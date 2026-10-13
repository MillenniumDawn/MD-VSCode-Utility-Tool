import { localize } from "../../util/i18n";
import { renderCharacterFile } from "./contentbuilder";
import { definePreview } from "../definition";
import { loaderPreview } from "../loaderpreview";
import { CharactersLoader } from "./loader";

export const characterPreviewDef = definePreview({
	type: "character",
	displayName: () => localize("preview.type.character", "Characters (common/characters/*.txt)"),
	// previewLocalisation changes the text in the payload; localisationIndex changes whether
	// there is any text to show, and so whether the localisation toggle is offered at all;
	// gfxIndex changes which of the GFX_-named portraits resolve; characterTraitStructuralKeys
	// changes which trait keys are drawn as modifier lines; modifierFormatFiles changes how modifier
	// values read.
	previewConstructor: loaderPreview(CharactersLoader, renderCharacterFile, [
		"previewLocalisation",
		"localisationIndex",
		"gfxIndex",
		"characterTraitStructuralKeys",
		"modifierFormatFiles",
	]),
});
