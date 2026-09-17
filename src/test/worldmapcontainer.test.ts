import * as assert from "assert";
import * as vscode from "vscode";
import { WorldMapContainer } from "../previewdef/worldmap/worldmapcontainer";
import { contextContainer } from "../context";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// The world map panel used to be created with only enableScripts, which leaves localResourceRoots
// at VS Code's default of the extension folder plus every workspace folder. The CSP allows scripts
// from any of those roots, so a mod could ship one the preview would run. The panel now names the
// extension folder as its only root, whether it is created fresh or restored after a reload.
describe("previewdef/worldmap/WorldMapContainer webview options", function () {
	const extensionUri = vscode.Uri.file("/ext");
	let previous: typeof contextContainer.current;

	beforeEach(function () {
		previous = contextContainer.current;
		contextContainer.current = { extensionUri } as any;
	});

	afterEach(function () {
		contextContainer.current = previous;
		restoreVscodeStubs();
	});

	it("creates the panel with localResourceRoots scoped to the extension folder", async function () {
		let captured: any;
		stubVscode({
			createWebviewPanel: (_viewType, _title, _showOptions, options) => {
				captured = options;
				return {
					webview: {
						html: "",
						options,
						cspSource: "stub-csp-source",
						asWebviewUri: (u: unknown) => u,
						postMessage: async () => true,
						onDidReceiveMessage: () => ({ dispose() {} }),
					},
					onDidDispose: () => ({ dispose() {} }),
					onDidChangeViewState: () => ({ dispose() {} }),
					reveal() {},
					dispose() {},
				};
			},
		});

		await new WorldMapContainer().openPreview();

		assert.ok(captured, "createWebviewPanel was called");
		assert.strictEqual(captured.enableScripts, true);
		assert.deepStrictEqual(captured.localResourceRoots, [extensionUri]);
	});

	it("scopes a restored panel's localResourceRoots to the extension folder", async function () {
		const panel = {
			webview: {
				html: "",
				options: { enableScripts: true } as vscode.WebviewOptions,
				cspSource: "stub-csp-source",
				asWebviewUri: (u: unknown) => u,
				postMessage: async () => true,
				onDidReceiveMessage: () => ({ dispose() {} }),
			},
			onDidDispose: () => ({ dispose() {} }),
			onDidChangeViewState: () => ({ dispose() {} }),
			reveal() {},
			dispose() {},
		};

		await new WorldMapContainer().deserializeWebviewPanel(panel as any, {});

		assert.strictEqual(panel.webview.options.enableScripts, true);
		assert.deepStrictEqual(panel.webview.options.localResourceRoots, [extensionUri]);
	});
});
