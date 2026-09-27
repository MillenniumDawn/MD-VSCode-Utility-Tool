import * as assert from "assert";
import * as vscode from "vscode";
import { renderBopFile } from "../previewdef/bop/contentbuilder";
import { hashUpdate, renderedHtml, LoaderRenderResult } from "../previewdef/loaderpreview";
import { BopPreviewPayload, activeRangeAt } from "../previewdef/bop/payload";
import { coverageWarnings } from "../previewdef/bop/build";
import { getBopsFromFile } from "../previewdef/bop/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { LoaderSession } from "../util/loader/loader";

const webview = {
	asWebviewUri: (u: unknown) => u,
	cspSource: "",
} as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/bop/test.txt");

function loaderFor(source: string, sessions: LoaderSession[] = []) {
	return {
		load: async (session: LoaderSession) => {
			sessions.push(session);
			return {
				result: {
					bops: getBopsFromFile(parseHoi4File(source), "common/bop/test.txt"),
					gfxFiles: [],
					modifierDefinitions: {},
				},
			};
		},
	} as any;
}

async function render(source: string): Promise<LoaderRenderResult> {
	return (await renderBopFile(loaderFor(source), uri, webview)) as LoaderRenderResult;
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
		assert.strictEqual(card.left?.id, "vadim_left_side");
		assert.strictEqual(card.right?.id, "people_right_side");
		assert.strictEqual(card.category?.key, "ROM_vadim_struggle");
		assert.deepStrictEqual(
			card.ranges.map((r) => [r.id, r.side]),
			[
				["left_far", "left"],
				["left_near", "left"],
				["mid", "centre"],
				["right_near", "right"],
				["right_far", "right"],
			],
		);
		assert.deepStrictEqual(card.ranges[0].modifiers.map((m) => m.key), ["political_power_gain"]);
		assert.deepStrictEqual(card.warnings, []);
	});

	it("keys repeated ids apart and lists sides that are not on the bar", async () => {
		const payload = payloadOf(await render(`
a = { left_side = l right_side = r side = { id = l } side = { id = r } side = { id = x range = { id = xr min = 0.5 max = 1 } } }
a = { left_side = l right_side = missing side = { id = l } }`));
		assert.deepStrictEqual(payload.cards.map((c) => c.key), ["a", "a#1"]);
		assert.deepStrictEqual(payload.cards[0].extraSides.map((s) => s.id), ["x"]);
		assert.strictEqual(payload.cards[0].extraSides[0].ranges[0].side, "right");
		assert.ok(payload.cards[1].warnings.some((w) => w.includes("missing")));
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

	// A .gfx or a modifier definition edit does not change this file, so the session has to be
	// forced or the loader hands back what it read before.
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
