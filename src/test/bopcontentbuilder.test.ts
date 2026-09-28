import * as assert from "assert";
import * as vscode from "vscode";
import { renderBopFile } from "../previewdef/bop/contentbuilder";
import { hashUpdate, renderedHtml, LoaderRenderResult } from "../previewdef/loaderpreview";
import { BopPreviewPayload, activeRangeAt, rangeBoundaries } from "../previewdef/bop/payload";
import { coverageWarnings } from "../previewdef/bop/build";
import { getBopsFromFile } from "../previewdef/bop/schema";
import { BopLoaderResult } from "../previewdef/bop/loader";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { GuiFile, guiFileSchema } from "../hoiformat/gui";
import { convertNodeToJson } from "../hoiformat/schema";
import { collectContainerWindows } from "../util/guiwindowindex";
import { LoaderSession } from "../util/loader/loader";

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/bop/test.txt");

// Millennium Dawn's interface/powerbalanceview.gui as the mod writes it: quoted names, loc keys for
// the texts, and the two range templates outside any window.
const powerBalanceGui = `guiTypes = {
	iconType = {
		name = "range_bar"
		spriteType = "GFX_bop_splitter"
		position = { x = -6 y = -4 }
		alwaystransparent = yes
	}
	iconType = {
		name = "range_indicator"
		position = { x = -14 y = -21 }
		spriteType = "GFX_bop_indicator"
	}
	containerWindowType = {
		name = "powerbalanceview"
		position = { x = 45 y = 0 }
		size = { width = 550 height = 600 }
		background = { name = "background" quadTextureSprite = "GFX_tiled_plain_bg" }
		iconType = { name = "bop_bg" quadTextureSprite = "GFX_bop_background" position = { x = 5 y = 44 } }
		instantTextboxType = { name = "title" position = { x = 37 y = 5 } font = "hoi_36header" text = balance_of_power_title maxWidth = 300 maxHeight = 20 }
		instantTextboxType = { name = "power_balance_name" format = center position = { x = 120 y = 60 } font = "hoi_20b" text = lp_vs_rp maxWidth = 300 maxHeight = 20 }
		instantTextboxType = { name = "active_range_name" format = center position = { x = 120 y = 160 } font = "hoi_20b" text = we_are_very_powerful maxWidth = 300 maxHeight = 20 }
		iconType = { name = "power_balance_frame" spriteType = "GFX_bop_bar_frame" position = { x = 91 y = 122 } }
		iconType = { name = "power_balance_value" position = { x = 95 y = 125 } }
		iconType = { name = "position_marker" spriteType = "GFX_bop_needle" position = { x = -12 y = -6 } }
		iconType = { name = "left_power_icon" position = { x = 20 y = 84 } }
		iconType = { name = "right_power_icon" position = { x = 458 y = 84 } }
	}
}`;

const guiFile = "interface/powerbalanceview.gui";

function bopWindow(): Pick<BopLoaderResult, "window" | "templates"> {
	const gui = convertNodeToJson<GuiFile>(parseHoi4File(powerBalanceGui), guiFileSchema);
	const icons = gui.guitypes.flatMap((t) => t.icontype);
	return {
		window: { file: guiFile, window: collectContainerWindows(gui).powerbalanceview },
		templates: {
			rangeBar: icons.find((i) => i.name === "range_bar"),
			rangeIndicator: icons.find((i) => i.name === "range_indicator"),
		},
	};
}

function loaderFor(source: string, sessions: LoaderSession[] = [], withWindow = true) {
	return {
		load: async (session: LoaderSession) => {
			sessions.push(session);
			const result: BopLoaderResult = {
				bops: getBopsFromFile(parseHoi4File(source), "common/bop/test.txt"),
				gfxFiles: [],
				...(withWindow ? bopWindow() : { templates: {} }),
			};
			return { result };
		},
	} as any;
}

