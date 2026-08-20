import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { HOIIdea, HOIIdeaCategory, getIdeasFromFile } from "../previewdef/idea/schema";
import { conditionToString } from "../hoiformat/condition";

// The blocks below are transcribed from Millennium Dawn's common/ideas/05_netherlands.txt and
// common/ideas/AA_law_economics.txt. Between them they cover what the roster needs the schema to
// keep: the two nested levels of author-chosen keys, the category's own scalars, the `name`
// override a swapped idea uses to keep the name of the one it replaced, and each of the four kinds
// of modifier block.

function categoriesOf(input: string): HOIIdeaCategory[] {
	return getIdeasFromFile(parseHoi4File(input), "test.txt").categories;
}

function category(input: string, name: string): HOIIdeaCategory {
	const found = categoriesOf(input).find((c) => c.name === name);
	assert.ok(found, `expected a category named ${name}`);
	return found;
}

function idea(input: string, categoryName: string, id: string): HOIIdea {
	const found = category(input, categoryName).ideas.find((i) => i.id === id);
	assert.ok(found, `expected an idea named ${id}`);
	return found;
}

describe("previewdef/idea/schema structure", () => {
	it("reads categories and the ideas inside them", () => {
		const categories = categoriesOf(`
            ideas = {
                country = {
                    HOL_shell1 = { picture = shell_idea }
                    HOL_shell2a = { picture = shell_idea }
                }
                hidden_ideas = {
                    HOL_hidden = { }
                }
            }
        `);

		assert.deepStrictEqual(
			categories.map((c) => c.name),
			["country", "hidden_ideas"],
		);
		assert.deepStrictEqual(
			categories[0]?.ideas.map((i) => i.id),
			["HOL_shell1", "HOL_shell2a"],
		);
		assert.deepStrictEqual(
			categories[1]?.ideas.map((i) => i.id),
			["HOL_hidden"],
		);
	});

	it("keeps a category's own scalars out of its idea list", () => {
		const economic = category(
			`
            ideas = {
                economic_cycles = {
                    law = yes
                    use_list_view = yes
                    designer = no
                    depression = { level = 6 }
                }
            }
        `,
			"economic_cycles",
		);

		assert.strictEqual(economic.isLaw, true);
		assert.strictEqual(economic.useListView, true);
		assert.strictEqual(economic.isDesigner, false);
		assert.deepStrictEqual(
			economic.ideas.map((i) => i.id),
			["depression"],
		);
	});

	it("preserves the case of an idea key", () => {
		const found = idea(
			`ideas = { country = { HOL_shell1 = { } } }`,
			"country",
			"HOL_shell1",
		);
		assert.strictEqual(found.id, "HOL_shell1");
	});

	it("ignores anything outside an ideas block", () => {
		assert.deepStrictEqual(
			categoriesOf(`
            focus_tree = { country = { not_an_idea = { } } }
        `),
			[],
		);
	});
});

describe("previewdef/idea/schema names", () => {
	it("localises an idea under its own key by default", () => {
		const found = idea(`ideas = { country = { HOL_shell1 = { } } }`, "country", "HOL_shell1");
		assert.strictEqual(found.nameKey, "HOL_shell1");
		assert.strictEqual(found.descKey, "HOL_shell1_desc");
		assert.strictEqual(found.hasNameOverride, false);
	});

	// A swapped-in idea declares the key of the one it replaced, so it keeps that idea's name and
	// description. Millennium Dawn does this throughout its idea chains.
	it("follows a name override, description included", () => {
		const found = idea(
			`ideas = { country = { HOL_shell3a = { name = HOL_shell2a } } }`,
			"country",
			"HOL_shell3a",
		);
		assert.strictEqual(found.nameKey, "HOL_shell2a");
		assert.strictEqual(found.descKey, "HOL_shell2a_desc");
		assert.strictEqual(found.hasNameOverride, true);
	});

	it("does not call a name that repeats the key an override", () => {
		const found = idea(
			`ideas = { country = { HOL_shell1 = { name = HOL_shell1 } } }`,
			"country",
			"HOL_shell1",
		);
		assert.strictEqual(found.hasNameOverride, false);
	});
});

