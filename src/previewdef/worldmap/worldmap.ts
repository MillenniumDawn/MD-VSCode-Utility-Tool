import type * as vscode from "vscode";
import { host } from "../../util/host";
import worldmapview from "./worldmapview.html";
import worldmapviewstyles from "./worldmapview.css";
import { localize, localizeText, i18nTableAsScript } from "../../util/i18n";
import { html } from "../../util/html";
import { error, debug } from "../../util/debug";
import {
	WorldMapMessage,
	ProgressReporter,
	WorldMapData,
	MapItemMessage,
	RequestMapItemMessage,
	isWorldMapHostMessage,
} from "./definitions";
import { matchPathEnd } from "../../util/nodecommon";
import { writeFile, getConfiguration } from "../../util/vsccommon";
import { slice, debounceByInput, forceError, jsonForScript } from "../../util/common";
import { openOrCopyHoiFile } from "../../util/previewfileopener";
import { WorldMapLoader } from "./loader/worldmaploader";
import { buildWorldMapChangeMessages } from "./worldmapchanges";
import { renderWorldMapIcons } from "./toolbar";
import { LoaderSession } from "../../util/loader/loader";

type WorldMapItemField =
	| "provinces"
	| "states"
	| "countries"
	| "strategicRegions"
	| "supplyAreas"
	| "railways"
	| "supplyNodes";

const requestItemData: Record<
	RequestMapItemMessage["command"],
	{ field: WorldMapItemField; responseCommand: MapItemMessage["command"] }
> = {
	requestprovinces: { field: "provinces", responseCommand: "provinces" },
	requeststates: { field: "states", responseCommand: "states" },
	requestcountries: { field: "countries", responseCommand: "countries" },
	requeststrategicregions: {
		field: "strategicRegions",
		responseCommand: "strategicregions",
	},
	requestsupplyareas: { field: "supplyAreas", responseCommand: "supplyareas" },
	requestrailways: { field: "railways", responseCommand: "railways" },
	requestsupplynodes: { field: "supplyNodes", responseCommand: "supplynodes" },
};

export class WorldMap {
	public panel: vscode.WebviewPanel | undefined;

	// The supply-area flag the page currently carries its toolbar options by: the value written
	// into the page HTML at render, kept in step by every enablesupplyarea message pushed below.
	// Not set until the page is rendered, so a send before that cannot claim the page is in step.
	private supplyAreaFlagKnownToWebview: boolean = false;

	private worldMapLoader: WorldMapLoader;
	private worldMapDependencies: string[] | undefined;
	private cachedWorldMap: WorldMapData | undefined;
	private requestSequence = 0;
	private pendingRequests = 0;

	private lastRequestedExportUri: vscode.Uri | undefined;
	private lastRequestedExportRequestId = 0;
	private exportInProgressRequestId: number | undefined;

	private subscriptions: vscode.Disposable[] = [];

	constructor(panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.worldMapLoader = new WorldMapLoader();
		this.worldMapLoader.onProgress(this.progressReporter);
	}

	public initialize(): void {
		if (!this.panel) {
			return;
		}

		const webview = this.panel.webview;
		this.supplyAreaFlagKnownToWebview = this.enableSupplyAreaSetting();
		webview.html = this.renderWorldMap(webview);
		this.subscriptions.push(
			webview.onDidReceiveMessage((msg) => this.onMessage(msg)),
			this.panel.onDidChangeViewState(() => this.onViewStateChanged()),
		);
	}

	// The full world map (provinces, states, countries, ...) is 100-300 MB. When the panel is
	// hidden, release the extension-host copy so it doesn't linger for the whole session. The
	// webview keeps its own rendered copy (when retainContextWhenHidden is on), so the map is
	// still shown immediately on return; any further data request reloads from disk on demand.
	private onViewStateChanged(): void {
		if (this.panel && !this.panel.visible) {
			this.releaseMemory();
		}
	}

	private releaseMemory(): void {
		this.cachedWorldMap = undefined;
		this.releaseIfIdle();
	}

	// Keep the loader until every outstanding response has finished posting.
	private releaseIfIdle(): void {
		if (
			this.pendingRequests === 0 &&
			(this.panel === undefined || this.panel.visible === false)
		) {
			this.cachedWorldMap = undefined;
			this.worldMapLoader = new WorldMapLoader();
			this.worldMapLoader.onProgress(this.progressReporter);
		}
	}

	public onDocumentChange = debounceByInput(
		(uri: vscode.Uri) => {
			if (!this.worldMapDependencies || !this.panel?.visible) {
				return;
			}

			if (
				this.worldMapDependencies.some((d) =>
					matchPathEnd(uri.toString(), d.split("/")),
				)
			) {
				void this.sendProvinceMapSummaryToWebview(false);
			}
		},
		(uri) => uri.toString(),
		1000,
		{ trailing: true },
	);

