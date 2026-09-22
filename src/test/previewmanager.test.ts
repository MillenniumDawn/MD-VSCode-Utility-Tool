import * as assert from "assert";
import * as vscode from "vscode";
import { PreviewManager } from "../previewdef/previewmanager";
import { contextContainer } from "../context";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";
import { refreshFeatureFlags } from "../util/featureflags";

// PreviewManager wires itself up through vscode.window.registerWebviewPanelSerializer and drives
// panel disposal from vscode.workspace.WebviewPanelSerializer#deserializeWebviewPanel. Both were
// unstubbed before this suite (createWebviewPanel/registerWebviewPanelSerializer didn't exist on the
// stub at all), so importing previewmanager.ts under mocha threw the moment register() or
// deserializeWebviewPanel ran. These tests drive that dispatch/disposal logic directly, without
// constructing a real preview (which pulls in a loader + content builder per file type).
describe("previewdef/previewmanager PreviewManager", function () {
	afterEach(function () {
		restoreVscodeStubs();
	});

	it("register() installs a webview panel serializer and tears it down on dispose", function () {
		let registered: { viewType: string; serializer: unknown } | undefined;
		let serializerDisposed = false;
		stubVscode({
			registerWebviewPanelSerializer: (viewType: string, serializer: unknown) => {
				registered = { viewType, serializer };
				return { dispose: () => { serializerDisposed = true; } };
			},
		});

		const manager = new PreviewManager();
		const subscription = manager.register();

		assert.ok(registered);
		assert.strictEqual(registered?.serializer, manager);

		subscription.dispose();
		assert.strictEqual(serializerDisposed, true);
	});

	it("deserializeWebviewPanel disposes the panel when the saved state carries no uri", async function () {
		const manager = new PreviewManager();
		let disposed = false;
		const panel = { dispose: () => { disposed = true; } };

		await manager.deserializeWebviewPanel(panel as any, {});

		assert.strictEqual(disposed, true);
	});

	it("deserializeWebviewPanel disposes the panel when the document can't be found after reopening", async function () {
		const manager = new PreviewManager();
		let disposed = false;
		const panel = { dispose: () => { disposed = true; } };

		await manager.deserializeWebviewPanel(panel as any, { uri: "file:///tmp/gone.gfx" });

		assert.strictEqual(disposed, true);
	});

	it("deserializeWebviewPanel disposes the panel when no preview provider matches the reopened file", async function () {
		const uri = vscode.Uri.parse("file:///tmp/notes.md");
		const document = { uri, getText: () => "just some text" };
		stubVscode({ textDocuments: [document] });

		const manager = new PreviewManager();
		let disposed = false;
		const panel = { dispose: () => { disposed = true; } };

		await manager.deserializeWebviewPanel(panel as any, { uri: uri.toString() });

		assert.strictEqual(disposed, true);
	});

	// A preview the manager can open without pulling in a real loader: the provider claims every
	// document and its "preview" only records the panel it was handed.
	function fakeProvider(): { type: string; canPreview: () => number; previewConstructor: any } {
		return {
			type: "fake",
			canPreview: () => 0,
			previewConstructor: class {
				public panel: any;
				constructor(_uri: vscode.Uri, panel: any) { this.panel = panel; }
				onDispose() { return { dispose() {} }; }
				onDependencyChanged() { return { dispose() {} }; }
				async initializePanelContent() { return undefined; }
			},
		};
	}

	function panelStub(options: any) {
		return {
			webview: { html: "", options, cspSource: "", asWebviewUri: (u: unknown) => u, postMessage: async () => true, onDidReceiveMessage: () => ({ dispose() {} }) },
			iconPath: undefined,
			onDidDispose: () => ({ dispose() {} }),
			reveal() {},
			dispose() {},
		};
	}

	describe("webview options", function () {
		const extensionUri = vscode.Uri.file("/ext");
		const uri = vscode.Uri.parse("file:///tmp/focus.txt");
		let previous: typeof contextContainer.current;

		beforeEach(function () {
			previous = contextContainer.current;
			contextContainer.current = { extensionUri } as any;
			stubVscode({ textDocuments: [{ uri, getText: () => "" }] });
		});

		afterEach(function () {
			contextContainer.current = previous;
		});

		it("creates the panel with localResourceRoots scoped to the extension folder", async function () {
			let captured: any;
			stubVscode({
				createWebviewPanel: (_viewType, _title, _showOptions, options) => {
					captured = options;
					return panelStub(options);
				},
			});
			const manager = new PreviewManager();
			(manager as any)._previewProviders = [fakeProvider()];

			await (manager as any).showPreview(uri);

			assert.ok(captured, "createWebviewPanel was called");
			assert.strictEqual(captured.enableScripts, true);
			assert.deepStrictEqual(captured.localResourceRoots, [extensionUri]);
		});

		it("scopes a restored panel's localResourceRoots to the extension folder", async function () {
			const panel = panelStub({ enableScripts: true });
			const manager = new PreviewManager();
			(manager as any)._previewProviders = [fakeProvider()];

			await manager.deserializeWebviewPanel(panel as any, { uri: uri.toString() });

			assert.strictEqual(panel.webview.options.enableScripts, true);
			assert.deepStrictEqual(panel.webview.options.localResourceRoots, [extensionUri]);
		});
	});

	describe("dependency subscriptions", function () {
		it("shares one entry between previews with the same dependency and drops it when both leave", function () {
			const manager = new PreviewManager() as any;
			const subscriptions: Map<string, unknown> = manager._updateSubscriptions;
			const first = { name: "first" };
			const second = { name: "second" };

			manager.addPreviewToSubscription(first, ["common/x.txt", "gfx/"]);
			manager.addPreviewToSubscription(second, ["Common/X.txt"]);

			// The two spellings of common/x.txt are one entry, as the match itself ignores case.
			assert.strictEqual(subscriptions.size, 2);
			assert.deepStrictEqual(manager.getPreviewItemsNeedsUpdate("file:///mod/common/x.txt"), [first, second]);
			assert.deepStrictEqual(manager.getPreviewItemsNeedsUpdate("file:///mod/gfx/"), [first]);
			assert.deepStrictEqual(manager.getPreviewItemsNeedsUpdate("file:///mod/common/y.txt"), []);

			manager.removePreviewFromSubscription(first);
			assert.strictEqual(subscriptions.size, 1);
			assert.deepStrictEqual(manager.getPreviewItemsNeedsUpdate("file:///mod/common/x.txt"), [second]);

			manager.removePreviewFromSubscription(second);
			assert.strictEqual(subscriptions.size, 0);
		});
	});

	// The message used to interpolate the provider ids, so the reader was told the valid types
	// were "focustree, gfx, technology, ...". Issue #203.
	describe("the message for a file nothing can preview", function () {
		async function messageFor(text: string, configuration?: Record<string, unknown>) {
			let shown: string | undefined;
			const uri = vscode.Uri.file("/ws/notes.txt");
			const document = {
				uri,
				isClosed: false,
				getText: () => text,
			} as unknown as vscode.TextDocument;
			stubVscode({
				textDocuments: [document],
				showInformationMessage: async (message: string) => {
					shown = message;
					return undefined;
				},
				...(configuration ? { configuration } : {}),
			});
			if (configuration) {
				refreshFeatureFlags();
			}

			const manager = new PreviewManager() as any;
			await manager.showPreviewImpl(uri);
			return shown;
		}

		afterEach(function () {
			restoreVscodeStubs();
			refreshFeatureFlags();
		});

		it("names the paths each preview recognises, not the internal ids", async function () {
			const shown = await messageFor("nothing here matches a preview");

			assert.ok(shown, "no message was shown");
			assert.ok(
				shown!.includes("common/national_focus"),
				`the message does not name the focus tree path: ${shown}`,
			);
			assert.ok(
				!/\bfocustree\b/.test(shown!),
				`the message still shows the raw provider id: ${shown}`,
			);
		});

		it("leaves out a preview whose feature flag is off", async function () {
			const shown = await messageFor("nothing here matches a preview", {
				ideaPreview: false,
			});

			assert.ok(shown, "no message was shown");
			assert.ok(
				!shown!.includes("common/ideas"),
				`the message offers the ideas preview while it is off: ${shown}`,
			);
		});
	});
});
