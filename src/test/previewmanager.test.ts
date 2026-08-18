import * as assert from "assert";
import * as vscode from "vscode";
import { PreviewManager } from "../previewdef/previewmanager";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

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
});
