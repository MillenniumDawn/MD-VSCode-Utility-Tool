import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { buildFocusTreePayload } from "../../../../previewdef/focustree/contentbuilder";
import { focusTreePreviewDef } from "../../../../previewdef/focustree";
import * as titlebar from "../../../../previewdef/focustree/titlebar";
import * as containerwindow from "../../../../util/hoi4gui/containerwindow";
import * as exclusivelinkimages from "../../../../util/hoi4gui/exclusivelinkimages";
import * as focuslinkimages from "../../../../util/hoi4gui/focuslinkimages";
import * as imagecache from "../../../../util/image/imagecache";
import { CancelledError, UserError } from "../../../../util/common";
import { Loader, LoaderSession } from "../../../../util/loader/loader";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { handOver } from "../../host";

const file = "common/national_focus/test.txt";

const fakeUri: vscode.Uri = {
	scheme: "file",
	path: "/mod/common/national_focus/test.txt",
	fsPath: "/mod/common/national_focus/test.txt",
	toString: () => "file:///mod/common/national_focus/test.txt",
	with: (fragment: { fragment?: string }) => ({ ...fakeUri, fragment: fragment.fragment ?? "" }),
} as unknown as vscode.Uri;

// 25 focuses (the shortcut's target carries no icon, so a shortcut render is the only
// getImageByPath), two inlay windows and one or two shortcuts: every kind of render work leaves
// its own mark in the mocks, so "stopped scheduling further work" is visible per kind.
function focus(id: string, icon: { icon: string | undefined }[]): Record<string, unknown> {
	return {
		id, x: 0, y: 0, icon, text: undefined, textIcon: undefined, overlay: undefined,
		prerequisite: [], exclusive: [], hasAllowBranch: false, inAllowBranch: [],
		allowBranch: undefined, relativePositionId: undefined, offset: [],
		token: { start: 0, end: 10 }, file,
	};
}

function inlay(id: string): Record<string, unknown> {
	return {
		id, file, token: undefined, windowName: "slot_window", guiWindow: {}, internal: true, visible: true,
		position: { x: 0, y: 0 },
		scriptedImages: [{
			id: "slot", file,
			gfxOptions: [{ gfxName: "GFX_inlay", gfxFile: "interface/slots.gfx", file, condition: { scopeName: "", nodeContent: "" } }],
		}],
		scriptedButtons: [], conditionExprs: [],
	};
}

function treeFixture(shortcutCount = 1): Record<string, unknown> {
	const focuses: Record<string, unknown> = {};
	for (let i = 0; i < 24; i++) {
		focuses[`focus_${i}`] = focus(`focus_${i}`, [{ icon: "GFX_focus" }]);
	}
	focuses["focus_short"] = focus("focus_short", []);
	const shortcuts: Record<string, unknown>[] = [];
	for (let i = 0; i < shortcutCount; i++) {
		shortcuts.push({ name: `SHORT_${i}`, target: "focus_short" });
	}
	return {
		id: "test_tree", isSharedFocues: false,
		focuses,
		inlayWindows: [inlay("inlay_0"), inlay("inlay_1")],
		inlayWindowRefs: [], inlayConditionExprs: [], conditionExprs: [],
		warnings: [], allowBranchOptions: [],
		shortcuts,
	};
}

function stubLoader(shortcutCount = 1) {
	const tree = treeFixture(shortcutCount);
	return {
		file,
		setProgressListener: () => undefined,
		load: async () => ({ result: { focusTrees: [tree], gfxFiles: [], overlayGfxFiles: [] }, dependencies: [] }),
	};
}

interface Marks {
	focusRenders: number;
	inlayRenders: number;
	shortcutRenders: number;
	spriteNames: string[];
}

// Hooks at the entry of each kind of render work. A hook can flip a token or dispose the preview
// (the trigger under test); a gate holds the render in flight until the test releases it.
interface BuildHooks {
	onSprite?: () => void;
	onTitlebar?: () => void;
	onInlayRender?: () => void;
	onImageByPath?: () => void;
	gateTitlebar?: Promise<void>;
	gateSprites?: Promise<void>;
}

function installBuildMocks(hooks: BuildHooks): Marks {
	const marks: Marks = { focusRenders: 0, inlayRenders: 0, shortcutRenders: 0, spriteNames: [] };
	mock.method(titlebar, "loadFocusTitlebarStyles", async () => ({}));
	mock.method(titlebar, "getFocusTitlebarImage", async () => {
		marks.focusRenders++;
		hooks.onTitlebar?.();
		if (hooks.gateTitlebar) {
			await hooks.gateTitlebar;
		}
		return undefined;
	});
	mock.method(titlebar, "getFocusOverlayImage", async () => undefined);
	mock.method(imagecache, "getSpriteByGfxName", async (name: string) => {
		marks.spriteNames.push(name);
		hooks.onSprite?.();
		if (hooks.gateSprites) {
			await hooks.gateSprites;
		}
		return { width: 8, height: 8, frames: [] };
	});
	mock.method(imagecache, "getImageByPath", async () => {
		marks.shortcutRenders++;
		hooks.onImageByPath?.();
		return undefined;
	});
	mock.method(containerwindow, "renderContainerWindow", async () => {
		marks.inlayRenders++;
		hooks.onInlayRender?.();
		return "";
	});
	mock.method(exclusivelinkimages, "loadExclusiveLinkImages", async () => undefined);
	mock.method(focuslinkimages, "loadFocusLinkImages", async () => undefined);
	return marks;
}

