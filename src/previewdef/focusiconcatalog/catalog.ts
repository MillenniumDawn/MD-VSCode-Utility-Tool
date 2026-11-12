import type * as vscode from "vscode";
import { host } from "../../util/host";
import { getFilePathFromModOrHOI4 } from "../../util/fileloader";
import { html, htmlEscape } from "../../util/html";
import { localize } from "../../util/i18n";
import { isRecord } from "../../util/messageguards";
import { error } from "../../util/debug";
import { forceError } from "../../util/common";
import { actionGroupHtml, iconButtonHtml } from "../toolbaricons";
import { CatalogData, CatalogIcon, loadFocusIconCatalog, loadIconImageUri } from "./loader";

// A batch of image requests is answered in one message; the webview asks for what scrolled into view.
const maxImagesPerRequest = 64;

export interface CatalogStrings {
	copied: string;
	count: string;
	empty: string;
	loading: string;
	failed: string;
}

function catalogStrings(): CatalogStrings {
	return {
		copied: localize("focusiconcatalog.copied", "Copied {0}"),
		count: localize("focusiconcatalog.count", "{0} of {1} icons"),
		empty: localize("focusiconcatalog.empty", "No focus icons found. Check the HOI4 install path and the mod file."),
		loading: localize("focusiconcatalog.loading", "Loading focus icons..."),
		failed: localize("focusiconcatalog.failed", "Cannot load the focus icons: {0}"),
	};
}

export function renderCatalogHtml(webview: vscode.Webview): string {
	const select = (id: string, label: string, options: string) =>
		`<label class="catalog-field"><span>${htmlEscape(label)}</span><select id="${id}">${options}</select></label>`;
	const body = `
<div class="toolbar-outer catalog-toolbar">
	<input id="catalog-search" type="search" placeholder="${htmlEscape(localize("focusiconcatalog.search", "Search icons"))}" aria-label="${htmlEscape(localize("focusiconcatalog.search", "Search icons"))}"/>
	${select("catalog-source", localize("focusiconcatalog.source", "Source:"), `
		<option value="all">${htmlEscape(localize("focusiconcatalog.source.all", "All"))}</option>
		<option value="mod">${htmlEscape(localize("focusiconcatalog.source.mod", "Mod"))}</option>
		<option value="parent">${htmlEscape(localize("focusiconcatalog.source.parent", "Parent mods"))}</option>
		<option value="vanilla">${htmlEscape(localize("focusiconcatalog.source.vanilla", "Vanilla"))}</option>`)}
	${select("catalog-file", localize("focusiconcatalog.file", "File:"), `<option value="">${htmlEscape(localize("focusiconcatalog.file.all", "All files"))}</option>`)}
	<label class="catalog-field"><input id="catalog-shine" type="checkbox" checked/><span>${htmlEscape(localize("focusiconcatalog.hideshine", "Hide shine sprites"))}</span></label>
	<span id="catalog-count" class="catalog-count"></span>
	${actionGroupHtml({ refresh: iconButtonHtml("refresh", localize, { domId: "refresh" }) })}
</div>
<div class="catalog-hint">${htmlEscape(localize("focusiconcatalog.hint", "Click an icon to copy its name. Ctrl+click opens where it is defined."))}</div>
<div id="catalog-status" class="catalog-status" role="status"></div>
<div id="catalog-grid" class="catalog-grid"></div>
<div id="catalog-toast" class="catalog-toast" role="status" aria-live="polite"></div>`;
	const styles = `
body { padding: 0; }
.catalog-toolbar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
	width: auto; box-sizing: border-box; overflow: visible; padding: 6px 10px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
#catalog-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.catalog-field { display: inline-flex; gap: 4px; align-items: center; }
.catalog-count { opacity: 0.8; margin-left: auto; }
.catalog-hint, .catalog-status { padding: 6px 10px; opacity: 0.8; }
.catalog-status:empty { display: none; }
.catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 6px; padding: 6px 10px 20px; }
.catalog-tile { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; cursor: pointer;
	border: 1px solid transparent; border-radius: 4px; background: none; color: inherit; font: inherit; }
.catalog-tile:hover, .catalog-tile:focus-visible { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
.catalog-tile.copied { border-color: var(--vscode-charts-green, #3c3); }
.catalog-tile[hidden] { display: none; }
.catalog-image { width: 96px; height: 90px; display: flex; align-items: center; justify-content: center; }
.catalog-image img { max-width: 96px; max-height: 90px; image-rendering: auto; }
.catalog-image.missing::after { content: "?"; font-size: 32px; opacity: 0.4; }
.catalog-name { font-size: 11px; word-break: break-all; text-align: center; user-select: text; }
.catalog-toast { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); padding: 4px 12px; border-radius: 4px;
	background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground);
	border: 1px solid var(--vscode-notifications-border, transparent); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.catalog-toast.visible { opacity: 1; }`;
	return html(webview, body, [
		{ content: `window.focusIconCatalogStrings = ${JSON.stringify(catalogStrings()).replace(/</g, "\\u003c")};` },
		"common.js",
		"focusiconcatalog.js",
	], ["codicon.css", "common.css", { content: styles }]);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(v => typeof v === "string");
}

