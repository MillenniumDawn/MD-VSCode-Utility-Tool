import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
	buildFocusTreePayload,
	buildFocusTreeHtml,
	buildNoFocusTreeHtml,
	buildFocusTreeErrorHtml,
	loadFocusTreesOnly,
} from "../previewdef/focustree/contentbuilder";
import { StyleTable } from "../util/styletable";
import {
	registerWarningStyles,
	warningBadgeClass,
	warningBoxClass,
	warningEntryClass,
	warningFlashClass,
	warningListClass,
} from "../previewdef/focustree/warningstyles";
import {
	registerTraceStyles,
	traceDimClass,
	traceLineClass,
} from "../previewdef/focustree/tracestyles";
import {
	exclusiveLinkClass,
	exclusiveLinkInsets,
	exclusiveLinkVerticalClass,
	registerExclusiveLinkStyles,
} from "../util/hoi4gui/exclusivelink";
import {
	_setImageWorkerPathForTest,
	_terminateImageWorkerForTest,
	_resetImageWorkerPathForTest,
} from "../util/image/imagedecoder";
import { FocusTreeLayout, focusTreeGridBoxFor, standardFocusTreeLayout } from "../previewdef/focustree/layout";

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "test-csp",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/national_focus/test.txt");

function captureConsoleError(): { consoleErrors: string[]; restore: () => void } {
	const consoleErrors: string[] = [];
	const originalConsoleError = console.error;
	console.error = (...args: any[]) => {
		consoleErrors.push(args.map(String).join(" "));
	};
	return {
		consoleErrors,
		restore: () => {
			console.error = originalConsoleError;
		},
	};
}

function loaderWithTrees(trees: any[]): any {
	return {
		file: "common/national_focus/test.txt",
		load: async () => ({
			result: { focusTrees: trees, gfxFiles: [] },
		}),
	};
}