function flush(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

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
			postMessage: async (message: unknown) => {
				panel.webview.posted.push(message);
				return true;
			},
			onDidReceiveMessage: () => disposable,
		},
		visible: true,
		onDidChangeViewState: () => disposable,
		onDidDispose: () => disposable,
	};
	const preview = new (focusTreePreviewDef as any).previewConstructor(fakeUri, panel) as any;
	preview.focusTreeLoader = stubLoader();
	return { preview, panel };
}

function document() {
	return { getText: () => "focus_tree = {\n    id = test_tree\n}\n" };
}

function postedTypes(panel: { webview: { posted: unknown[] } }): string[] {
	return panel.webview.posted.map(message => (message as { type?: string }).type ?? "");
}

// A loader shared by two consumers the way Loader shares one in-flight load between them.
class SharedFocusLoader extends Loader<{ focusTrees: Record<string, unknown>[]; gfxFiles: string[]; overlayGfxFiles: string[] }> {
	public loadCount = 0;
	protected async loadImpl(_session: LoaderSession) {
		this.loadCount++;
		await Promise.resolve();
		return { result: { focusTrees: [treeFixture()], gfxFiles: [], overlayGfxFiles: [] }, dependencies: [file] };
	}
}

describe("previewdef/focustree build cancellation", () => {
	afterEach(() => {
		mock.restoreAll();
	});

	it("stops scheduling further focus, inlay and shortcut renders once the token is cancelled", async () => {
		const token = { isCancellationRequested: false };
		const marks = installBuildMocks({ onSprite: () => { token.isCancellationRequested = true; } });

		const build = buildFocusTreePayload(stubLoader() as never, undefined, { token });
		await assert.rejects(build, CancelledError);
		await flush();

		// At most the concurrency window already in flight; the remaining focuses never start.
		assert.ok(marks.spriteNames.length <= 8, JSON.stringify(marks.spriteNames));
		assert.ok(marks.focusRenders <= 8, String(marks.focusRenders));
		assert.deepStrictEqual(marks.spriteNames.filter(name => name === "GFX_inlay"), []);
		assert.strictEqual(marks.inlayRenders, 0);
		assert.strictEqual(marks.shortcutRenders, 0);
	});

	it("stops at an inlay render once the token is cancelled", async () => {
		const token = { isCancellationRequested: false };
		const marks = installBuildMocks({ onInlayRender: () => { token.isCancellationRequested = true; } });

		const build = buildFocusTreePayload(stubLoader() as never, undefined, { token });
		await assert.rejects(build, CancelledError);
		await flush();

		assert.strictEqual(marks.inlayRenders, 1);
		assert.strictEqual(marks.shortcutRenders, 0);
	});

	it("stops at a shortcut render once the token is cancelled", async () => {
		const token = { isCancellationRequested: false };
		const marks = installBuildMocks({ onImageByPath: () => { token.isCancellationRequested = true; } });

		const build = buildFocusTreePayload(stubLoader(2) as never, undefined, { token });
		await assert.rejects(build, CancelledError);
		await flush();

		assert.strictEqual(marks.shortcutRenders, 1);
	});

	it("rethrows a cancelled load session as a cancellation instead of an empty tree", async () => {
		const marks = installBuildMocks({});
		const loader = {
			file,
			load: async () => {
				throw new UserError("Load session cancelled.");
			},
		};

		await assert.rejects(
			buildFocusTreePayload(loader as never, undefined, { token: { isCancellationRequested: true } }),
			CancelledError,
		);
		assert.strictEqual(marks.focusRenders, 0);
	});

	it("keeps returning null for other errors, so malformed mod data stays distinct from cancellation", async () => {
		installBuildMocks({});
		const loader = {
			file,
			load: async () => {
				throw new Error("bad mod data");
			},
		};

		const result = await buildFocusTreePayload(loader as never, undefined, {});
		assert.strictEqual(result, null);
	});

	it("lets a second live consumer of a shared loader still complete", async () => {
		installBuildMocks({});
		const sharedLoader = new SharedFocusLoader();
		const consumer = { file, load: (session: LoaderSession) => sharedLoader.load(session) };

		const cancelled = buildFocusTreePayload(consumer as never, undefined, { token: { isCancellationRequested: true } });
		const live = buildFocusTreePayload(consumer as never, undefined, { token: { isCancellationRequested: false } });

		await assert.rejects(cancelled, CancelledError);
		const payload = await live;
		assert.ok(payload);
		assert.strictEqual(sharedLoader.loadCount, 1);
		assert.strictEqual(Object.keys(payload.renderedFocus).length, 25);
		assert.strictEqual(Object.keys(payload.renderedInlayWindows).length, 2);
		assert.strictEqual(payload.renderedShortcuts[0]?.length, 1);
	});
});

