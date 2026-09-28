import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getBopsFromFile } from "../previewdef/bop/schema";

// Fixtures transcribed from Millennium Dawn's common/bop, keeping the quirks the real files have:
// no centre range, on_activate before modifier, trailing comments, a placeholder icon, and a
// custom_modifier_tooltip inside a modifier block.

function bopsOf(source: string) {
	return getBopsFromFile(parseHoi4File(source), "common/bop/test.txt").bops;
}

// common/bop/ROM.txt, trimmed to one range per side.
const rom = `
vadim_people_balance = {
	initial_value = 0.25
	left_side = vadim_left_side
	right_side = people_right_side
	decision_category = ROM_vadim_struggle
	range = {
		id = vadim_mid_range
		min = -0.1
		max = 0.1
		modifier = {
		   stability_factor = -0.05
		   political_power_gain = 0.05
		}
	}
	side = {
		id = vadim_left_side
		icon = GFX_bop_ROM_vadim
		range = {
			id = vadim_mostly_dominant_left_side
			min = -0.6
			max = -0.1
			modifier = {
				political_power_gain = 0.10
			}
		}
	}
	side = {
		id = people_right_side
		icon = GFX_bop_ROM_people
		range = {
			id = people_mostly_dominant_right_side
			min = 0.1
			max = 0.6
			modifier = {
				stability_factor = 0.10
			}
		}
	}
}`;

describe("previewdef/bop getBopsFromFile", () => {
	it("reads the header, the centre range and both sides", () => {
		const [bop] = bopsOf(rom);
		assert.strictEqual(bop.id, "vadim_people_balance");
		assert.strictEqual(bop.occurrence, 0);
		assert.strictEqual(bop.initialValue, 0.25);
		assert.strictEqual(bop.leftSide, "vadim_left_side");
		assert.strictEqual(bop.rightSide, "people_right_side");
		assert.strictEqual(bop.decisionCategory, "ROM_vadim_struggle");
		assert.strictEqual(bop.centreRange?.id, "vadim_mid_range");
		assert.deepStrictEqual(bop.centreRange?.modifiers, [
			{ key: "stability_factor", value: -0.05 },
			{ key: "political_power_gain", value: 0.05 },
		]);
		assert.deepStrictEqual(
			bop.sides.map((s) => [s.id, s.icon, s.ranges.map((r) => [r.id, r.min, r.max])]),
			[
				["vadim_left_side", "GFX_bop_ROM_vadim", [["vadim_mostly_dominant_left_side", -0.6, -0.1]]],
				["people_right_side", "GFX_bop_ROM_people", [["people_mostly_dominant_right_side", 0.1, 0.6]]],
			],
		);
		assert.ok(bop.token, "expected a token to navigate to");
	});

	// common/bop/CZE.txt: no initial_value, no centre range, on_activate written before modifier.
	it("reads a BoP with no centre range and effects before the modifier", () => {
		const [bop] = bopsOf(`
CZE_ods_cssd_bop = {
	left_side = CZE_ods_cssd_bop_left_side
	right_side = CZE_ods_cssd_bop_right_side
	side = {
		id = CZE_ods_cssd_bop_left_side
		icon = GFX_bop_CZE_ods_policy
		range = {
			id = CZE_ods_cssd_bop_left_win_range
			min = -1
			max = -0.9
			on_activate = {
				country_event = CZE_czech.12
			}
			modifier = {
				democratic_drift = 0.12
			}
			on_deactivate = { }
		}
	}
}`);
		assert.strictEqual(bop.initialValue, 0);
		assert.strictEqual(bop.centreRange, undefined);
		const range = bop.sides[0].ranges[0];
		assert.strictEqual(range.hasOnActivate, true);
		assert.strictEqual(range.hasOnDeactivate, true);
		assert.deepStrictEqual(range.modifiers, [{ key: "democratic_drift", value: 0.12 }]);
	});

	// common/bop/HOL.txt and SWE.txt.
	it("keeps a placeholder icon, skips comments and reads custom_modifier_tooltip apart", () => {
		const [bop] = bopsOf(`
HOL_fortuyn = {
	initial_value = 0
	side = {
		id = HOL_pragmatisch_fortuynisme # lvl -4
		icon = x
		range = {
			id = SWE_atlantic_alligment
			min = -1
			max = -0.7
			modifier = {
				custom_modifier_tooltip = SWE_atlantic_alligment_desc
				 #foreign_influence_defense_modifier = 0.05
				send_volunteer_size = 1
			}
		}
	}
}`);
		const side = bop.sides[0];
		assert.strictEqual(side.id, "HOL_pragmatisch_fortuynisme");
		assert.strictEqual(side.icon, "x");
		assert.deepStrictEqual(side.ranges[0].customTooltips, ["SWE_atlantic_alligment_desc"]);
		assert.deepStrictEqual(side.ranges[0].modifiers, [{ key: "send_volunteer_size", value: 1 }]);
	});

	// common/bop/POL.txt has three BoPs in one file; a repeated id must not collapse into one.
	it("keeps every BoP in a file, counting repeats of the same id", () => {
		const bops = bopsOf(`
POL_a = { initial_value = 0 }
POL_b = { initial_value = 0.25 }
POL_a = { initial_value = -0.25 }`);
		assert.deepStrictEqual(
			bops.map((b) => [b.id, b.occurrence, b.initialValue]),
			[["POL_a", 0, 0], ["POL_b", 0, 0.25], ["POL_a", 1, -0.25]],
		);
	});

	// Vanilla common/bop/ITA.txt defines more sides than the two it starts with.
	it("keeps sides beyond the two named", () => {
		const [bop] = bopsOf(`
ITA_bop = {
	left_side = a
	right_side = b
	side = { id = a icon = GFX_a }
	side = { id = b icon = GFX_b }
	side = { id = c icon = GFX_c }
}`);
		assert.deepStrictEqual(bop.sides.map((s) => s.id), ["a", "b", "c"]);
	});

	it("resolves a constant defined in the file, and reads quoted values", () => {
		const [bop] = bopsOf(`
@edge = -0.9
test_bop = {
	initial_value = "0.5"
	left_side = "quoted_side"
	side = {
		id = "quoted_side"
		icon = "GFX_bop_FIN_[GetLeaderBopIcon]_bad_side"
		range = { id = r min = -1 max = @edge }
		range = { id = s min = @edge max = 0 }
	}
}`);
		assert.strictEqual(bop.initialValue, 0.5);
		assert.strictEqual(bop.leftSide, "quoted_side");
		assert.strictEqual(bop.sides[0].id, "quoted_side");
		assert.strictEqual(bop.sides[0].ranges[1].min, -0.9);
	});
});