describe("previewdef/idea/schema modifiers", () => {
	const source = `
        ideas = {
            economic_cycles = {
                law = yes
                depression = {
                    cost = 300
                    removal_cost = -1
                    level = 6
                    default = yes
                    cancel_if_invalid = no
                    allowed_civil_war = { always = yes }
                    ledger = civilian
                    traits = { warmonger fascist_demagogue }
                    modifier = {
                        stability_factor = -0.1
                        productivity_growth_modifier = -4
                        local_resources_factor = 0.25
                    }
                    research_bonus = {
                        CAT_fuel_oil = 0.05
                    }
                    targeted_modifier = {
                        tag = SOV
                        attack_bonus_against = 0.1
                    }
                    equipment_bonus = {
                        infantry_equipment = {
                            instant = yes
                            soft_attack = 0.05
                        }
                    }
                    on_add = { add_political_power = 10 }
                }
            }
        }
    `;

	it("reads every scalar the card puts on a badge", () => {
		const found = idea(source, "economic_cycles", "depression");
		assert.strictEqual(found.cost, 300);
		assert.strictEqual(found.removalCost, -1);
		assert.strictEqual(found.level, 6);
		assert.strictEqual(found.isDefault, true);
		assert.strictEqual(found.cancelIfInvalid, false);
		assert.strictEqual(found.allowedCivilWar, true);
		assert.strictEqual(found.ledger, "civilian");
		assert.deepStrictEqual(found.traits, ["warmonger", "fascist_demagogue"]);
		assert.strictEqual(found.hasOnAdd, true);
		assert.strictEqual(found.hasOnRemove, false);
	});

	it("keeps modifier keys and values in the order they were written", () => {
		const found = idea(source, "economic_cycles", "depression");
		assert.deepStrictEqual(found.modifiers, [
			{ key: "stability_factor", value: -0.1 },
			{ key: "productivity_growth_modifier", value: -4 },
			{ key: "local_resources_factor", value: 0.25 },
		]);
	});

	it("reads research bonuses, targeted modifiers and equipment bonuses separately", () => {
		const found = idea(source, "economic_cycles", "depression");

		assert.deepStrictEqual(found.researchBonuses, [{ key: "CAT_fuel_oil", value: 0.05 }]);
		assert.deepStrictEqual(found.targetedModifiers, [
			{ tag: "SOV", modifiers: [{ key: "attack_bonus_against", value: 0.1 }] },
		]);
		assert.deepStrictEqual(found.equipmentBonuses, [
			{
				archetype: "infantry_equipment",
				instant: true,
				modifiers: [{ key: "soft_attack", value: 0.05 }],
			},
		]);
	});

	it("keeps every targeted_modifier when an idea writes several", () => {
		const found = idea(
			`
            ideas = { country = { two_targets = {
                targeted_modifier = { tag = SOV attack_bonus_against = 0.1 }
                targeted_modifier = { tag = GER defense_bonus_against = 0.2 }
            } } }
        `,
			"country",
			"two_targets",
		);

		assert.deepStrictEqual(
			found.targetedModifiers.map((t) => t.tag),
			["SOV", "GER"],
		);
	});

	it("drops a nested block inside a modifier list, which has no value to show", () => {
		const found = idea(
			`
            ideas = { country = { tooltipped = {
                modifier = {
                    stability_factor = 0.1
                    some_block = { some_key = yes }
                }
            } } }
        `,
			"country",
			"tooltipped",
		);

		assert.deepStrictEqual(found.modifiers, [{ key: "stability_factor", value: 0.1 }]);
	});

	// custom_modifier_tooltip names a localisation key to print rather than a modifier to apply.
	// Millennium Dawn writes it inside `modifier` hundreds of times, so leaving it in would put a
	// line reading "Custom Modifier Tooltip: some_tt_key" on card after card.
	it("drops a tooltip key written as a scalar inside a modifier list", () => {
		const found = idea(
			`
            ideas = { country = { tooltipped = {
                modifier = {
                    stability_factor = 0.1
                    custom_modifier_tooltip = econ_cycle_upg_cost_TT
                    custom_effect_tooltip = economic_cycle_TT
                }
            } } }
        `,
			"country",
			"tooltipped",
		);

		assert.deepStrictEqual(found.modifiers, [{ key: "stability_factor", value: 0.1 }]);
	});

	it("keeps a yes/no modifier as a boolean", () => {
		const found = idea(
			`ideas = { country = { ruled = { modifier = { cant_send_volunteers = yes } } } }`,
			"country",
			"ruled",
		);
		assert.deepStrictEqual(found.modifiers, [{ key: "cant_send_volunteers", value: true }]);
	});
});

describe("previewdef/idea/schema conditions", () => {
	it("extracts allowed and available, and reports an absent block as unconditional", () => {
		const found = idea(
			`
            ideas = { country = { HOL_shell1 = {
                allowed = { original_tag = HOL }
                available = { has_idea = depression }
            } } }
        `,
			"country",
			"HOL_shell1",
		);

		assert.strictEqual(found.hasAllowed, true);
		assert.strictEqual(conditionToString(found.allowed), "original_tag = HOL");
		assert.strictEqual(found.hasAvailable, true);
		assert.strictEqual(conditionToString(found.available), "has_idea = depression");
		assert.strictEqual(found.hasVisible, false);
		assert.strictEqual(found.visible, true);
	});
});

describe("previewdef/idea/schema navigation", () => {
	it("keeps the token of each idea so a card can jump to its source", () => {
		const source = `ideas = { country = { HOL_shell1 = { } } }`;
		const found = idea(source, "country", "HOL_shell1");

		assert.ok(found.token, "expected a token");
		assert.strictEqual(
			source.slice(found.token!.start, found.token!.end),
			"HOL_shell1",
		);
		assert.strictEqual(found.file, "test.txt");
	});
});
