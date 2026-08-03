import * as vscode from "vscode";
import { renderGfxFile } from "./contentbuilder";
import { PreviewProviderDef } from "../previewmanager";
import { UpdateablePreviewBase, LoaderRender } from "../updateablepreview";

function canPreviewGfx(document: vscode.TextDocument) {
	const uri = document.uri;
	return uri.path.toLowerCase().endsWith(".gfx") ? 0 : undefined;
}

// GfxPreview differs from the loader previews only in that it parses the .gfx content directly
// (no Loader), so it extends UpdateablePreviewBase and renders via a plain function. Edits push an
// in-place updateBody message to the webview instead of reassigning webview.html, and the shared
// base handles the hash-skip, capability tracking and hidden-panel flush.
export class GfxPreview extends UpdateablePreviewBase {
	protected renderContent(
		document: vscode.TextDocument,
		uri: vscode.Uri,
		webview: vscode.Webview,
	): Promise<LoaderRender> {
		return renderGfxFile(document.getText(), uri, webview);
	}
}

export const gfxPreviewDef: PreviewProviderDef = {
	type: "gfx",
	canPreview: canPreviewGfx,
	previewConstructor: GfxPreview,
};
