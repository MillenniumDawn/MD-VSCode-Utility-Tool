import * as vscode from "vscode";
import { Loader, LoaderSession } from "../util/loader/loader";
import { debug } from "../util/debug";
import { DynamicScript, HtmlOptions, NonceOnly, html, previewedFileUriScript, errorPage } from "../util/html";
import { i18nTableAsScript } from "../util/i18n";
import { StyleTable } from "../util/styletable";
import { jsonForScript } from "../util/common";
import { LoaderRender, RenderContentOptions } from "./loaderpreview";

interface LoaderPage {
	content: string;
	data: Record<string, unknown>;
	scripts?: DynamicScript[];
	styles?: NonceOnly[];
	htmlOptions?: HtmlOptions;
}

interface LoaderRenderer<T> {
	debugLabel: string;
	scripts: string[];
	styles: string[];
	serverStylesId: string;
	buildPage: (result: T, styleTable: StyleTable) => Promise<LoaderPage | string>;
}

export async function renderLoaderFile<T>(
	loader: Loader<T>, uri: vscode.Uri, webview: vscode.Webview,
	options: RenderContentOptions | undefined, renderer: LoaderRenderer<T>,
): Promise<LoaderRender> {
	try {
		const session = new LoaderSession(options?.dependencyChanged ?? false);
		const loaded = await loader.load(session);
		debug(renderer.debugLabel, session.loadedLoaderNames());
		const styleTable = new StyleTable();
		const page = await renderer.buildPage(loaded.result, styleTable);
		if (typeof page === "string") {
			return html(webview, page, [previewedFileUriScript(uri)], []);
		}
		const styleCss = styleTable.toRawCss();
		return {
			html: () => html(webview, page.content, [
				previewedFileUriScript(uri),
				...(page.scripts ?? [
					...Object.entries(page.data).map(([key, value]) => ({ content: `window.${key} = ${jsonForScript(value)};` })),
					{ content: i18nTableAsScript() },
				]),
				...renderer.scripts,
			], [
				...renderer.styles,
				{ content: styleCss, id: renderer.serverStylesId },
				...(page.styles ?? []),
			], page.htmlOptions),
			update: { styleCss, data: page.data },
		};
	} catch (e) {
		return errorPage(webview, uri, e);
	}
}
