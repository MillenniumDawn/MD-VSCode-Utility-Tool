import type * as vscode from "vscode";
import { host } from "../../util/host";
import { Commands, ConfigurationKey, WebviewType } from "../../constants";
import { contextContainer } from "../../context";
import { localize } from "../../util/i18n";
import { previewWebviewOptions } from "../../util/vsccommon";
import { onDidSelectInstallPath } from "../../util/installpath";
import { FocusIconCatalog } from "./catalog";

// The settings the catalog's icons depend on: where the game and the mod are, and which files it reads.
const affectingSettings = ["installPath", "modFile", "parentModPaths", "loadDlcContents", "focusIconCatalogGfxFiles"];

/** Opens the one Focus Icon Catalog panel and keeps it in step with the files its icons come from. */
export class FocusIconCatalogContainer implements vscode.WebviewPanelSerializer {
	private catalog: FocusIconCatalog | undefined;

	public register(): vscode.Disposable {
		return host().Disposable.from(
			host().commands.registerCommand(Commands.OpenFocusIconCatalog, () => this.open()),
			host().window.registerWebviewPanelSerializer(WebviewType.FocusIconCatalog, this),
			host().workspace.onDidChangeConfiguration(e => {
				if (affectingSettings.some(setting => e.affectsConfiguration(`${ConfigurationKey}.${setting}`))) {
					this.catalog?.refresh();
				}
			}),
			host().workspace.onDidSaveTextDocument(document => {
				if (/\.(gfx|mod)$/i.test(document.uri.path)) {
					this.catalog?.refresh();
				}
			}),
			onDidSelectInstallPath(() => this.catalog?.refresh()),
		);
	}

	public deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown): Promise<void> {
		return this.open(panel);
	}

	public open(panel?: vscode.WebviewPanel): Promise<void> {
		if (this.catalog) {
			this.catalog.panel.reveal();
			panel?.dispose();
			return Promise.resolve();
		}

		const options = previewWebviewOptions();
		panel = panel ?? host().window.createWebviewPanel(
			WebviewType.FocusIconCatalog,
			localize("focusiconcatalog.title", "Focus Icon Catalog"),
			host().ViewColumn.Active,
			{ ...options, retainContextWhenHidden: true },
		);
		panel.webview.options = options;
		if (contextContainer.current) {
			panel.iconPath = {
				light: host().Uri.joinPath(contextContainer.current.extensionUri, "static/preview-right-light.svg"),
				dark: host().Uri.joinPath(contextContainer.current.extensionUri, "static/preview-right-dark.svg"),
			};
		}

		const catalog = new FocusIconCatalog(panel);
		this.catalog = catalog;
		panel.onDidDispose(() => {
			catalog.dispose();
			if (this.catalog === catalog) {
				this.catalog = undefined;
			}
		});
		catalog.initialize();
		return Promise.resolve();
	}
}

export const focusIconCatalog = new FocusIconCatalogContainer();