/**
 * One open catalog. It loads the icons when the page says it is ready, sends their names first and
 * the pictures only for the tiles the page asks for, and does what a click on a tile means.
 */
export class FocusIconCatalog {
	private data: CatalogData | undefined;
	private byName = new Map<string, CatalogIcon>();
	private loading: Promise<void> | undefined;
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor(readonly panel: vscode.WebviewPanel) {
		this.subscriptions.push(panel.webview.onDidReceiveMessage(msg => {
			void this.onMessage(msg).catch(error);
		}));
	}

	public initialize(): void {
		this.panel.webview.html = renderCatalogHtml(this.panel.webview);
	}

	public async onMessage(msg: unknown): Promise<void> {
		if (!isRecord(msg)) {
			return;
		}
		switch (msg.command) {
			case "ready":
				await this.sendCatalog(false);
				break;
			case "reload":
				await this.sendCatalog(true);
				break;
			case "requestImages":
				if (isStringArray(msg.names)) {
					await this.sendImages(msg.names.slice(0, maxImagesPerRequest));
				}
				break;
			case "copyName":
				if (typeof msg.name === "string" && this.byName.has(msg.name)) {
					await host().env.clipboard.writeText(msg.name);
					host().window.setStatusBarMessage(localize("focusiconcatalog.copied", "Copied {0}", msg.name), 3000);
				}
				break;
			case "openDefinition":
				if (typeof msg.name === "string") {
					await this.openDefinition(msg.name);
				}
				break;
		}
	}

	/** Reloads the icons when something they come from changed, if the page has asked for them. */
	public refresh(): void {
		if (this.data !== undefined) {
			void this.sendCatalog(true).catch(error);
		}
	}

	private sendCatalog(reload: boolean): Promise<void> {
		if (this.loading && !reload) {
			return this.loading;
		}
		const loading = (async () => {
			try {
				if (reload || this.data === undefined) {
					this.data = await loadFocusIconCatalog();
					this.byName = new Map(this.data.icons.map(icon => [icon.name, icon]));
				}
				await this.panel.webview.postMessage({ type: "catalog", data: this.data });
			} catch (e) {
				error(e);
				await this.panel.webview.postMessage({ type: "catalogError", message: forceError(e).message });
			}
		})();
		this.loading = loading;
		return loading;
	}

	private async sendImages(names: string[]): Promise<void> {
		const images: Record<string, string | null> = {};
		await Promise.all(names.map(async name => {
			const icon = this.byName.get(name);
			if (icon === undefined) {
				return;
			}
			try {
				images[name] = (await loadIconImageUri(icon)) ?? null;
			} catch (e) {
				error(e);
				images[name] = null;
			}
		}));
		await this.panel.webview.postMessage({ type: "images", images });
	}

	private async openDefinition(name: string): Promise<void> {
		const icon = this.byName.get(name);
		if (icon === undefined) {
			return;
		}
		const uri = await getFilePathFromModOrHOI4(icon.gfxFile);
		if (uri === undefined) {
			return;
		}
		const document = await host().workspace.openTextDocument(uri);
		const selection = icon.start !== undefined && icon.end !== undefined
			? new (host().Range)(document.positionAt(icon.start), document.positionAt(icon.end))
			: undefined;
		await host().window.showTextDocument(document, { selection, viewColumn: host().ViewColumn.Beside, preview: true });
	}

	public dispose(): void {
		this.subscriptions.forEach(s => s.dispose());
		this.subscriptions.length = 0;
	}
}