	public dispose() {
		host().Disposable.from(...this.subscriptions).dispose();
		this.subscriptions = [];
		this.panel = undefined;
		this.releaseMemory();
	}

	private renderWorldMap(webview: vscode.Webview): string {
		return html(
			webview,
			localizeText(renderWorldMapIcons(worldmapview, localize)),
			[
				{ content: i18nTableAsScript() },
				{
					// jsonForScript, not concatenation: the setting is whatever the workspace's
					// settings.json says it is, not necessarily the boolean it is declared as. An
					// absent value takes the setting's declared default.
					content:
						"window.__enableSupplyArea = " +
						jsonForScript(this.enableSupplyAreaSetting()) +
						";",
				},
				"common.js",
				"worldmap.js",
			],
			["common.css", "codicon.css", { content: worldmapviewstyles }],
		);
	}

	private enableSupplyAreaSetting(): boolean {
		return getConfiguration().enableSupplyArea ?? false;
	}

	/**
	 * mdHoi4Utilities.enableSupplyArea changed with the panel open: reload the data through the
	 * loader, which re-reads the setting, and push the new flag so the page's toolbar options
	 * follow in the same pass.
	 */
	public async onEnableSupplyAreaChanged(): Promise<void> {
		if (this.panel === undefined) {
			return;
		}

		await this.sendProvinceMapSummaryToWebview(false);
		// A summary send that joined a load already in flight returns data read before the setting
		// changed, leaving the reload queued; one more pass then publishes the new mode.
		if (this.worldMapLoader.isShallowReloadPending()) {
			await this.sendProvinceMapSummaryToWebview(false);
		}
	}

	private async onMessage(msg: unknown): Promise<void> {
		try {
			debug("worldmap message " + JSON.stringify(msg));
			if (!isWorldMapHostMessage(msg)) {
				return;
			}
			switch (msg.command) {
				case "loaded":
					await this.sendProvinceMapSummaryToWebview(msg.force);
					break;
				case "requestprovinces":
				case "requeststates":
				case "requestcountries":
				case "requeststrategicregions":
				case "requestsupplyareas":
				case "requestrailways":
				case "requestsupplynodes":
					await this.sendItemData(msg);
					break;
				case "openfile":
					await this.openFile(msg.file, msg.type, msg.start, msg.end);
					break;
				case "requestexportmap":
					await this.requestExportMap();
					break;
				case "exportmap":
					await this.exportMap(msg.data);
					break;
			}
		} catch (e) {
			error(e);
			await this.postMessageToWebview({
				command: "error",
				data: localize(
					"worldmap.failedtoload",
					"Failed to load world map: {0}.",
					forceError(e).toString(),
				),
			} as WorldMapMessage);
		}
	}

	private sendMapData(
		command: MapItemMessage["command"],
		msg: RequestMapItemMessage,
		value: unknown[],
	) {
		return this.postMessageToWebview({
			command: command,
			data: JSON.stringify(slice(value, msg.start, msg.end)),
			start: msg.start,
			end: msg.end,
		} as WorldMapMessage);
	}

	private async sendItemData(msg: RequestMapItemMessage): Promise<void> {
		this.pendingRequests++;
		try {
			const { field, responseCommand } = requestItemData[msg.command];
			await this.sendMapData(
				responseCommand,
				msg,
				(await this.worldMapLoader.getWorldMap())[field],
			);
		} finally {
			this.pendingRequests--;
			this.releaseIfIdle();
		}
	}

	private progressReporter: ProgressReporter = async (progress: string) => {
		debug("Progress:", progress);
		await this.postMessageToWebview({
			command: "progress",
			data: progress,
		} as WorldMapMessage);
	};

	private async sendProvinceMapSummaryToWebview(force: boolean) {
		const requestSequence = ++this.requestSequence;
		this.pendingRequests++;
		try {
			// The controls take their flag from the page HTML, so a Refresh that reloads the data
			// with a flag it does not already carry must apply the current one to them too.
			await this.sendSupplyAreaFlag();
			this.worldMapLoader.shallowForceReload();
			const loaderSession = new LoaderSession(
				force,
				() => this.panel === undefined,
			);
			const { result: worldMap, dependencies } =
				await this.worldMapLoader.load(loaderSession);
			if (
				requestSequence !== this.requestSequence ||
				this.panel === undefined
			) {
				return;
			}
			const oldCachedWorldMap = this.cachedWorldMap;
			this.worldMapDependencies = dependencies;
			this.cachedWorldMap = worldMap;

			if (
				!force &&
				oldCachedWorldMap &&
				(await this.sendDifferences(oldCachedWorldMap, worldMap))
			) {
				return;
			}

			const summary: WorldMapData = {
				...worldMap,
				provinces: [],
				states: [],
				countries: [],
				strategicRegions: [],
				supplyAreas: [],
				railways: [],
				supplyNodes: [],
			};

			await this.postMessageToWebview({
				command: "provincemapsummary",
				data: summary,
			} as WorldMapMessage);
		} catch (e) {
			error(e);
			if (
				requestSequence !== this.requestSequence ||
				this.panel === undefined
			) {
				return;
			}

			await this.postMessageToWebview({
				command: "error",
				data: localize(
					"worldmap.failedtoload",
					"Failed to load world map: {0}.",
					forceError(e).toString(),
				),
			} as WorldMapMessage);
		} finally {
			this.pendingRequests--;
			this.releaseIfIdle();
		}
	}

