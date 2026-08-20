import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { conditionToString } from "../hoiformat/condition";
import {
	HOIDecision,
	HOIDecisionCategoryRef,
	getDecisionsFromFile,
} from "../previewdef/decision/schema";

// The blocks below are transcribed from Millennium Dawn's common/decisions/00_political_decisions.txt,
// common/decisions/Poland.txt, common/decisions/05_india.txt and
// common/decisions/01_public_war_weariness_decisions.txt. Between them they cover what the graph
// needs the schema to keep: the one level of author-chosen keys, the mission discriminator, both
// spellings of `icon`, the four effect blocks, and the calls that join one decision to another.

function categoriesOf(input: string): HOIDecisionCategoryRef[] {
	return getDecisionsFromFile(parseHoi4File(input), "test.txt").categories;
}

function category(input: string, name: string): HOIDecisionCategoryRef {
	const found = categoriesOf(input).find((c) => c.name === name);
	assert.ok(found, `expected a category named ${name}`);
	return found;
}

function decision(input: string, categoryName: string, id: string): HOIDecision {
	const found = category(input, categoryName).decisions.find((d) => d.id === id);
	assert.ok(found, `expected a decision named ${id}`);
	return found;
}

describe("previewdef/decision/schema structure", () => {
	it("reads categories and the decisions inside them", () => {
		const categories = categoriesOf(`
            generic_coalition_politics_decisions = {
                leave_UNASUL = { cost = 100 }
                demobilize_after_warfare_mission = { days_mission_timeout = 180 }
            }
            public_war_wariness_decision_category = {
                AB_war_support_campaigns = { cost = 100 }
            }
        `);

		assert.deepStrictEqual(
			categories.map((c) => c.name),
			["generic_coalition_politics_decisions", "public_war_wariness_decision_category"],
		);
		assert.deepStrictEqual(
			categories[0]?.decisions.map((d) => d.id),
			["leave_UNASUL", "demobilize_after_warfare_mission"],
		);
		assert.deepStrictEqual(
			categories[1]?.decisions.map((d) => d.id),
			["AB_war_support_campaigns"],
		);
	});

	it("keeps the file each decision was written in, for click-to-source", () => {
		const found = getDecisionsFromFile(
			parseHoi4File(`cat = { d = { cost = 10 } }`),
			"common/decisions/Poland.txt",
		);
		assert.strictEqual(found.categories[0]?.file, "common/decisions/Poland.txt");
		assert.strictEqual(found.categories[0]?.decisions[0]?.file, "common/decisions/Poland.txt");
		assert.ok((found.categories[0]?.decisions[0]?.token?.end ?? 0) > 0);
	});

	it("ignores a stray scalar sitting between decisions", () => {
		// A decisions category holds nothing but decisions, so anything that does not open a block is
		// not one and must not become an empty card.
		const cat = category(
			`
            cat = {
                priority = 900
                real_decision = { cost = 10 }
            }
        `,
			"cat",
		);
		assert.deepStrictEqual(
			cat.decisions.map((d) => d.id),
			["real_decision"],
		);
	});
});

describe("previewdef/decision/schema missions", () => {
	const input = `
        cat = {
            demobilize_after_warfare_mission = {
                activation = { has_war = no }
                days_mission_timeout = 180
                icon = GFX_decision_demobilisation_button
                selectable_mission = yes
                is_good = no
                cancel_trigger = { has_war = yes }
            }
            leave_UNASUL = {
                icon = GFX_decision_generic_decision
                cost = 100
            }
        }
    `;

	it("calls a decision with days_mission_timeout a mission", () => {
		const mission = decision(input, "cat", "demobilize_after_warfare_mission");
		assert.strictEqual(mission.isMission, true);
		assert.strictEqual(mission.daysMissionTimeout, 180);
	});

	it("leaves a decision without a countdown a plain decision", () => {
		const plain = decision(input, "cat", "leave_UNASUL");
		assert.strictEqual(plain.isMission, false);
		assert.strictEqual(plain.daysMissionTimeout, undefined);
		// is_good only colours a mission's timer, so it stays absent rather than defaulting.
		assert.strictEqual(plain.isGood, undefined);
	});

	it("keeps the flags that only mean something on a mission", () => {
		const mission = decision(input, "cat", "demobilize_after_warfare_mission");
		assert.strictEqual(mission.selectableMission, true);
		assert.strictEqual(mission.isGood, false);
		assert.strictEqual(mission.hasActivation, true);
		assert.strictEqual(mission.hasCancelTrigger, true);
		assert.strictEqual(conditionToString(mission.activation), "has_war = no");
	});
});