async function render(source: string, withWindow = true): Promise<LoaderRenderResult> {
	return (await renderBopFile(loaderFor(source, [], withWindow), uri, webview)) as LoaderRenderResult;
}

function payloadOf(rendered: LoaderRenderResult): BopPreviewPayload {
	return (rendered.update!.data as { bopPreview: BopPreviewPayload }).bopPreview;
}

// common/bop/ROM.txt, with the side ranges written outer to inner as ARM.txt does.
const rom = `
vadim_people_balance = {
	initial_value = 0.25
	left_side = vadim_left_side
	right_side = people_right_side
	decision_category = ROM_vadim_struggle
	range = { id = mid min = -0.1 max = 0.1 modifier = { stability_factor = -0.05 } }
	side = {
		id = vadim_left_side
		range = { id = left_far min = -1 max = -0.6 modifier = { political_power_gain = 0.25 } }
		range = { id = left_near min = -0.6 max = -0.1 }
	}
	side = {
		id = people_right_side
		range = { id = right_near min = 0.1 max = 0.6 }
		range = { id = right_far min = 0.6 max = 1 }
	}
}`;

describe("previewdef/bop renderBopFile", () => {
	it("returns { html, update } with the bar's ranges sorted left to right", async () => {
		const rendered = await render(rom);
		assert.strictEqual(typeof rendered.html, "function");

		const [card] = payloadOf(rendered).cards;
		assert.strictEqual(card.key, "vadim_people_balance");
		assert.strictEqual(card.initialValue, 0.25);
		assert.deepStrictEqual(
			card.ranges.map((r) => r.id),
			["left_far", "left_near", "mid", "right_near", "right_far"],
		);
		assert.deepStrictEqual(card.warnings, []);
	});

	it("keys repeated ids apart, each with its own window, and leaves sides off the bar out", async () => {
		const payload = payloadOf(await render(`
a = { left_side = l right_side = r side = { id = l } side = { id = r } side = { id = x range = { id = xr min = 0.5 max = 1 } } }
a = { left_side = l right_side = missing side = { id = l } }`));
		assert.deepStrictEqual(payload.cards.map((c) => c.key), ["a", "a#1"]);
		assert.ok(payload.cards.every((c) => c.window !== undefined));
		assert.ok(!payload.cards[0].ranges.some((r) => r.id === "xr"));
		assert.ok(payload.cards[1].warnings.some((w) => w.includes("missing")));
	});

	it("draws the game window with slots for everything the value moves", async () => {
		const [card] = payloadOf(await render(rom)).cards;
		const window = card.window!;
		for (const slot of ["bop-slot-value", "bop-slot-marks", "bop-slot-needle", "bop-slot-title", "bop-slot-active-range"]) {
			assert.ok(window.html.includes(slot), `expected ${slot}`);
		}
		// Drawn at the window's own origin, not where the game slides it in on screen.
		assert.deepStrictEqual([window.width, window.height], [550, 600]);
		assert.deepStrictEqual(window.bar, { x: 95, y: 125, width: 360 });
		// The texts the game fills from code are left for the webview, not shown as their loc keys.
		assert.ok(!window.html.includes("lp_vs_rp"));
		assert.ok(!window.html.includes("we_are_very_powerful"));
		// Nothing in the window links anywhere; only the ranges do, and the webview adds those.
		assert.ok(!window.html.includes("navigator"));
		assert.ok(window.splitterHtml !== undefined && !window.splitterHtml.includes("navigator"));
		// The window's own header text is left for the webview too, keyed so it can be toggled.
		assert.deepStrictEqual(window.texts.map((t) => [t.id, t.text.key]), [["title#5", "balance_of_power_title"]]);
		assert.ok(window.html.includes("bop-slot-text-title_355"));
		assert.ok(!window.html.includes(">balance_of_power_title<"));
		assert.strictEqual(window.indicatorHtml?.length, 2);
	});

	it("warns when the game window cannot be found", async () => {
		const [card] = payloadOf(await render(rom, false)).cards;
		assert.strictEqual(card.window, undefined);
		assert.strictEqual(card.warnings.length, 1);
		assert.ok(card.warnings[0].includes("powerbalanceview"));
	});

	it("flags an initial_value outside the bar", async () => {
		const [card] = payloadOf(await render(`a = { initial_value = 2 range = { id = all min = -1 max = 1 } }`)).cards;
		assert.strictEqual(card.warnings.length, 1);
		assert.ok(card.warnings[0].includes("2"));
	});

	it("hashUpdate is stable for identical input and moves when the input does", async () => {
		const a = await render(rom);
		const b = await render(rom);
		assert.notStrictEqual(renderedHtml(a), renderedHtml(b));
		assert.strictEqual(hashUpdate(a.update!), hashUpdate(b.update!));

		const c = await render(rom.replace("max = 0.1", "max = 0.2"));
		assert.notStrictEqual(hashUpdate(a.update!), hashUpdate(c.update!));
	});

	// A .gui or .gfx edit does not change this file, so the session has to be forced or the loader
	// hands back what it read before.
	it("forces the session on a dependency change", async () => {
		const sessions: LoaderSession[] = [];
		await renderBopFile(loaderFor(rom, sessions), uri, webview);
		await renderBopFile(loaderFor(rom, sessions), uri, webview, { partial: false, dependencyChanged: true });
		assert.deepStrictEqual(sessions.map((s) => s.force), [false, true]);
	});
});

