import * as assert from "assert";
import { mock } from "node:test";
import { GuiFile, guiFileSchema, ContainerWindowType } from "../../../../hoiformat/gui";
import { parseHoi4File, resolveScriptVariables } from "../../../../hoiformat/hoiparser";
import { convertNodeToJson, HOIPartial } from "../../../../hoiformat/schema";
import { buildFocusTreeIconStyles, buildFocusTreePayload } from "../../../../previewdef/focustree/contentbuilder";
import { standardFocusTreeLayout, FocusTreeLayout, FocusShortcutGui } from "../../../../previewdef/focustree/layout";
import * as titlebar from "../../../../previewdef/focustree/titlebar";
import * as containerwindow from "../../../../util/hoi4gui/containerwindow";
import * as exclusivelinkimages from "../../../../util/hoi4gui/exclusivelinkimages";
import * as focuslinkimages from "../../../../util/hoi4gui/focuslinkimages";
import { focusLinkShapes } from "../../../../util/hoi4gui/focuslink";
import * as imagecache from "../../../../util/image/imagecache";
import * as localisationIndex from "../../../../util/localisationIndex";
import { refreshFeatureFlags } from "../../../../util/featureflags";
import { handOver } from "../../host";

const file = "common/national_focus/test.txt";

// Every style key the icon pass may own: the icon identities a full resolveIcons build resolves, plus
// the link classes its textured branch redraws. Anything outside these prefixes is a class minted by
// rendering focus, inlay or shortcut HTML, and the icon pass must not mint any of them.
const iconRecordPrefixes = [
	"st-focus-icon-",
	"st-focus-titlebar-",
	"st-focus-overlay-",
	"st-inlay-gfx-",
	"st-shortcut-icon-",
	"st-focus-exclusive-link",
];

function configure(settings: Record<string, unknown>): void {
	handOver({ workspace: { getConfiguration: () => settings } });
	refreshFeatureFlags();
}

const image = (name: string): imagecache.Image =>
	({ uri: `cache://${name}`, width: 16, height: 16 }) as imagecache.Image;

function focusFixture(id: string, icon: { icon: string }[]): Record<string, unknown> {
	return {
		id, x: 0, y: 0, icon, text: undefined, textIcon: undefined, overlay: undefined,
		prerequisite: [], exclusive: [], hasAllowBranch: false, inAllowBranch: [],
		allowBranch: undefined, relativePositionId: undefined, offset: [],
		token: { start: 0, end: 10 }, file,
	};
}

function parsedGuiWindow(name: string, inner: string): HOIPartial<ContainerWindowType> {
	const gui = convertNodeToJson<GuiFile>(resolveScriptVariables(parseHoi4File(
		`guiTypes = {\n\tcontainerWindowType = {\n\t\tname = "${name}"\n${inner}\n\t}\n}`,
	)), guiFileSchema);
	const window = gui.guitypes[0]?.containerwindowtype[0];
	assert.ok(window, "the fixture gui declares a window");
	return window;
}

// An inlay window the fixture tree carries: its real parsed gui window, so its slot rendering (the
// kind of HTML the icon pass must not repeat) and its inlay gfx styles are exercised as parsed.
function inlayFixture(): Record<string, unknown> {
	const guiWindow = parsedGuiWindow("slot_window", [
		"position = { x = 0 y = 0 }",
		"size = { width = 100 height = 100 }",
		'iconType = { name = "slot" spriteType = "GFX_inlay" position = { x = 10 y = 10 } }',
	].join("\n"));
	return {
		id: "inlay", file, token: undefined, windowName: "slot_window", guiWindow, internal: true, visible: true,
		position: { x: 0, y: 0 },
		scriptedImages: [{
			id: "slot", file,
			gfxOptions: [{ gfxName: "GFX_inlay", gfxFile: "interface/slots.gfx", file, condition: { scopeName: "", nodeContent: "" } }],
		}],
		scriptedButtons: [], conditionExprs: [],
	};
}

function treeFixture(): Record<string, unknown> {
	return {
		id: "test_tree", isSharedFocues: false,
		focuses: {
			focus_a: focusFixture("focus_a", [{ icon: "GFX_focus_a" }]),
			// An icon the mod names but nothing resolves: it must come out grey, not as the
			// structure pass's placeholder, and not missing from the icon CSS.
			focus_b: focusFixture("focus_b", [{ icon: "GFX_focus_missing" }]),
			// No icon at all: the shortcut targeting it draws the placeholder picture.
			focus_c: focusFixture("focus_c", []),
		},
		inlayWindows: [inlayFixture()],
		inlayWindowRefs: [], inlayConditionExprs: [], conditionExprs: [],
		warnings: [], allowBranchOptions: [],
		shortcuts: [
			{ name: "SHORT_A", target: "focus_a" },
			{ name: "SHORT_C", target: "focus_c" },
		],
	};
}