function loaderWithLayout(trees: any[], layout: FocusTreeLayout): any {
	return {
		file: "common/national_focus/test.txt",
		load: async () => ({
			result: { focusTrees: trees, gfxFiles: [], layout },
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
		const { consoleErrors, restore } = captureConsoleError();
		try {
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
			assert.ok(
				consoleErrors.some((message) => message.includes("boom")),
				"expected the loader error to be logged",
			);
		} finally {
			restore();
		}
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
		assert.strictEqual(trees!.focusTrees.length, 1);
		assert.strictEqual(trees!.layout.mode, 'standard');
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

	it("buildFocusTreeHtml escapes a focus id that would otherwise end the inline script", async () => {
		// The parser accepts quoted identifiers, so a focus id is workspace text. The HTML parser ends
		// the script at the first `</script`, whatever the JavaScript around it means.
		const hostileId = "focus_</script><img src=x>";
		const tree = minimalFocusTree({ focus: { id: hostileId } });
		tree.focuses = { [hostileId]: tree.focuses.focus_a };
		const payload = await buildFocusTreePayload(
			loaderWithTrees([tree]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);

		// The rendered focus html escapes the id for markup, so the tag can only reach the page raw
		// through the focus data; the rendered map is still keyed by it.
		for (const name of ["focusTrees", "renderedFocus"]) {
			const script = new RegExp(`window\\.${name} = (.*?)</script>`, "s").exec(html);
			assert.ok(script, `expected the ${name} payload script`);
			assert.ok(!script![1]!.includes("</script"), script![1]!);
		}
		const trees = JSON.parse(/window\.focusTrees = (.*?)<\/script>/s.exec(html)![1]!);
		assert.strictEqual(trees[0].focuses[hostileId].id, hostileId);
		const rendered = JSON.parse(/window\.renderedFocus = (.*?)<\/script>/s.exec(html)![1]!);
		assert.ok(rendered[hostileId], Object.keys(rendered).join(","));
	});

	it("buildFocusTreeHtml embeds the useConditionInFocus setting so a hostile value cannot end the inline script", async () => {
		// Issue #220: the value comes from settings.json, which may hold anything, not only the
		// boolean the setting is declared as.
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(
			{ ...payload!, useConditionInFocus: "</script><img src=x>" as unknown as boolean },
			webview,
			uri,
		);
		const script = /window\.useConditionInFocus = (.*?)<\/script>/s.exec(html);
		assert.ok(script, "expected the useConditionInFocus script");
		assert.ok(!script![1]!.includes("</script"), script![1]!);
		assert.strictEqual(JSON.parse(script![1]!.trim()), "</script><img src=x>");

		const plain = buildFocusTreeHtml({ ...payload!, useConditionInFocus: true }, webview, uri);
		assert.ok(/window\.useConditionInFocus = true\s*<\/script>/.test(plain));
	});

	it("buildFocusTreeHtml renders the wheel setting the zoom reads", async () => {
		// html() puts it into every preview, so the webview's shared zoom code has it without each
		// contentbuilder carrying a copy. The stubbed configuration has no value for it, which is
		// the case the "auto" fallback is there for.
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(html.includes('window.previewWheel = "scroll";'));
	});

	it("buildFocusTreeHtml renders the warnings panel as a list, not a textarea", async () => {
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(html.includes(`<div id="warnings" class="${warningListClass}"`));
		assert.ok(!html.includes('<textarea id="warnings"'));
	});

	it("buildFocusTreeHtml emits the warning marker styles into the shell", async () => {
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);
		// The classes must be in the stylesheet even for a tree without warnings: the webview may
		// attach them after an in-place update turns a clean tree into a warned one.
		assert.ok(html.includes(`.${warningBoxClass} {`));
		assert.ok(html.includes(`.${warningBadgeClass} {`));
		assert.ok(html.includes(`.${warningFlashClass} {`));
		assert.ok(html.includes(`.${warningEntryClass} {`));
	});

	it("buildFocusTreeHtml shows the warning buttons only when a tree has warnings", async () => {
		const clean = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		const cleanHtml = buildFocusTreeHtml(clean!, webview, uri);
		assert.ok(!cleanHtml.includes('id="show-warnings"'));
		assert.ok(!cleanHtml.includes('id="toggle-warning-markers"'));

		const warned = minimalFocusTree();
		warned.warnings = [{ text: "Focuses a and b overlap.", source: "focus_a" }];
		const warnedPayload = await buildFocusTreePayload(
			loaderWithTrees([warned]),
			undefined,
			{ resolveIcons: false },
		);
		const warnedHtml = buildFocusTreeHtml(warnedPayload!, webview, uri);
		assert.ok(warnedHtml.includes('id="show-warnings"'));
		assert.ok(warnedHtml.includes('id="toggle-warning-markers"'));
	});

	it("registerWarningStyles emits exactly the exported class names", () => {
		const styleTable = new StyleTable();
		registerWarningStyles(styleTable);
		const css = styleTable.toRawCss();
		for (const className of [
			warningBoxClass,
			warningBadgeClass,
			warningFlashClass,
			warningListClass,
			warningEntryClass,
		]) {
			assert.ok(
				css.includes(`.${className} {`),
				`missing rule for ${className}`,
			);
		}
	});

	it("registerTraceStyles emits the exported class names, scoped so they win", () => {
		const styleTable = new StyleTable();
		registerTraceStyles(styleTable);
		const css = styleTable.toRawCss();
		for (const className of [traceLineClass, traceDimClass]) {
			// The id prefix is what beats the per-line geometry class, which is serialized into the
			// body after this stylesheet. A plain class rule here would silently lose.
			assert.ok(
				css.includes(`#focustreeplaceholder .${className} {`),
				`missing scoped rule for ${className}`,
			);
		}
	});

	it("buildFocusTreeHtml emits the trace styles into the shell", async () => {
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(html.includes(`#focustreeplaceholder .${traceLineClass} {`));
		assert.ok(html.includes(`#focustreeplaceholder .${traceDimClass} {`));
		assert.ok(html.includes('id="trace-status-container"'));
	});

	it("registerExclusiveLinkStyles falls back to the plain line without textures", () => {
		const styleTable = new StyleTable();
		registerExclusiveLinkStyles(styleTable, undefined, 96);
		const css = styleTable.toRawCss();
		assert.ok(css.includes(`.${exclusiveLinkClass} {`));
		assert.ok(css.includes(`.${exclusiveLinkClass}::before {`));
		assert.ok(css.includes("border-top: 1px solid red"));
		assert.ok(!css.includes("background-image: url("));
	});

	it("registerExclusiveLinkStyles paints the game textures when they resolve", () => {
		const image = (name: string) =>
			({ uri: `data:image/png;base64,${name}`, width: 16, height: 16 }) as any;
		const styleTable = new StyleTable();
		registerExclusiveLinkStyles(
			styleTable,
			{
				line: image("line"),
				left: image("left"),
				mid: image("mid"),
				right: image("right"),
			},
			96,
		);
		const css = styleTable.toRawCss();
		assert.ok(css.includes("background-image: url(data:image/png;base64,line)"));
		assert.ok(
			css.includes(
				"background-image: url(data:image/png;base64,left), url(data:image/png;base64,mid), url(data:image/png;base64,right)",
			),
		);
		assert.ok(!css.includes("border-top: 1px solid red"));
	});

	// The two focus tree render passes each build their own StyleTable and both land in the same
	// page, so the textured rule has to neutralize every property the fallback rule sets. Without
	// this the fallback's red border kept painting on top of the textures that replaced it.
	it("registerExclusiveLinkStyles cancels the fallback border when textures resolve", () => {
		const image = (name: string) =>
			({ uri: `data:image/png;base64,${name}`, width: 32, height: 32 }) as any;
		const styleTable = new StyleTable();
		registerExclusiveLinkStyles(
			styleTable,
			{
				line: image("line"),
				left: image("left"),
				mid: image("mid"),
				right: image("right"),
			},
			96,
		);
		const css = styleTable.toRawCss();
		assert.ok(css.includes("border-top: none"));

		// ...and the other way round, so the order the two stylesheets land in cannot matter.
		const fallback = new StyleTable();
		registerExclusiveLinkStyles(fallback, undefined, 96);
		assert.ok(fallback.toRawCss().includes("background-image: none"));
	});

	// A LEFT or RIGHT tree's exclusive pairs share a column. Its link rotates the same strips, and
	// its two branches blend in one page just like the horizontal link's do.
	it("registerExclusiveLinkStyles registers a vertical link sized by the slot height", () => {
		const image = (name: string) =>
			({ uri: `data:image/png;base64,${name}`, width: 32, height: 12 }) as any;
		const textured = new StyleTable();
		registerExclusiveLinkStyles(
			textured,
			{ line: image("line"), left: image("left"), mid: image("mid"), right: image("right") },
			96,
			0,
			130,
		);
		const fallback = new StyleTable();
		registerExclusiveLinkStyles(fallback, undefined, 96, 0, 130);

		const properties = (css: string, selector: string) => {
			const start = css.indexOf(`${selector} {`);
			assert.ok(start >= 0, `${selector} is registered`);
			const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
			return [...body.matchAll(/^\s*([a-z-]+)\s*:/gm)].map(m => m[1]).sort();
		};
		const before = `.${exclusiveLinkVerticalClass}::before`;
		assert.deepStrictEqual(properties(textured.toRawCss(), before), properties(fallback.toRawCss(), before));
		assert.ok(textured.toRawCss().includes("container-type: size"));

		const css = textured.toRawCss();
		const { iconInset, lineInset } = exclusiveLinkInsets(130, 32);
		assert.ok(css.includes(`width: calc(100cqh - ${lineInset * 2}px)`));
		assert.ok(css.includes(`width: calc(100cqh - ${iconInset * 2}px)`));
		assert.ok(css.includes("transform: translateX(6px) rotate(90deg)"));
		assert.ok(fallback.toRawCss().includes("border-left: 1px solid red"));
	});

	it("exclusiveLinkInsets keeps the marker between the boxes on both grid sizes", () => {
		// Focus tree: 96px slot, 32px icons -- the numbers the link was hand-tuned to.
		assert.deepStrictEqual(exclusiveLinkInsets(96, 32), {
			iconInset: 32,
			lineInset: 48,
		});
		// MIO tree: 87px slot, same icons.
		assert.deepStrictEqual(exclusiveLinkInsets(87, 32), {
			iconInset: 27.5,
			lineInset: 43.5,
		});
	});

	it("buildNoFocusTreeHtml contains localized placeholder", () => {
		const html = buildNoFocusTreeHtml(webview, uri);
		assert.ok(html.includes("No focus tree."));
	});

	it("buildFocusTreeErrorHtml contains error and reload button", () => {
		const html = buildFocusTreeErrorHtml(webview, uri, new Error("test error"));
		assert.ok(html.includes("Error"));
		assert.ok(html.includes("test"));
		// The button now comes from the shared error page, which every preview reaches.
		assert.ok(html.includes("<button"));
		assert.ok(html.includes("Reload"));
		assert.ok(html.includes("command: 'reload'"));
		// Its own heading survives the delegation. htmlEscape turns the spaces into &nbsp;,
		// as it always did here, so this matches a word rather than the phrase.
		assert.ok(html.includes("memory"));
	});

	it("renders the standard layout exactly as before when the loader gives no layout", async () => {
		const payload = await buildFocusTreePayload(
			loaderWithTrees([minimalFocusTree()]),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		assert.strictEqual(payload!.layout, standardFocusTreeLayout);
		assert.strictEqual(payload!.xGridSize, 96);
		assert.strictEqual(payload!.gridBox.slotsize?.height?._value, 130);
		const css = payload!.styleTable.toRawCss();
		assert.ok(css.includes("background-position-x: center;"));
		assert.ok(css.includes("background-position-y: calc(50% - 18px);"));
		assert.ok(css.includes("left: 50%;"));
		assert.ok(css.includes("top: 70px;"));
		assert.ok(css.includes("transform: translate(-50%, calc(-50% - 3px));"));
		assert.ok(css.includes("margin-top: 85px;"));
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(!html.includes("focusLinkOffsets"));
	});

	it("takes the grid, the focus layers and the link ends from a gui layout", async () => {
		const layout: FocusTreeLayout = {
			...standardFocusTreeLayout,
			mode: "gui",
			grid: { x: 70, y: 40 },
			spacing: { x: 120, y: 150 },
			item: { ...standardFocusTreeLayout.item, iconOffsetY: -8, titlebarOffsetX: 6, textOffsetX: 4 },
			links: { parent: { x: 0, y: 10 }, child: { x: 0, y: -5 } },
		};
		const payload = await buildFocusTreePayload(
			loaderWithLayout([minimalFocusTree()], layout),
			undefined,
			{ resolveIcons: false },
		);
		assert.ok(payload);
		assert.strictEqual(payload!.xGridSize, 120);
		assert.strictEqual(payload!.gridBox.position?.x?._value, 70);
		assert.strictEqual(payload!.gridBox.position?.y?._value, 40);
		assert.strictEqual(payload!.gridBox.slotsize?.width?._value, 120);
		assert.strictEqual(payload!.gridBox.slotsize?.height?._value, 150);
		const css = payload!.styleTable.toRawCss();
		assert.ok(css.includes("background-position-y: calc(50% - 8px);"));
		assert.ok(css.includes("left: calc(50% + 6px);"));
		assert.ok(css.includes("left: 4px;"));
		const html = buildFocusTreeHtml(payload!, webview, uri);
		assert.ok(html.includes('window.focusLinkOffsets = {"parent":{"x":0,"y":10},"child":{"x":0,"y":-5}}'));
	});

	it("registerExclusiveLinkStyles moves the link by the layout's offset", () => {
		const plain = new StyleTable();
		registerExclusiveLinkStyles(plain, undefined, 96, 5);
		assert.ok(plain.toRawCss().includes("top: 5px"));

		const image = (name: string) =>
			({ uri: `data:image/png;base64,${name}`, width: 16, height: 16 }) as any;
		const textured = new StyleTable();
		registerExclusiveLinkStyles(
			textured,
			{ line: image("line"), left: image("left"), mid: image("mid"), right: image("right") },
			96,
			5,
		);
		assert.ok(textured.toRawCss().includes("top: -3px"));
	});

	it("the standard layout's grid box is stable", () => {
		const gridBox = focusTreeGridBoxFor(standardFocusTreeLayout);
		assert.strictEqual(gridBox.position?.x?._value, 50);
		assert.strictEqual(gridBox.size?.width?._value, 96);
		assert.strictEqual(gridBox.slotsize?.width?._value, 96);
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
		// resolveIcons: true drives the real imagecache/imagedecoder path; GFX_focus_a and its
		// goal_unknown.dds fallback don't resolve to real game files here, so this also exercises
		// (and quiets) the image-not-found logging that path produces. Point the decoder at the
		// worker compiled into this test's outDir (imagedecoder.ts's default workerPath assumes the
		// webpack bundle layout) so decode failures are reported normally instead of via a worker
		// spawn crash, whose exit event can otherwise still be settling after this test returns.
		_setImageWorkerPathForTest(
			path.resolve(__dirname, "../util/image/imageWorker.js"),
		);
		const { restore } = captureConsoleError();
		try {
			const tree = minimalFocusTree();
			const payload = await buildFocusTreePayload(
				loaderWithTrees([tree]),
				undefined,
				{ resolveIcons: true },
			);
			assert.ok(payload);
			const css = payload!.styleTable.toRawCss();
			assert.ok(css.includes("focus-icon-"));
		} finally {
			restore();
			await _terminateImageWorkerForTest();
			_resetImageWorkerPathForTest();
		}
	});
});
