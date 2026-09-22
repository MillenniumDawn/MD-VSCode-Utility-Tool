import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, describe, it } from "mocha";
import { WorldMap } from "../previewdef/worldmap/worldmap";
import { restoreVscodeStubs, stubVscode } from "./_vscode_stub";

function panel(posts: unknown[]): unknown {
	return {
		webview: {
			postMessage: async (message: unknown) => {
				posts.push(message);
				return true;
			},
		},
	};
}

describe("previewdef/worldmap/WorldMap", () => {
	afterEach(() => {
		restoreVscodeStubs();
	});

	it("slices requested province data before posting it to the webview", async () => {
		const posts: unknown[] = [];
		const worldMap = new WorldMap(panel(posts) as any);
		(worldMap as any).worldMapLoader = {
			getWorldMap: async () => ({ provinces: ["zero", "one", "two"] }),
		};

		await (worldMap as any).onMessage({
			command: "requestprovinces",
			start: 1,
			end: 3,
		});

		assert.deepStrictEqual(posts, [
			{
				command: "provinces",
				data: '["one","two"]',
				start: 1,
				end: 3,
			},
		]);
	});

	it("reports and logs requested province data failures", async () => {
		const posts: unknown[] = [];
		const failure = new Error("province request failed");
		const consoleErrors: unknown[][] = [];
		const originalConsoleError = console.error;
		console.error = (...args: unknown[]) => {
			consoleErrors.push(args);
		};
		try {
			const worldMap = new WorldMap(panel(posts) as any);
			(worldMap as any).worldMapLoader = {
				getWorldMap: async () => {
					throw failure;
				},
			};

			await (worldMap as any).onMessage({
				command: "requestprovinces",
				start: 0,
				end: 1,
			});

			assert.deepStrictEqual(posts, [
				{
					command: "error",
					data: "Failed to load world map: Error: province request failed.",
				},
			]);
			assert.deepStrictEqual(consoleErrors, [[failure]]);
		} finally {
			console.error = originalConsoleError;
		}
	});

	it("writes a successful export only once when the webview replays it", async () => {
		const writes: string[] = [];
		stubVscode({
			writeFile: async (uri: vscode.Uri) => {
				writes.push(uri.toString());
			},
		});
		const worldMap = new WorldMap(panel([]) as any);
		const uri = vscode.Uri.file("/tmp/world-map.png");
		const state = worldMap as any;
		state.lastRequestedExportUri = uri;
		state.lastRequestedExportRequestId = 1;

		await (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});
		await (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});

		assert.deepStrictEqual(writes, [uri.toString()]);
		assert.strictEqual(state.lastRequestedExportUri, undefined);
	});

	it("suppresses a concurrent replay while the export is pending", async () => {
		const writes: string[] = [];
		let writeStarted!: () => void;
		let finishWrite!: () => void;
		const started = new Promise<void>((resolve) => {
			writeStarted = resolve;
		});
		const finished = new Promise<void>((resolve) => {
			finishWrite = resolve;
		});
		stubVscode({
			writeFile: async (uri: vscode.Uri) => {
				writes.push(uri.toString());
				writeStarted();
				await finished;
			},
		});
		const worldMap = new WorldMap(panel([]) as any);
		const state = worldMap as any;
		state.lastRequestedExportUri = vscode.Uri.file("/tmp/world-map.png");
		state.lastRequestedExportRequestId = 1;
		const message = {
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		};

		const firstExport = (worldMap as any).onMessage(message);
		await started;
		await (worldMap as any).onMessage(message);
		assert.strictEqual(writes.length, 1);
		finishWrite();
		await firstExport;
	});

	it("keeps a failed export target available for retry", async () => {
		let attempts = 0;
		stubVscode({
			writeFile: async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error("write failed");
				}
			},
		});
		const worldMap = new WorldMap(panel([]) as any);
		const state = worldMap as any;
		state.lastRequestedExportUri = vscode.Uri.file("/tmp/world-map.png");
		state.lastRequestedExportRequestId = 1;

		await (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});
		assert.ok(state.lastRequestedExportUri);
		await (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});

		assert.strictEqual(attempts, 2);
		assert.strictEqual(state.lastRequestedExportUri, undefined);
	});

	it("preserves a newer target while an older export is pending", async () => {
		let finishWrite!: () => void;
		let writeStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			writeStarted = resolve;
		});
		const finished = new Promise<void>((resolve) => {
			finishWrite = resolve;
		});
		const writes: string[] = [];
		stubVscode({
			writeFile: async (uri: vscode.Uri) => {
				writes.push(uri.toString());
				writeStarted();
				await finished;
			},
		});
		const worldMap = new WorldMap(panel([]) as any);
		const state = worldMap as any;
		const oldUri = vscode.Uri.file("/tmp/old-world-map.png");
		const newUri = vscode.Uri.file("/tmp/new-world-map.png");
		state.lastRequestedExportUri = oldUri;
		state.lastRequestedExportRequestId = 1;

		const oldExport = (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});
		await started;
		state.lastRequestedExportUri = newUri;
		state.lastRequestedExportRequestId = 2;
		finishWrite();
		await oldExport;

		assert.strictEqual(state.lastRequestedExportUri, newUri);
		await (worldMap as any).onMessage({
			command: "exportmap",
			dataUrl: "data:image/png;base64,AA==",
		});

		assert.deepStrictEqual(writes, [oldUri.toString(), newUri.toString()]);
		assert.strictEqual(state.lastRequestedExportUri, undefined);
	});
	// Issue #220: the setting is embedded as JSON, not concatenated, so a settings.json value that
	// is not the boolean it is declared as cannot end the inline script and land in the page as markup.
	it("embeds the supply-area setting so a hostile value cannot end the inline script", () => {
		const webview = { asWebviewUri: (u: unknown) => u, cspSource: "test-csp" };
		const render = (enableSupplyArea: unknown): string => {
			stubVscode({ configuration: { enableSupplyArea } });
			return (new WorldMap({ webview } as any) as any).renderWorldMap(webview);
		};

		const hostile = render("</script><img src=x>");
		const script = /window\.__enableSupplyArea = (.*?)<\/script>/s.exec(hostile);
		assert.ok(script, "expected the supply-area script");
		assert.ok(!script![1]!.includes("</script"), script![1]!);
		assert.strictEqual(JSON.parse(script![1]!.replace(/;\s*$/, "")), "</script><img src=x>");

		assert.ok(render(true).includes("window.__enableSupplyArea = true;"));
		assert.ok(render(false).includes("window.__enableSupplyArea = false;"));
	});

	// Issue #220: with the setting unset the page must carry the declared default (false),
	// not undefined, so the webview reads a usable boolean either way.
	it("renders the supply-area default when the setting is absent", () => {
		const webview = { asWebviewUri: (u: unknown) => u, cspSource: "test-csp" };
		stubVscode({ configuration: {} });
		const html = (new WorldMap({ webview } as any) as any).renderWorldMap(webview);
		assert.ok(html.includes("window.__enableSupplyArea = false;"));
	});
});