function stubLoader(extra: { layout?: FocusTreeLayout; shortcutGui?: FocusShortcutGui } = {}): unknown {
	return {
		file,
		load: async () => ({
			result: { focusTrees: [treeFixture()], gfxFiles: [], overlayGfxFiles: [], ...extra },
			dependencies: [],
		}),
	};
}

interface Counter {
	windows: number;
	labels: number;
}

function readCounter(): Counter {
	return { windows: 0, labels: 0 };
}

describe("previewdef/focustree icon style pass", () => {
	let counters: Counter;
	let originalRenderContainerWindow: typeof containerwindow.renderContainerWindow;
	let linkImageCalls = 0;

	beforeEach(() => {
		counters = readCounter();
		linkImageCalls = 0;
		configure({});
		mock.method(titlebar, "loadFocusTitlebarStyles", async () => ({}));
		mock.method(imagecache, "getSpriteByGfxName", async (name: string) =>
			name === "GFX_inlay"
				? { width: 8, height: 8, image: image("inlay_sprite"), frame: (index: number) => ({ uri: `cache://inlay_frame_${index}`, width: 8, height: 8 }) }
				: name === "GFX_focus_a"
					? { width: 8, height: 8, image: image("focus_a_sprite"), frame: () => undefined }
					: undefined,
		);
		mock.method(imagecache, "getImageByPath", async () => undefined);
		mock.method(exclusivelinkimages, "loadExclusiveLinkImages", async () => {
			linkImageCalls++;
			return {
				line: image("exclusive_line"), left: image("exclusive_left"),
				mid: image("exclusive_mid"), right: image("exclusive_right"),
			};
		});
		mock.method(focuslinkimages, "loadFocusLinkImages", async () => {
			linkImageCalls++;
			return {
				solid: Object.fromEntries(focusLinkShapes.map(shape => [shape, image("link_" + shape)])),
				dashed: Object.fromEntries(focusLinkShapes.map(shape => [shape, image("link_dashed_" + shape)])),
			} as never;
		});
		// Original behavior, plus a count: the structure pass renders inlay and shortcut windows
		// through the container window renderer, and the icon pass must not touch it at all.
		originalRenderContainerWindow = containerwindow.renderContainerWindow;
		mock.method(containerwindow, "renderContainerWindow", async (...args: unknown[]) => {
			counters.windows++;
			return originalRenderContainerWindow.apply(containerwindow, args as never);
		});
		mock.method(localisationIndex, "getLocalisedTextQuick", async (key: string) => {
			counters.labels++;
			return key;
		});
	});

	afterEach(() => {
		mock.restoreAll();
		configure({});
	});

	/** toRawCss emits one `selector { body }` rule per record with no nested braces, so scanning to the closing brace splits the rules apart. */
	function toRuleMap(css: string): Record<string, string> {
		const rules: Record<string, string> = {};
		let cursor = 0;
		for (;;) {
			const open = css.indexOf("{", cursor);
			if (open < 0) {
				break;
			}
			const close = css.indexOf("}", open);
			assert.ok(close >= 0, "fixture CSS is unbalanced");
			const key = css.slice(cursor, open).replace(/\s+/g, " ").trim();
			assert.ok(key.length > 0, "fixture CSS rule without a selector");
			// The later rule wins, like the page's cascade re-resolves the placeholder content.
			rules[key] = css.slice(open + 1, close).replace(/\s+/g, " ").trim();
			cursor = close + 1;
		}
		return rules;
	}

	function assertIconRuleSetOnly(iconCss: string): void {
		const allowed = [...iconRecordPrefixes, "st-focus-link-"];
		const stray = toRuleMap(iconCss);
		// Every rule is a dot-led class selector; the dot is stripped before the prefix check, so the
		// table's record keys and its raw selectors meet the same name prefixes.
		assert.deepStrictEqual(
			Object.keys(stray).filter(key => !allowed.some(prefix => key.replace(/^\./, "").startsWith(prefix))),
			[],
			`the icon pass minted HTML-render classes:\n${iconCss}`,
		);
	}

	async function buildStandard() {
		const loader = stubLoader() as never;
		const structure = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.ok(structure);
		return { loader, structure: structure! };
	}

	it("re-renders no focus, inlay or shortcut HTML on the standard layout", async () => {
		configure({ localisationIndex: true });
		const { loader } = await buildStandard();
		const afterStructure = { ...counters };
		assert.ok(afterStructure.windows > 0, "the fixture must render an inlay window through the container renderer");
		assert.ok(afterStructure.labels > 0, "the fixture must render focus and shortcut labels");

		const icons = await buildFocusTreeIconStyles(loader, {});
		assert.ok(icons);
		assert.strictEqual(counters.windows, afterStructure.windows, "the icon pass rendered container window HTML");
		assert.strictEqual(counters.labels, afterStructure.labels, "the icon pass rendered label HTML");
		assertIconRuleSetOnly(icons.styleTable.toRawCss());
	});

	it("re-renders no focus, inlay or shortcut HTML on the gui layout, and mints the gui's shortcut scale", async () => {
		configure({ localisationIndex: true });
		const loader = stubLoader({
			layout: { ...standardFocusTreeLayout, mode: "gui" },
			shortcutGui: {
				item: parsedGuiWindow("focus_tree_shortcut_item", [
					"position = { x = 0 y = 0 }",
					"size = { width = 190 height = 72 }",
					'buttonType = { name = "focus_button" position = { x = 37 y = 37 } scale = 2 }',
				].join("\n")),
			},
		}) as never;
		const structure = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		assert.ok(structure);
		const afterStructure = { ...counters };
		assert.ok(afterStructure.windows > 0, "the fixture must render an inlay window and the shortcut item window");
		assert.ok(afterStructure.labels > 0, "the fixture must render focus and shortcut labels");

		const icons = await buildFocusTreeIconStyles(loader, {});
		assert.ok(icons);
		assert.strictEqual(counters.windows, afterStructure.windows, "the icon pass rendered container window HTML");
		assert.strictEqual(counters.labels, afterStructure.labels, "the icon pass rendered label HTML");
		const iconCss = icons.styleTable.toRawCss();
		assertIconRuleSetOnly(iconCss);
		// The gui item's focus_button scales the picture class: scale 2 mints -200, and the
		// standard layout's fallback scale (-60) must not appear beside it.
		assert.ok(iconCss.includes("st-shortcut-icon-GFX_focus_a-200"), iconCss);
		assert.ok(!iconCss.includes("-60"), iconCss);
	});

	it("matches a full resolveIcons build rule for rule on the standard layout", async () => {
		const { loader, structure } = await buildStandard();
		const icons = await buildFocusTreeIconStyles(loader, {});
		const full = await buildFocusTreePayload(loader, undefined, { resolveIcons: true });
		assert.ok(icons && full);

		const iconCss = icons.styleTable.toRawCss();
		// The resolved icon, the grey fallback for the missing one, and the link textures all ride the icon pass.
		assert.ok(iconCss.includes("cache://focus_a_sprite"), iconCss);
		assert.ok(iconCss.includes("background: grey; background-size: 0px;"), iconCss);
		assert.ok(iconCss.includes("cache://exclusive_line"), iconCss);
		assert.ok(iconCss.includes("cache://link_left_right"), iconCss);
		assert.ok(iconCss.includes("st-inlay-gfx-"), iconCss);
		assert.ok(iconCss.includes("st-shortcut-icon-GFX_focus_a-60"), iconCss);

		// The page takes the structure CSS from head and the icon push appends the pass's rules
		// over it; that combination must carry exactly what a full resolveIcons build produces.
		const posted = structure.styleTable.toRawCss() + iconCss;
		assert.deepStrictEqual(toRuleMap(posted), toRuleMap(full.styleTable.toRawCss()));
	});

	it("matches a full resolveIcons build rule for rule on the gui layout", async () => {
		const loader = stubLoader({
			layout: { ...standardFocusTreeLayout, mode: "gui" },
			shortcutGui: {
				item: parsedGuiWindow("focus_tree_shortcut_item", [
					"position = { x = 0 y = 0 }",
					"size = { width = 190 height = 72 }",
					'buttonType = { name = "focus_button" position = { x = 37 y = 37 } scale = 2 }',
				].join("\n")),
			},
		}) as never;
		const structure = await buildFocusTreePayload(loader, undefined, { resolveIcons: false });
		const icons = await buildFocusTreeIconStyles(loader, {});
		const full = await buildFocusTreePayload(loader, undefined, { resolveIcons: true });
		assert.ok(structure && icons && full);

		const iconCss = icons.styleTable.toRawCss();
		assert.ok(iconCss.includes("st-shortcut-icon-GFX_focus_a-200"), iconCss);
		const posted = structure.styleTable.toRawCss() + iconCss;
		assert.deepStrictEqual(toRuleMap(posted), toRuleMap(full.styleTable.toRawCss()));
	});

	it("resolves the link images through the same loaders the builder uses", async () => {
		const { loader } = await buildStandard();
		const before = linkImageCalls;
		await buildFocusTreeIconStyles(loader, {});
		assert.ok(linkImageCalls >= before + 2, "the icon pass resolves both the exclusive and the prerequisite link images");
	});
});