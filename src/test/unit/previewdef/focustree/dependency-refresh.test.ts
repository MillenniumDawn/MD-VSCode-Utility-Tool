import * as assert from "assert";
import { mock } from "node:test";
import * as fileloader from "../../../../util/fileloader";
import * as guiwindowindex from "../../../../util/guiwindowindex";
import * as imagecache from "../../../../util/image/imagecache";
import * as vsccommon from "../../../../util/vsccommon";
import { FocusTreeLoader } from "../../../../previewdef/focustree/loader";
import { buildFocusTreePayload } from "../../../../previewdef/focustree/contentbuilder";
import { focusTreePreviewDef } from "../../../../previewdef/focustree";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { PNG } from "pngjs";
import { handOver } from "../../host";

const guiPath = "interface/refresh-test.gui";
const gfxPath = "interface/refresh-test.gfx";
const inlayPath = "common/focus_inlay_windows/refresh-test.txt";
const focusPath = "common/national_focus/refresh-test.txt";
const originalListFiles = fileloader.listFilesFromModOrHOI4;
const originalReadFile = fileloader.readFileFromModOrHOI4;
const originalGuiFiles = guiwindowindex.listGuiFiles;
const originalGfxFiles = guiwindowindex.listGuiGfxFiles;
const originalGetSprite = imagecache.getSpriteByGfxName;
const originalExpiryToken = fileloader.hoiFileExpiryToken;
const originalLastModified = vsccommon.getLastModifiedAsync;
const modRoot = { scheme: "file", path: "/mod", fsPath: "/mod", toString: () => "file:///mod" };

let guiText: string;
let gfxText: string;
let versions: Record<string, number>;
let readCounts: Record<string, number>;
let imageWidths: Record<string, number>;

function uri(filePath: string): any {
	return {
		scheme: "file",
		path: filePath,
		fsPath: filePath,
		toString: () => `file://${filePath}`,
		with: (fragment: { fragment?: string }) => ({ ...uri(filePath), fragment: fragment.fragment ?? "" }),
	};
}

function fileContents(filePath: string): string | undefined {
	if (filePath === guiPath) {
		return guiText;
	}
	if (filePath === gfxPath) {
		return gfxText;
	}
	if (filePath === inlayPath) {
		return `refresh_test_inlay = {
			window_name = refresh_test_window
			internal = yes
			scripted_images = { test_slot = { GFX_refresh_test = yes } }
		}`;
	}
	if (filePath === focusPath) {
		return `focus_tree = {
			id = refresh_test_tree
			focus = { id = refresh_test_focus x = 0 y = 0 icon = GFX_focus_test }
			inlay_window = { id = refresh_test_inlay position = { x = 0 y = 0 } }
		}`;
	}
	if (filePath in imageWidths) {
		return "image";
	}
	return undefined;
}

function png(width: number): Buffer {
	const value = new PNG({ width, height: 1 });
	value.data.fill(0x7f);
	return PNG.sync.write(value);
}