	private async openFile(
		file: string,
		type: "state" | "strategicregion" | "supplyarea",
		start: number | undefined,
		end: number | undefined,
	): Promise<void> {
		const openFileTypeKeys: Record<
			typeof type,
			| "worldmap.openfiletype.state"
			| "worldmap.openfiletype.strategicregion"
			| "worldmap.openfiletype.supplyarea"
		> = {
			state: "worldmap.openfiletype.state",
			strategicregion: "worldmap.openfiletype.strategicregion",
			supplyarea: "worldmap.openfiletype.supplyarea",
		};
		const typeName = localize(openFileTypeKeys[type], type);
		await openOrCopyHoiFile(file, start, end, {
			mustOpenFolderMessage: localize(
				"worldmap.mustopenafolder",
				"Must open a folder before opening {0} file.",
				typeName,
			),
			selectFolderMessage: localize(
				"worldmap.selectafolder",
				"Select a folder to copy {0} file",
				typeName,
			),
			failedToOpenMessage: (errorMessage) =>
				localize(
					"worldmap.failedtoopenstate",
					"Failed to open {0} file: {1}.",
					typeName,
					errorMessage,
				),
		});
	}

	private async sendDifferences(
		cachedWorldMap: WorldMapData,
		worldMap: WorldMapData,
	): Promise<boolean> {
		await this.progressReporter(
			localize("worldmap.progress.comparing", "Comparing changes..."),
		);
		const changeMessages = buildWorldMapChangeMessages(
			cachedWorldMap,
			worldMap,
		);
		if (changeMessages === undefined) {
			return false;
		}

		await this.progressReporter(
			localize("worldmap.progress.applying", "Applying changes..."),
		);
		await changeMessages.reduce(
			(posted, message) =>
				posted
					.then(() => this.postMessageToWebview(message))
					.then(() => undefined),
			Promise.resolve(),
		);
		await this.progressReporter("");
		return true;
	}

	/**
	 * Brings the page's supply-area controls in step with the workspace setting. The page starts
	 * with the flag written into its HTML, so a send only pushes a message when the setting has
	 * moved since the page last saw it.
	 */
	private async sendSupplyAreaFlag(): Promise<void> {
		const enableSupplyArea = this.enableSupplyAreaSetting();
		if (enableSupplyArea === this.supplyAreaFlagKnownToWebview) {
			return;
		}
		this.supplyAreaFlagKnownToWebview = enableSupplyArea;
		await this.postMessageToWebview({
			command: "enablesupplyarea",
			data: enableSupplyArea,
		} as WorldMapMessage);
	}

	private postMessageToWebview(message: WorldMapMessage): Thenable<boolean> {
		if (!this.panel) {
			return Promise.resolve(false);
		}

		return this.panel.webview.postMessage(message);
	}

	private async requestExportMap() {
		const uri = await host().window.showSaveDialog({
			filters: { [localize("pngfile", "PNG file")]: ["png"] },
		});
		this.lastRequestedExportUri = uri;
		this.lastRequestedExportRequestId++;
		if (!uri) {
			return;
		}

		await this.postMessageToWebview({ command: "requestexportmap" });
	}

	private async exportMap(data?: Uint8Array | ArrayBuffer) {
		const uri = this.lastRequestedExportUri;
		const requestId = this.lastRequestedExportRequestId;
		if (!uri || this.exportInProgressRequestId !== undefined) {
			return;
		}

		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
		if (!bytes || bytes.byteLength === 0) {
			void host().window.showErrorMessage(
				localize(
					"worldmap.export.error.imgformat",
					"Can't export world map: Image is not in correct format.",
				),
			);
			return;
		}

		this.exportInProgressRequestId = requestId;
		try {
			await writeFile(
				uri,
				Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			);

			if (this.lastRequestedExportRequestId === requestId) {
				this.lastRequestedExportUri = undefined;
			}
			void host().window.showInformationMessage(
				localize("worldmap.export.success", "Successfully exported world map."),
			);
		} catch (e) {
			error(e);
			void host().window.showErrorMessage(
				localize("worldmap.export.error", "Can't export world map: {0}.", e),
			);
		} finally {
			if (this.exportInProgressRequestId === requestId) {
				this.exportInProgressRequestId = undefined;
			}
		}
	}
}