describe("previewdef/decision/schema icons", () => {
	it("reads the bare token form", () => {
		const found = decision(`cat = { d = { icon = GFX_decision_generic_decision } }`, "cat", "d");
		assert.deepStrictEqual(
			found.icons.map((i) => i.key),
			["GFX_decision_generic_decision"],
		);
		assert.strictEqual(found.icons[0]?.condition, true);
	});

	it("reads the repeated conditional form in the order it was written", () => {
		// RAJ_maoist_suppression writes five of these; the game draws the first whose trigger holds.
		const found = decision(
			`
            cat = {
                RAJ_maoist_suppression = {
                    icon = { key = GFX_decision_com_rebel_highest trigger = { has_country_flag = a } }
                    icon = { key = GFX_decision_com_rebel_high    trigger = { has_country_flag = b } }
                    icon = GFX_decision_generic_decision
                }
            }
        `,
			"cat",
			"RAJ_maoist_suppression",
		);

		assert.deepStrictEqual(
			found.icons.map((i) => i.key),
			[
				"GFX_decision_com_rebel_highest",
				"GFX_decision_com_rebel_high",
				"GFX_decision_generic_decision",
			],
		);
		assert.strictEqual(conditionToString(found.icons[0]!.condition), "has_country_flag = a");
		assert.strictEqual(found.icons[2]?.condition, true);
	});

	it("drops an icon block that names no key", () => {
		const found = decision(`cat = { d = { icon = { trigger = { always = yes } } } }`, "cat", "d");
		assert.deepStrictEqual(found.icons, []);
	});
});

describe("previewdef/decision/schema localisation keys", () => {
	it("localises under the decision's own key by default", () => {
		const found = decision(`cat = { leave_UNASUL = { cost = 100 } }`, "cat", "leave_UNASUL");
		assert.strictEqual(found.nameKey, "leave_UNASUL");
		assert.strictEqual(found.descKey, "leave_UNASUL_desc");
		assert.strictEqual(found.hasNameOverride, false);
		assert.strictEqual(found.hasDescOverride, false);
	});

	it("follows a name override, and lets desc override independently", () => {
		const found = decision(
			`cat = { d = { name = other_key  desc = pak_raj_border_train_army_desc } }`,
			"cat",
			"d",
		);
		assert.strictEqual(found.nameKey, "other_key");
		assert.strictEqual(found.hasNameOverride, true);
		assert.strictEqual(found.descKey, "pak_raj_border_train_army_desc");
		assert.strictEqual(found.hasDescOverride, true);
	});

	it("takes the description from the borrowed name when only the name is overridden", () => {
		const found = decision(`cat = { d = { name = other_key } }`, "cat", "d");
		assert.strictEqual(found.descKey, "other_key_desc");
	});
});

describe("previewdef/decision/schema effect blocks", () => {
	const input = `
        cat = {
            d = {
                complete_effect = { add_political_power = 50 }
                remove_effect = { add_stability = -0.05 }
                timeout_effect = { country_event = poland.15 }
                cancel_effect = { clr_country_flag = running }
            }
        }
    `;

	it("keeps the four blocks apart and in a fixed order", () => {
		const found = decision(input, "cat", "d");
		assert.deepStrictEqual(
			found.effectBlocks.map((b) => b.name),
			["complete_effect", "remove_effect", "timeout_effect", "cancel_effect"],
		);
	});

	it("leaves out a block the decision does not declare", () => {
		const found = decision(`cat = { d = { complete_effect = { add_political_power = 50 } } }`, "cat", "d");
		assert.deepStrictEqual(
			found.effectBlocks.map((b) => b.name),
			["complete_effect"],
		);
	});

	it("leaves out a block that is written but empty", () => {
		const found = decision(`cat = { d = { complete_effect = { } } }`, "cat", "d");
		assert.deepStrictEqual(found.effectBlocks, []);
	});

	it("projects the three effect shapes", () => {
		const found = decision(
			`
            cat = {
                d = {
                    complete_effect = {
                        add_political_power = 50
                        if = { limit = { has_war = yes } add_stability = -0.05 }
                        random_list = {
                            50 = { add_manpower = 100 }
                            50 = { add_manpower = 200 }
                        }
                    }
                }
            }
        `,
			"cat",
			"d",
		);

		// Nested constructs are emitted where the walk meets them and the flat statements are
		// gathered onto the end, so a block's plain lines follow its `if` and `random_list` rather
		// than sitting where they were written. That is how the event preview has always shown an
		// effect block; the decision preview inherits it by using the same projection.
		const effects = found.effectBlocks[0]?.effects ?? [];
		assert.deepStrictEqual(
			effects.map((e) => e.kind),
			["group", "choice", "line"],
		);
	});
});

