import type * as vscode from "vscode";
import {
	UpdateablePreviewBase,
	LoaderRender,
	RenderContentOptions,
} from "./updateablepreview";
import { Loader } from "../util/loader/loader";
import { getRelativePathInWorkspace } from "../util/vsccommon";

// The shared in-place update machinery (hash-skip, updateBody post decision, loaded-page capability
// tracking, hidden-panel flush) and its pure helpers live in updateablepreview.ts; re-exported here
// so the loader previews and their tests keep importing from one place.
export {
	type LoaderRenderResult,
	type LoaderRender,
	type LoaderUpdateAction,
	type LoaderRenderPrevious,
	type RenderContentOptions,
	normalizeRender,
	renderedHtml,
	hashUpdate,
	normalizeNoncesForHash,
	decideLoaderRender,
	hashHtml,
	shouldReplaceHtml,
} from "./updateablepreview";

// Shared base for the event/gui/mio/technology previews. They only differ in which loader they build
// and which render function turns it into HTML, so the constructor wiring lives here and the render
// decision lives in UpdateablePreviewBase. The loader is the only thing this adds over that base: it
// supplies the contentProvider the render functions parse from and reports file dependencies.
export abstract class LoaderPreview<
	TLoader extends Loader<unknown, unknown>,
> extends UpdateablePreviewBase {
	private readonly loader: TLoader;
	private content: string | undefined;

	constructor(
		uri: vscode.Uri,
		panel: vscode.WebviewPanel,
		createLoader: (
			file: string,
			contentProvider: () => Promise<string>,
		) => TLoader,
		// `options` is passed on for the previews that need to know why the render ran -- a preview
		// whose loader reads auxiliary files has to force its session when one of them changed, since
		// its own document's hash has not moved. The rest ignore the argument.
		private readonly render: (
			loader: TLoader,
			uri: vscode.Uri,
			webview: vscode.Webview,
			options?: RenderContentOptions,
		) => Promise<LoaderRender>,
		browserSmoke = false,
	) {
		super(uri, panel, browserSmoke);
		this.loader = createLoader(getRelativePathInWorkspace(this.uri), () =>
			Promise.resolve(this.content ?? ""),
		);
		this.loader.onLoadDone((r) => this.updateDependencies(r.dependencies));
	}

	protected async renderContent(
		document: vscode.TextDocument,
		uri: vscode.Uri,
		webview: vscode.Webview,
		options?: RenderContentOptions,
	): Promise<LoaderRender> {
		this.content = document.getText();
		try {
			return await this.render(this.loader, uri, webview, options);
		} finally {
			this.content = undefined;
		}
	}
}

// The whole of a preview that has nothing of its own but its loader, its render and the settings
// its page goes stale on. One with more to it extends what this returns.
export function loaderPreview<TLoader extends Loader<unknown, unknown>>(
	loaderConstructor: new (file: string, contentProvider: () => Promise<string>) => TLoader,
	render: (
		loader: TLoader,
		uri: vscode.Uri,
		webview: vscode.Webview,
		options?: RenderContentOptions,
	) => Promise<LoaderRender>,
	reloadOnConfigurationChange: readonly string[],
): new (uri: vscode.Uri, panel: vscode.WebviewPanel, browserSmoke?: boolean) => LoaderPreview<TLoader> {
	return class extends LoaderPreview<TLoader> {
		constructor(uri: vscode.Uri, panel: vscode.WebviewPanel, browserSmoke = false) {
			super(uri, panel, (file, contentProvider) => new loaderConstructor(file, contentProvider), render, browserSmoke);
		}

		// On the prototype, not a field: PreviewBase reads it from its own constructor.
		protected override get reloadOnConfigurationChange(): readonly string[] {
			return reloadOnConfigurationChange;
		}
	};
}
