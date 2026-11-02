import * as assert from "assert";
import type * as vscode from "vscode";
import { focusTreePreviewDef } from "../../../../previewdef/focustree";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { handOver } from "../../host";

const fakeUri: vscode.Uri = {
	scheme: "file",
	path: "/mod/common/national_focus/test.txt",
	fsPath: "/mod/common/national_focus/test.txt",
	toString: () => "file:///mod/common/national_focus/test.txt",
	with: (fragment: { fragment?: string }) => ({ ...fakeUri, fragment: fragment.fragment ?? "" }),
} as unknown as vscode.Uri;

function makePreview() {
	const disposable = { dispose: () => undefined };
	handOver({
		EventEmitter: class {
			event = () => disposable;
			fire() {}
			dispose() {}
		} as any,
		Disposable: {
			from: (...disposables: { dispose: () => void }[]) => ({
				dispose: () => disposables.forEach(d => d.dispose()),
			}),
		} as any,
		workspace: {
			// No workspace folder: the constructor falls back to the uri's own fsPath.
			textDocuments: [],
			getWorkspaceFolder: () => undefined,
			getConfiguration: () => ({}),
			onDidChangeConfiguration: () => disposable,
		},
		window: {
			createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
		},
	} as any);
	refreshFeatureFlags();
	const panel = {
		webview: {
			html: "",
			cspSource: "",
			asWebviewUri: (uri: unknown) => uri,
			posted: [] as unknown[],
			postMessage: async (message: unknown) => panel.webview.posted.push(message) >= 0,
			onDidReceiveMessage: () => disposable,
		},
		visible: true,
		onDidChangeViewState: () => disposable,
		onDidDispose: () => disposable,
	};
	return {
		preview: new (focusTreePreviewDef as any).previewConstructor(fakeUri, panel) as any,
		panel,
	};
}

describe("previewdef/focustree icon-build disposal guard", () => {

	it("starts no icon build from a disposed preview", async () => {
		const { preview, panel } = makePreview();
		const loads: unknown[] = [];
		preview.focusTreeLoader = {
			load: async (session: unknown) => {
				loads.push(session);
				return { result: { focusTrees: [] }, dependencies: [] };
			},
		};
		preview.dispose();

		await preview.pushIconStyles(0);
		await preview.repushResolvedIconStyles();

		assert.deepStrictEqual(loads, []);
		assert.deepStrictEqual(panel.webview.posted, []);
	});

	it("still starts icon builds when the preview is live", async () => {
		const { preview, panel } = makePreview();
		const loads: unknown[] = [];
		preview.focusTreeLoader = {
			load: async (session: unknown) => {
				loads.push(session);
				return { result: { focusTrees: [] }, dependencies: [] };
			},
		};

		await preview.pushIconStyles(0);
		assert.strictEqual(loads.length, 1);
		assert.deepStrictEqual(panel.webview.posted, []);

		loads.length = 0;
		await preview.repushResolvedIconStyles();
		assert.strictEqual(loads.length, 1);
		assert.deepStrictEqual(panel.webview.posted, []);
	});
});