describe("previewdef/decision/schema calls", () => {
	it("finds what a decision activates, unlocks and removes, and says which block it came from", () => {
		const found = decision(
			`
            cat = {
                d = {
                    complete_effect = {
                        activate_mission = POL_sre_main_countdown_mission
                        unlock_decision_tooltip = some_other_decision
                    }
                    timeout_effect = { remove_mission = POL_sre_main_countdown_mission }
                }
            }
        `,
			"cat",
			"d",
		);

		assert.deepStrictEqual(
			found.calls.map((c) => `${c.kind}:${c.target}@${c.from}`),
			[
				"activate:POL_sre_main_countdown_mission@complete_effect",
				"unlock:some_other_decision@complete_effect",
				"remove:POL_sre_main_countdown_mission@timeout_effect",
			],
		);
	});

	it("carries the guard an `if` puts on a call", () => {
		const found = decision(
			`
            cat = {
                d = {
                    complete_effect = {
                        if = { limit = { has_war = yes } activate_mission = war_mission }
                    }
                }
            }
        `,
			"cat",
			"d",
		);

		assert.strictEqual(found.calls.length, 1);
		assert.strictEqual(conditionToString(found.calls[0]!.condition), "has_war = yes");
	});

	it("carries the weight of a random_list branch", () => {
		const found = decision(
			`
            cat = {
                d = {
                    complete_effect = {
                        random_list = {
                            70 = { activate_mission = good_mission }
                            30 = { activate_mission = bad_mission }
                        }
                    }
                }
            }
        `,
			"cat",
			"d",
		);

		assert.deepStrictEqual(
			found.calls.map((c) => [c.target, c.possibility]),
			[
				["good_mission", 70],
				["bad_mission", 30],
			],
		);
	});

	it("finds a call inside a hidden_effect, which the game still runs", () => {
		const found = decision(
			`
            cat = {
                d = {
                    timeout_effect = {
                        hidden_effect = { activate_mission = POL_sre_main_countdown_mission }
                    }
                }
            }
        `,
			"cat",
			"d",
		);

		assert.deepStrictEqual(
			found.calls.map((c) => c.target),
			["POL_sre_main_countdown_mission"],
		);
	});
});

describe("previewdef/decision/schema facts", () => {
	it("reads the cost as written, literal or constant", () => {
		assert.strictEqual(decision(`cat = { d = { cost = 100 } }`, "cat", "d").cost, 100);
		assert.strictEqual(
			decision(`cat = { d = { cost = @decision_cost } }`, "cat", "d").cost,
			"@decision_cost",
		);
	});

	it("reads the timers and the flags a card shows as badges", () => {
		const found = decision(
			`
            cat = {
                d = {
                    days_remove = 90
                    days_re_enable = 30
                    priority = 900
                    fire_only_once = yes
                    custom_cost_text = cost_1_5
                    on_map_mode = map_only
                }
            }
        `,
			"cat",
			"d",
		);

		assert.strictEqual(found.daysRemove, 90);
		assert.strictEqual(found.daysReEnable, 30);
		assert.strictEqual(found.priority, 900);
		assert.strictEqual(found.fireOnlyOnce, true);
		assert.strictEqual(found.customCostText, "cost_1_5");
		assert.strictEqual(found.onMapMode, "map_only");
	});

	it("reads a modifier block the way an idea's is read", () => {
		const found = decision(
			`cat = { d = { modifier = { stability_weekly = -0.001 war_support_weekly = 0.001 } } }`,
			"cat",
			"d",
		);
		assert.deepStrictEqual(found.modifiers, [
			{ key: "stability_weekly", value: -0.001 },
			{ key: "war_support_weekly", value: 0.001 },
		]);
	});

	it("reads a target list of tags or state ids, and the array form", () => {
		const found = decision(
			`
            cat = {
                d = {
                    state_target = yes
                    targets = { 456 459 991 }
                    target_array = CHI_bri_debtors
                }
            }
        `,
			"cat",
			"d",
		);

		assert.deepStrictEqual(found.targets.values, ["456", "459", "991"]);
		assert.deepStrictEqual(found.targets.arrays, ["CHI_bri_debtors"]);
		assert.strictEqual(found.targets.isState, true);
	});

	it("reads the trigger blocks and reports which were written", () => {
		const found = decision(
			`
            cat = {
                d = {
                    allowed = { original_tag = POL }
                    available = { has_war = no }
                    visible = { has_civil_war = yes }
                }
            }
        `,
			"cat",
			"d",
		);

		assert.strictEqual(found.hasAllowed, true);
		assert.strictEqual(found.hasAvailable, true);
		assert.strictEqual(found.hasVisible, true);
		assert.strictEqual(found.hasTargetTrigger, false);
		assert.strictEqual(conditionToString(found.available), "has_war = no");
		// An absent block reads as "no restriction", not as a missing value.
		assert.strictEqual(found.targetTrigger, true);
	});

	it("collects the condition leaves the preview offers as expressions", () => {
		const parsed = getDecisionsFromFile(
			parseHoi4File(`cat = { d = { available = { has_war = no } } }`),
			"test.txt",
		);
		assert.ok(parsed.conditionExprs.some((e) => e.nodeContent.includes("has_war")));
	});
});