describe("previewdef/bop coverageWarnings", () => {
	const r = (id: string, min: number, max: number) => ({ id, min, max });

	it("is quiet for ranges that tile the bar", () => {
		assert.deepStrictEqual(coverageWarnings([r("a", -1, 0), r("b", 0, 1)]), []);
	});

	it("names gaps, including at both ends", () => {
		const warnings = coverageWarnings([r("a", -0.9, -0.2), r("b", 0, 0.5)]);
		assert.strictEqual(warnings.length, 3);
		assert.ok(warnings[0].includes("-1") && warnings[0].includes("-0.9"));
		assert.ok(warnings[1].includes("-0.2") && warnings[1].includes("0"));
		assert.ok(warnings[2].includes("0.5") && warnings[2].includes("1"));
	});

	it("names overlapping ranges", () => {
		const warnings = coverageWarnings([r("a", -1, 0.1), r("b", 0, 1)]);
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0].includes("a") && warnings[0].includes("b"));
	});

	it("says so when there are no ranges at all", () => {
		assert.strictEqual(coverageWarnings([]).length, 1);
	});
});

describe("previewdef/bop rangeBoundaries", () => {
	it("lists each inner boundary once, without the ends of the bar", () => {
		assert.deepStrictEqual(
			rangeBoundaries([
				{ min: -1, max: -0.1 },
				{ min: -0.1, max: 0.1 },
				{ min: 0.1, max: 0.6 },
				{ min: 0.6, max: 1 },
			]),
			[-0.1, 0.1, 0.6],
		);
	});
});

describe("previewdef/bop activeRangeAt", () => {
	const ranges = [
		{ id: "left", min: -1, max: -0.1 },
		{ id: "mid", min: -0.1, max: 0.1 },
		{ id: "right", min: 0.1, max: 1 },
	];

	it("finds the range containing the value", () => {
		assert.strictEqual(activeRangeAt(ranges, -0.5)?.id, "left");
		assert.strictEqual(activeRangeAt(ranges, 0)?.id, "mid");
		assert.strictEqual(activeRangeAt(ranges, 1)?.id, "right");
	});

	it("prefers the range nearer the centre at a shared boundary", () => {
		assert.strictEqual(activeRangeAt(ranges, -0.1)?.id, "mid");
		assert.strictEqual(activeRangeAt(ranges, 0.1)?.id, "mid");
	});

	it("finds nothing in a gap", () => {
		assert.strictEqual(activeRangeAt([ranges[0], ranges[2]], 0), undefined);
	});
});