function configure(): void {
	guiText = `guiTypes = { containerWindowType = {
		name = "refresh_test_window"
		position = { x = 0 y = 0 }
		size = { width = 100 height = 100 }
	} }`;
	gfxText = `spriteTypes = { spriteType = {
		name = "GFX_refresh_test"
		texturefile = "gfx/interface/refresh-old.png"
	} }`;
	versions = {};
	for (const file of [guiPath, gfxPath, inlayPath, focusPath, "gfx/interface/refresh-old.png"]) {
		versions[file] = 1;
	}
	readCounts = {};
	imageWidths = { "gfx/interface/refresh-old.png": 8 };
	handOver({
		Uri: {
			joinPath: (base: any, ...parts: string[]) => uri([base.path, ...parts].join("/")),
			parse: (value: string) => uri(value.replace("file://", "")),
		},
		FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
		window: { createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }) },
		workspace: {
			workspaceFolders: [{ uri: modRoot }],
			textDocuments: [],
			getConfiguration: () => ({
				useConditionInFocus: true,
				focusTreeLayout: "standard",
				gfxIndex: false,
				sharedFocusIndex: false,
				focusOverlayGfxFiles: [],
				inlayWindowGfxRoots: [],
				modFile: "",
				loadDlcContents: false,
			}),
			fs: {
				stat: async (file: any) => {
					const relativePath = String(file.path).replace(/^\/mod\//, "");
					if (!(relativePath in versions)) {
						throw new Error(`missing ${relativePath}`);
					}
					return { type: 1, mtime: versions[relativePath], ctime: 0, size: 1 };
				},
				readDirectory: async () => [],
				readFile: async (file: any) => {
					const relativePath = String(file.path).replace(/^\/mod\//, "");
					readCounts[relativePath] = (readCounts[relativePath] ?? 0) + 1;
					if (relativePath in imageWidths) {
						return png(imageWidths[relativePath]!);
					}
					const content = fileContents(relativePath);
					if (content === undefined) {
						throw new Error(`missing ${relativePath}`);
					}
					return Buffer.from(content);
				},
			},
		},
	});
	refreshFeatureFlags();
	(fileloader as any).listFilesFromModOrHOI4 = async (folder: string) => {
		if (folder === "common/focus_inlay_windows") {
			return ["refresh-test.txt"];
		}
		if (folder === "interface") {
			return ["refresh-test.gui", "refresh-test.gfx"];
		}
		return [];
	};
	(fileloader as any).readFileFromModOrHOI4 = async (filePath: string) => {
		readCounts[filePath] = (readCounts[filePath] ?? 0) + 1;
		const content = fileContents(filePath);
		if (content === undefined) {
			throw new Error(`missing ${filePath}`);
		}
		return [Buffer.from(content), uri(`/mod/${filePath}`)];
	};
	(fileloader as any).hoiFileExpiryToken = async (filePath: string) => `${filePath}@${versions[filePath] ?? 0}`;
	(vsccommon as any).getLastModifiedAsync = async (file: any) => {
		const relativePath = String(file.path).replace(/^\/mod\//, "");
		return versions[relativePath] ?? 0;
	};
	(guiwindowindex as any).listGuiFiles = async () => [guiPath];
	(guiwindowindex as any).listGuiGfxFiles = async () => [gfxPath];
	(imagecache as any).getSpriteByGfxName = async (name: string, paths: string | string[]) => {
		if (name !== "GFX_refresh_test" || !(Array.isArray(paths) ? paths : [paths]).includes(gfxPath)) {
			return undefined;
		}
		const texture = "gfx/interface/refresh-old.png";
		const width = imageWidths[texture]!;
		return { frames: [{ width, height: 1, image: { width, height: 1, uri: `data:image/png;base64,${width}`, path: uri(`/mod/${texture}`) } }] };
	};
}

describe("previewdef/focustree dependency-only inlay refresh", () => {
	beforeEach(async () => {
		mock.timers.enable({ apis: ["Date"] });
		await fileloader.clearDlcZipCache();
		configure();
	});

	afterEach(async () => {
		(fileloader as any).listFilesFromModOrHOI4 = originalListFiles;
		(fileloader as any).readFileFromModOrHOI4 = originalReadFile;
		(fileloader as any).hoiFileExpiryToken = originalExpiryToken;
		(vsccommon as any).getLastModifiedAsync = originalLastModified;
		(guiwindowindex as any).listGuiFiles = originalGuiFiles;
		(guiwindowindex as any).listGuiGfxFiles = originalGfxFiles;
		(imagecache as any).getSpriteByGfxName = originalGetSprite;
		imagecache._clearImageCachesForTest();
		guiwindowindex._clearGuiWindowIndexForTest();
		await fileloader.clearDlcZipCache();
		mock.timers.reset();
		refreshFeatureFlags();
	});

	it("reloads a parsed inlay window after its GUI width changes while focus text stays fixed", async () => {
		const loader = new FocusTreeLoader(focusPath, async () => fileContents(focusPath)!);
		const initial = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.strictEqual((initial?.focusTrees[0]?.inlayWindows[0]?.guiWindow?.size?.width as any)?._value, 100);

		guiText = guiText.replace("width = 100", "width = 240");
		versions[guiPath] = 2;
		mock.timers.tick(501);
		const stale = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.strictEqual((stale?.focusTrees[0]?.inlayWindows[0]?.guiWindow?.size?.width as any)?._value, 100);

		const refreshed = await buildFocusTreePayload(loader, undefined, { resolveIcons: false, dependencyChanged: true });
		assert.strictEqual((refreshed?.focusTrees[0]?.inlayWindows[0]?.guiWindow?.size?.width as any)?._value, 240);
	});

	it("resolves an inlay sprite added to its GFX file after the tree loaded", async () => {
		const gfxFileOf = (payload: Awaited<ReturnType<typeof buildFocusTreePayload>>) =>
			payload?.focusTrees[0]?.inlayWindows[0]?.scriptedImages[0]?.gfxOptions[0]?.gfxFile;
		gfxText = gfxText.replace("GFX_refresh_test", "GFX_other");
		const loader = new FocusTreeLoader(focusPath, async () => fileContents(focusPath)!);
		const initial = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.strictEqual(gfxFileOf(initial), undefined);

		gfxText = gfxText.replace("GFX_other", "GFX_refresh_test");
		versions[gfxPath] = 2;
		// The fileloader's 500 ms stat memo outlives a test, so wait out the previous test's window too.
		mock.timers.tick(1001);
		const stale = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.strictEqual(gfxFileOf(stale), undefined);

		const refreshed = await buildFocusTreePayload(loader, undefined, { resolveIcons: false, dependencyChanged: true });
		assert.strictEqual(gfxFileOf(refreshed), gfxPath);
	});

	it("forces the preview's structure load once when a dependency changed", async () => {
		const disposable = { dispose: () => undefined };
		handOver({
			EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
			workspace: {
				workspaceFolders: [{ uri: modRoot }],
				textDocuments: [],
				getWorkspaceFolder: () => ({ uri: modRoot }),
				getConfiguration: () => ({}),
				onDidChangeConfiguration: () => disposable,
			},
		} as any);
		const panel = {
			webview: { html: "", cspSource: "", asWebviewUri: (u: unknown) => u, postMessage: async () => true, onDidReceiveMessage: () => disposable },
			visible: true,
			onDidChangeViewState: () => disposable,
			onDidDispose: () => disposable,
		};
		const preview = new (focusTreePreviewDef as any).previewConstructor(uri(`/mod/${focusPath}`), panel);
		const forced: boolean[] = [];
		preview.focusTreeLoader.load = async (session: { force: boolean }) => {
			forced.push(session.force);
			return { result: { focusTrees: [] }, dependencies: [] };
		};

		await preview.renderContent({ getText: () => "" }, preview.uri, panel.webview, { partial: true, dependencyChanged: true });

		assert.deepStrictEqual(forced, [true]);
	});
});
