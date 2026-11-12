import * as assert from "assert";
import { mock } from "node:test";
import * as loader from "../../../../previewdef/focusiconcatalog/loader";
import * as fileloader from "../../../../util/fileloader";
import { FocusIconCatalog } from "../../../../previewdef/focusiconcatalog/catalog";
import { handOver } from "../../host";

const icons: loader.CatalogIcon[] = [
	{ name: "GFX_goal_a", gfxFile: "interface/goals.gfx", texture: "a.dds", source: "vanilla", frames: 1, shine: false, start: 10, end: 20 },
	{ name: "GFX_goal_missing", gfxFile: "interface/goals.gfx", texture: "missing.dds", source: "vanilla", frames: 1, shine: false },
];

function panel(posts: any[]) {
	return {
		webview: {
			html: "",
			cspSource: "",
			asWebviewUri: (uri: unknown) => uri,
			postMessage: async (message: unknown) => {
				posts.push(message);
				return true;
			},
			onDidReceiveMessage: () => ({ dispose: () => undefined }),
		},
	} as any;
}

describe("previewdef/focusiconcatalog/catalog", () => {
	const posts: any[] = [];
	const clipboard: string[] = [];
	const statusMessages: string[] = [];
	const opened: { document: unknown; options: any }[] = [];
	let loads: number;
	let failLoad: Error | undefined;
	let catalog: FocusIconCatalog;

	beforeEach(() => {
		posts.length = 0;
		clipboard.length = 0;
		statusMessages.length = 0;
		opened.length = 0;
		loads = 0;
		failLoad = undefined;
		handOver({
			env: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } },
			window: {
				setStatusBarMessage: ((text: string) => { statusMessages.push(text); return { dispose: () => undefined }; }) as any,
				showTextDocument: (async (document: unknown, options: unknown) => { opened.push({ document, options }); }) as any,
			},
			workspace: { openTextDocument: (async (uri: unknown) => ({ uri, positionAt: (offset: number) => offset })) as any },
			Range: class { constructor(readonly start: unknown, readonly end: unknown) {} } as any,
			ViewColumn: { Beside: -2 } as any,
		});
		mock.method(loader, "loadFocusIconCatalog", async () => {
			loads++;
			if (failLoad) {
				throw failLoad;
			}
			return { icons, gfxFiles: [{ path: "interface/goals.gfx", source: "vanilla", count: 2 }] };
		});
		mock.method(loader, "loadIconImageUri", async (icon: loader.CatalogIcon) =>
			icon.name === "GFX_goal_a" ? "data:image/png;base64,AAAA" : undefined);
		mock.method(fileloader, "getFilePathFromModOrHOI4", async (path: string) => ({ path }));
		catalog = new FocusIconCatalog(panel(posts));
	});

	afterEach(() => mock.restoreAll());

	it("sends the icons when the page is ready, and loads them once", async () => {
		await catalog.onMessage({ command: "ready" });
		await catalog.onMessage({ command: "ready" });
		assert.strictEqual(loads, 1);
		assert.strictEqual(posts[0].type, "catalog");
		assert.deepStrictEqual(posts[0].data.icons.map((icon: loader.CatalogIcon) => icon.name), ["GFX_goal_a", "GFX_goal_missing"]);
	});

	it("loads the icons again on reload", async () => {
		await catalog.onMessage({ command: "ready" });
		await catalog.onMessage({ command: "reload" });
		assert.strictEqual(loads, 2);
	});

	it("copies the name of a known icon to the clipboard", async () => {
		await catalog.onMessage({ command: "ready" });
		await catalog.onMessage({ command: "copyName", name: "GFX_goal_a" });
		assert.deepStrictEqual(clipboard, ["GFX_goal_a"]);
		assert.strictEqual(statusMessages.length, 1);
	});

	it("copies nothing for a name it did not send, or a malformed message", async () => {
		await catalog.onMessage({ command: "ready" });
		await catalog.onMessage({ command: "copyName", name: "GFX_not_listed" });
		await catalog.onMessage({ command: "copyName", name: 5 });
		await catalog.onMessage("copyName");
		await catalog.onMessage(null);
		assert.deepStrictEqual(clipboard, []);
	});

	it("answers an image request with a picture, or null when the texture cannot be read", async () => {
		await catalog.onMessage({ command: "ready" });
		posts.length = 0;
		await catalog.onMessage({ command: "requestImages", names: ["GFX_goal_a", "GFX_goal_missing", "GFX_unknown"] });
		assert.deepStrictEqual(posts, [{ type: "images", images: { GFX_goal_a: "data:image/png;base64,AAAA", GFX_goal_missing: null } }]);
	});

	it("ignores an image request that is not a list of names", async () => {
		await catalog.onMessage({ command: "ready" });
		posts.length = 0;
		await catalog.onMessage({ command: "requestImages", names: "GFX_goal_a" });
		assert.deepStrictEqual(posts, []);
	});

	it("opens the .gfx file at the sprite's name", async () => {
		await catalog.onMessage({ command: "ready" });
		await catalog.onMessage({ command: "openDefinition", name: "GFX_goal_a" });
		assert.strictEqual(opened.length, 1);
		assert.deepStrictEqual((opened[0].document as any).uri, { path: "interface/goals.gfx" });
		assert.strictEqual(opened[0].options.selection.start, 10);
		assert.strictEqual(opened[0].options.selection.end, 20);
	});

	it("tells the page when the icons cannot be loaded", async () => {
		failLoad = new Error("no install path");
		await catalog.onMessage({ command: "ready" });
		assert.deepStrictEqual(posts, [{ type: "catalogError", message: "no install path" }]);
	});
});
