import * as assert from "assert";
import * as vscode from "vscode";
import {
	buildFocusTreePayload,
	buildFocusTreeHtml,
	buildNoFocusTreeHtml,
	buildFocusTreeErrorHtml,
	loadFocusTreesOnly,
	focusTreeGridBox,
} from "../previewdef/focustree/contentbuilder";
import { StyleTable } from "../util/styletable";

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "test-csp",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/national_focus/test.txt");

function loaderWithTrees(trees: any[]): any {
	return {
		file: "common/national_focus/test.txt",
		load: async () => ({
			result: { focusTrees: trees, gfxFiles: [] },
		}),
	};
}

function minimalFocusTree(overrides: any = {}): any {
	return {
		id: "test_tree",
		focuses: {
			focus_a: {
				id: "focus_a",
				x: 0,
				y: 0,
				icon: [{ icon: "GFX_focus_a" }],
				text: undefined,
				textIcon: undefined,
				overlay: undefined,
				token: { start: 0, end: 10 },
				file: "common/national_focus/test.txt",
				...overrides.focus,
			},
		},
		inlayWindows: [],
		inlayWindowRefs: [],
		warnings: [],
		allowBranchOptions: [],
		_token: { start: 0, end: 20 },
		...overrides,
	};
}

describe("previewdef/focustree contentbuilder", () => {
	it("buildFocusTreePayload returns null for empty trees", async () => {
		const payload = await buildFocusTreePayload(
			loaderWithTrees([]),
			undefined,
			{ resolveIcons: false },
		);
		assert.strictEqual(payload, null);
	});

	it("buildFocusTreePayload handles loader error as null", async () => {
		const badLoader: any = {
			file: "test.txt",
			load: async () => {
				throw new Error("boom");
			},
		};
		const payload = await buildFocusTreePayload(badLoader, undefined, {
			resolveIcons: false,
		});
		assert.strictEqual(payload, null);
	});

	it("buildFocusTreePayload renders payload with one tree", async () => {
		const tree = minimalFocusTree();
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		assert.strictEqual(payload!.focusTrees.length, 1);
		assert.ok(payload!.renderedFocus["focus_a"]);
		assert.ok(payload!.renderedFocus["focus_a"].includes("focus_a"));
		assert.ok(payload!.styleTable instanceof StyleTable);
		assert.strictEqual(typeof payload!.styleNonce, "string");
		assert.strictEqual(payload!.styleNonce.length, 32);
		assert.ok(payload!.gridBox);
		assert.strictEqual(payload!.xGridSize, 96);
		assert.strictEqual(payload!.toolbarFlags.hasWarnings, false);
	});

	it("buildFocusTreePayload sets hasWarnings when a tree carries warnings", async () => {
		const tree = minimalFocusTree();
		tree.warnings = [{ text: "Focuses a and b overlap.", source: "focus_a" }];
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		// The toolbar button is baked into the shell; this flag is what flips a 0 -> 1+
		// warning transition into the full-reload path that (re)renders it.
		assert.strictEqual(payload!.toolbarFlags.hasWarnings, true);
	});

	it("buildFocusTreePayload reports progress", async () => {
		const tree = minimalFocusTree();
		const calls: string[] = [];
		const progress = (msg: string) => calls.push(msg);
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			progress,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		assert.ok(calls.length > 0);
	});

	it("loadFocusTreesOnly returns trees or null", async () => {
		const tree = minimalFocusTree();
		const trees = await loadFocusTreesOnly(loaderWithTrees([tree]));
		assert.ok(trees);
		assert.strictEqual(trees!.length, 1);
		const empty = await loadFocusTreesOnly(loaderWithTrees([]));
		assert.strictEqual(empty, null);
	});

	it("buildFocusTreeHtml embeds payload data and style", async () => {
		const tree = minimalFocusTree();
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(html.includes("window.focusTrees"));
		assert.ok(html.includes("focus_a"));
		assert.ok(html.includes("test-csp"));
		assert.ok(html.includes("focustreecontent"));
	});

	it("buildNoFocusTreeHtml contains localized placeholder", () => {
		const html = buildNoFocusTreeHtml(webview, uri);
		assert.ok(html.includes("No focus tree."));
	});

	it("buildFocusTreeErrorHtml contains error and reload button", () => {
		const html = buildFocusTreeErrorHtml(webview, uri, new Error("test error"));
		assert.ok(html.includes("Error"));
		assert.ok(html.includes("test"));
		assert.ok(html.includes('id="ft-reload"'));
		assert.ok(html.includes("Reload"));
	});

	it("focusTreeGridBox is stable", () => {
		assert.strictEqual(focusTreeGridBox.position?.x?._value, 50);
		assert.strictEqual(focusTreeGridBox.size?.width?._value, 96);
		assert.strictEqual(focusTreeGridBox.slotsize?.width?._value, 96);
	});

	it("renders multiple focuses", async () => {
		const tree: any = {
			id: "multi",
			focuses: {
				a: {
					id: "a",
					x: 0,
					y: 0,
					icon: [{ icon: "GFX_a" }],
					token: { start: 0, end: 5 },
					file: "test.txt",
				},
				b: {
					id: "b",
					x: 1,
					y: 0,
					icon: [{ icon: "GFX_b" }],
					token: { start: 6, end: 10 },
					file: "test.txt",
				},
			},
			inlayWindows: [],
			inlayWindowRefs: [],
			warnings: [],
			allowBranchOptions: [],
		};
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		assert.ok(payload!.renderedFocus["a"]);
		assert.ok(payload!.renderedFocus["b"]);
		assert.strictEqual(Object.keys(payload!.renderedFocus).length, 2);
	});

	it("buildFocusTreePayload with real icon resolution registers focus-icon styles", async () => {
		const tree = minimalFocusTree();
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: true },
		);
		assert.ok(payload);
		const css = payload!.styleTable.toRawCss();
		assert.ok(css.includes("focus-icon-"));
	});
});
