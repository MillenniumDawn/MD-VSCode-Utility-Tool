import { localize } from "../../util/i18n";
import { renderBopFile } from "./contentbuilder";
import { definePreview } from "../definition";
import { loaderPreview } from "../loaderpreview";
import { BopLoader } from "./loader";

export const bopPreviewDef = definePreview({
	type: "bop",
	displayName: () => localize("preview.type.bop", "Balance of power (common/bop/*.txt)"),
	// previewLocalisation changes the text in the payload; localisationIndex changes whether there
	// is any text to show; gfxIndex changes which side icons resolve.
	previewConstructor: loaderPreview(BopLoader, renderBopFile, ["previewLocalisation", "localisationIndex", "gfxIndex"]),
});