describe("previewdef/focustree cancelled renders", () => {
	afterEach(() => {
		mock.restoreAll();
		mock.timers.reset();
	});

	it("a closed preview's render stops working and posts neither an error nor an empty page", async () => {
		const { preview, panel } = makePreview();
		let resets = 0;
		mock.method(preview, "resetStructureState", () => { resets++; });
		const marks = installBuildMocks({ onTitlebar: () => { preview.dispose(); } });

		const render = preview.renderContent(document(), preview.uri, panel.webview, { partial: false, dependencyChanged: false });
		assert.strictEqual(await render, null);
		await flush();

		assert.strictEqual(resets, 0);
		assert.ok(marks.focusRenders <= 8, String(marks.focusRenders));
		assert.deepStrictEqual(marks.spriteNames, []);
		assert.strictEqual(marks.inlayRenders, 0);
		assert.strictEqual(marks.shortcutRenders, 0);
		assert.deepStrictEqual(postedTypes(panel).filter(type => type === "iconStyles"), []);
	});

	it("a full render stops an in-flight icon push before the new page is assigned", async () => {
		const { preview, panel } = makePreview();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const marks = installBuildMocks({ gateSprites: gate });

		const icon = preview.pushIconStyles(preview.iconRenderGeneration);
		await flush();
		assert.ok(marks.spriteNames.length > 0, "the icon push never reached its work");

		const render = preview.renderContent(document(), preview.uri, panel.webview, { partial: false, dependencyChanged: false });
		release();
		await icon;
		await render;
		await flush();

		// The eight already in flight may finish. A push that ignored the new render would
		// keep asking for every remaining focus icon.
		assert.ok(marks.spriteNames.filter(name => name === "GFX_focus").length <= 8, JSON.stringify(marks.spriteNames));
		assert.deepStrictEqual(postedTypes(panel).filter(type => type === "iconStyles"), []);
	});

	it("an icon build superseded by a newer render's generation stops working and publishes nothing", async () => {
		const { preview, panel } = makePreview();
		const marks = installBuildMocks({ onSprite: () => { preview.beforeRenderAssign(); } });

		await preview.pushIconStyles(preview.iconRenderGeneration);
		await flush();

		assert.ok(marks.spriteNames.length <= 8, JSON.stringify(marks.spriteNames));
		assert.ok(marks.focusRenders <= 8, String(marks.focusRenders));
		assert.strictEqual(marks.inlayRenders, 0);
		assert.strictEqual(marks.shortcutRenders, 0);
		assert.deepStrictEqual(postedTypes(panel).filter(type => type === "iconStyles"), []);
	});

	it("a partial render superseded by a newer render keeps the current page and stops working", async () => {
		const { preview, panel } = makePreview();
		let resets = 0;
		mock.method(preview, "resetStructureState", () => { resets++; });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const marks = installBuildMocks({ gateTitlebar: gate });

		const first = preview.renderContent(document(), preview.uri, panel.webview, { partial: true, dependencyChanged: false });
		await flush();
		assert.ok(marks.focusRenders > 0, "the first render never reached its focus work");

		// A newer render (here one that finds the tree unchanged) supersedes the first.
		preview.treeFingerprintsFor = () => ({ structural: "same", icon: "same" });
		preview.lastTreeStructural = "same";
		preview.lastTreeIcon = "same";
		assert.strictEqual(await preview.renderContent(document(), preview.uri, panel.webview, { partial: true, dependencyChanged: false }), null);

		release();
		assert.strictEqual(await first, null);
		await flush();

		assert.strictEqual(resets, 0);
		assert.ok(marks.focusRenders <= 8, String(marks.focusRenders));
		assert.deepStrictEqual(marks.spriteNames, []);
		assert.strictEqual(marks.inlayRenders, 0);
		assert.strictEqual(marks.shortcutRenders, 0);
		assert.deepStrictEqual(postedTypes(panel).filter(type => type === "iconStyles"), []);
	});

	it("a timed-out icon pass cancels its build and publishes nothing", async () => {
		const { preview, panel } = makePreview();
		mock.timers.enable({ apis: ["setTimeout"] });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const marks = installBuildMocks({ gateSprites: gate });

		const run = preview.repushResolvedIconStyles();
		await flush();
		assert.ok(marks.spriteNames.length > 0, "the icon build never reached its work");

		mock.timers.tick(60 * 1000);
		await run;
		release();
		await flush();

		assert.ok(marks.spriteNames.length <= 8, JSON.stringify(marks.spriteNames));
		assert.ok(marks.focusRenders <= 8, String(marks.focusRenders));
		assert.strictEqual(marks.inlayRenders, 0);
		assert.strictEqual(marks.shortcutRenders, 0);
		assert.deepStrictEqual(postedTypes(panel).filter(type => type === "iconStyles"), []);
	});
});
