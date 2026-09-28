import * as assert from "assert";
import { decisionsOfCategory, mentionsCategory } from "../previewdef/bop/decisions";
import { getDecisionsFromFile } from "../previewdef/decision/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";

// common/decisions/05_australia.txt, cut down: the BoP's category after another one, a decision
// with a quoted name override, and one naming its icon in a block.
const australia = `
AST_other_cat = {
	AST_unrelated = { cost = 10 }
}

rudd_bop_decisions_cat = {
	toughen_up_on_boat_arrivals_ast = {
		icon = GFX_decision_generic_human_torpedo
		cost = 120
		days_remove = 160
	}
	rudd_media_blitz = {
		name = "rudd_media_blitz_name"
		icon = { key = generic_propaganda trigger = { always = yes } }
		cost = 75
	}
}`;

describe("previewdef/bop decisions", () => {
	it("finds a category opened at the start of a line", () => {
		assert.ok(mentionsCategory(australia, ["rudd_bop_decisions_cat"]));
		assert.ok(mentionsCategory(australia, ["missing", "AST_other_cat"]));
	});

	it("does not take a mention for the category itself", () => {
		assert.ok(!mentionsCategory("x = { decision_category = rudd_bop_decisions_cat }", ["rudd_bop_decisions_cat"]));
		assert.ok(!mentionsCategory("rudd_bop_decisions_cat_extra = {", ["rudd_bop_decisions_cat"]));
		assert.ok(!mentionsCategory(australia, []));
	});

	it("escapes a category name that reads as a pattern", () => {
		assert.ok(!mentionsCategory("abc = {", ["a.c"]));
		assert.ok(mentionsCategory("a.c = {", ["a.c"]));
	});

	it("collects the category's decisions in file order", () => {
		const file = getDecisionsFromFile(parseHoi4File(australia), "common/decisions/05_australia.txt");
		const decisions = decisionsOfCategory(file, "rudd_bop_decisions_cat");
		assert.deepStrictEqual(decisions.map((d) => d.id), ["toughen_up_on_boat_arrivals_ast", "rudd_media_blitz"]);
		assert.strictEqual(decisions[1].nameKey, "rudd_media_blitz_name");
		assert.strictEqual(decisions[1].icons[0].key, "generic_propaganda");
		assert.ok(decisions.every((d) => d.file === "common/decisions/05_australia.txt" && d.token !== undefined));
	});
});
