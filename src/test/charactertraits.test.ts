import * as assert from "assert";
import { parseHoi4File, resolveScriptVariables } from "../hoiformat/hoiparser";
import { CharacterTrait, TraitSource, readTraitFile } from "../util/characterTraits";

// The blocks below are transcribed from Millennium Dawn's common/country_leader,
// common/unit_leader and common/scientist_traits. The three directories write a trait three
// different ways, and between them these cover every shape the loader has to read: the flat
// modifiers MD writes, the `modifier = { }` block the base game writes, the per-role blocks, the
// weight blocks that must NOT be read as modifiers, and the file with no `leader_traits` wrapper.

function traitsOf(input: string, source: TraitSource = "country_leader") {
	return readTraitFile(parseHoi4File(input), source, "test.txt");
}

function trait(input: string, id: string, source?: TraitSource): CharacterTrait {
	const found = traitsOf(input, source)[id];
	assert.ok(found, `expected a trait named ${id}`);
	return found;
}

describe("util/characterTraits wrappers", () => {
	it("reads traits out of a leader_traits block", () => {
		const traits = traitsOf(`
            leader_traits = {
                honest = { opinion_gain_monthly_factor = 0.05 }
                likeable = { }
            }
        `);

		assert.deepStrictEqual(Object.keys(traits), ["honest", "likeable"]);
	});

	it("reads traits written at the top level, with no wrapper", () => {
		// common/scientist_traits is written this way; the loader must not require the wrapper.
		const traits = traitsOf(
			`
            scientist_trait_genius = {
                icon = GFX_scientist_trait_genius
                modifier = { special_project_speed_factor = 0.1 }
            }
        `,
			"scientist",
		);

		assert.deepStrictEqual(Object.keys(traits), ["scientist_trait_genius"]);
		assert.deepStrictEqual(traits["scientist_trait_genius"]?.modifiers, [
			{ key: "special_project_speed_factor", value: 0.1 },
		]);
	});

	it("reads several leader_traits blocks in one file", () => {
		const traits = traitsOf(`
            leader_traits = { first = { a = 1 } }
            leader_traits = { second = { b = 2 } }
        `);

		assert.deepStrictEqual(Object.keys(traits), ["first", "second"]);
	});

	it("records where a trait was defined, so a pill can navigate to it", () => {
		const found = trait(`leader_traits = { honest = { a = 1 } }`, "honest");

		assert.strictEqual(found.file, "test.txt");
		assert.ok(found.token);
	});
});

describe("util/characterTraits modifiers", () => {
	it("reads the flat modifiers Millennium Dawn writes", () => {
		// Not one top-level `modifier = {` exists in MD's whole common/country_leader directory:
		// every advisor and politician modifier is written flat like this.
		const found = trait(
			`
            leader_traits = {
                army_chief_logistics_1 = {
                    sprite = 6

                    experience_gain_army = 0.05
                    supply_consumption_factor = -0.05

                    command_cap_increase = @tier1

                    ai_will_do = { factor = 1 }
                }
            }
        `,
			"army_chief_logistics_1",
		);

		assert.deepStrictEqual(found.modifiers, [
			{ key: "experience_gain_army", value: 0.05 },
			{ key: "supply_consumption_factor", value: -0.05 },
			// A scripted variable has no number to scale, so it is kept as written rather than
			// dropped -- the reader at least sees which constant was used.
			{ key: "command_cap_increase", value: "@tier1" },
		]);
	});

	it("reads the modifier block the base game writes", () => {
		const found = trait(
			`leader_traits = { trickster = { modifier = { recon_factor = 0.25 } } }`,
			"trickster",
		);

		assert.deepStrictEqual(found.modifiers, [{ key: "recon_factor", value: 0.25 }]);
	});

	it("keeps a trait's descriptive scalars out of its modifiers", () => {
		const found = trait(
			`
            leader_traits = {
                spymaster = {
                    random = no
                    sprite = 15
                    cost = 500
                    gui_row = 11
                    gui_column = 0
                    custom_effect_tooltip = has_flanked
                    operative_slot = 1
                }
            }
        `,
			"spymaster",
		);

		assert.deepStrictEqual(found.modifiers, [{ key: "operative_slot", value: 1 }]);
	});

	it("does not read an ai_will_do weight as a modifier", () => {
		const found = trait(
			`
            leader_traits = {
                honest = {
                    opinion_gain_monthly_factor = 0.05
                    ai_will_do = {
                        factor = 1
                        modifier = { factor = 3 has_country_flag = x }
                    }
                }
            }
        `,
			"honest",
		);

		assert.deepStrictEqual(found.modifiers, [
			{ key: "opinion_gain_monthly_factor", value: 0.05 },
		]);
	});

	it("does not read a new_commander_weight as a modifier", () => {
		// old_guard's weight block contains `modifier = { factor = 3 ... }`, which weights which
		// commander the AI picks -- it is not something the trait grants.
		const found = trait(
			`
            leader_traits = {
                old_guard = {
                    type = land
                    trait_type = personality_trait
                    modifier = { max_dig_in = 1 }
                    non_shared_modifier = { experience_gain_factor = -0.25 }
                    new_commander_weight = {
                        factor = 1
                        modifier = {
                            factor = 3
                            FROM = { is_in_array = { ruling_party = 22 } }
                        }
                    }
                }
            }
        `,
			"old_guard",
			"unit_leader",
		);

		assert.deepStrictEqual(found.modifiers, [{ key: "max_dig_in", value: 1 }]);
		assert.deepStrictEqual(found.groups, [
			{
				title: "non_shared_modifier",
				modifiers: [{ key: "experience_gain_factor", value: -0.25 }],
			},
		]);
	});

	it("keeps each per-role modifier block as its own group", () => {
		const found = trait(
			`
            leader_traits = {
                x = {
                    corps_commander_modifier = { army_speed_factor = 0.1 }
                    field_marshal_modifier = { army_org_factor = 0.05 }
                }
            }
        `,
			"x",
			"unit_leader",
		);

		assert.deepStrictEqual(
			found.groups.map((g) => g.title),
			["corps_commander_modifier", "field_marshal_modifier"],
		);
	});

	it("keeps an equipment bonus as one group per archetype, without the instant flag", () => {
		const found = trait(
			`
            leader_traits = {
                air_force_multiplier_1 = {
                    equipment_bonus = {
                        heavy_tank_chassis = {
                            hard_attack = 0.10
                            instant = yes
                        }
                    }
                }
            }
        `,
			"air_force_multiplier_1",
		);

		assert.deepStrictEqual(found.groups, [
			{
				title: "heavy_tank_chassis",
				modifiers: [{ key: "hard_attack", value: 0.1 }],
			},
		]);
	});

	it("reads a research bonus", () => {
		const found = trait(
			`leader_traits = { x = { research_bonus = { CAT_armor = 0.1 } } }`,
			"x",
		);

		assert.deepStrictEqual(found.researchBonuses, [{ key: "CAT_armor", value: 0.1 }]);
	});

	it("drops an empty block rather than showing a group with nothing in it", () => {
		const found = trait(
			`leader_traits = { x = { non_shared_modifier = { } } }`,
			"x",
			"unit_leader",
		);

		assert.deepStrictEqual(found.groups, []);
	});
});

describe("util/characterTraits metadata and nested blocks", () => {
	// Transcribed from Millennium Dawn's common/unit_leader/02_navy_leader_traits.txt.
	const hunterKiller = `
        leader_traits = {
            hunter_killer = {
                type = navy

                modifier = {
                    navy_submarine_detection_factor = 0.2
                }

                slot = high_command
                specialist_advisor_trait = navy_anti_submarine_1
                expert_advisor_trait = navy_anti_submarine_2
                genius_advisor_trait = navy_anti_submarine_3

                ai_will_do = { factor = 1 }

                gui_row = 7
                gui_column = 2

                trait_type = assignable_trait
                any_parent = { small_ship_captain }
            }
        }
    `;

	it("keeps a commander trait's advisor metadata off the card", () => {
		// Every unrecognised flat scalar is read as a modifier, so a metadata field the denylist does
		// not name turns into a grant the game never applies -- "Slot: high_command" and three more.
		const found = trait(hunterKiller, "hunter_killer", "unit_leader");

		assert.deepStrictEqual(found.modifiers, [
			{ key: "navy_submarine_detection_factor", value: 0.2 },
		]);
		assert.deepStrictEqual(found.skillBonuses, []);
		assert.deepStrictEqual(found.groups, []);
		assert.strictEqual(found.traitType, "assignable_trait");
	});

	it("reads sub_unit_modifiers as one group per sub-unit", () => {
		// destroyer_leader grants its damage and torpedo bonuses only through this block, so dropping
		// it left the card claiming the trait grants nothing at all.
		const found = trait(
			`
            leader_traits = {
                destroyer_leader = {
                    type = navy
                    sub_unit_modifiers = {
                        destroyer = {
                            units = { destroyer_1 destroyer_2 }
                            naval_damage_factor = 0.1
                            naval_torpedo_hit_chance_factor = 0.1
                        }
                        stealth_destroyer = {
                            naval_damage_factor = 0.1
                            naval_torpedo_hit_chance_factor = 0.1
                        }
                    }
                }
            }
        `,
			"destroyer_leader",
			"unit_leader",
		);

		assert.deepStrictEqual(found.groups, [
			{
				title: "destroyer",
				modifiers: [
					{ key: "naval_damage_factor", value: 0.1 },
					{ key: "naval_torpedo_hit_chance_factor", value: 0.1 },
				],
			},
			{
				title: "stealth_destroyer",
				modifiers: [
					{ key: "naval_damage_factor", value: 0.1 },
					{ key: "naval_torpedo_hit_chance_factor", value: 0.1 },
				],
			},
		]);
		// The `units` adjuster list is a nested block, so it never reaches the card as a modifier.
		assert.deepStrictEqual(found.modifiers, []);
	});

	it("reads a modifier written as a constant defined in the same file", () => {
		// MD writes `@tier1 = 5` at the top of every advisor trait file and
		// `command_cap_increase = @tier1` inside it. loadCharacterTraits parses through
		// parseAndResolveHoi4FileCached, which is this pass; without it the card shows `@tier1`.
		const node = resolveScriptVariables(
			parseHoi4File(`
                @tier1 = 5
                leader_traits = {
                    army_chief_organizational_1 = {
                        command_cap_increase = @tier1
                        experience_gain_army = 0.05
                    }
                }
            `),
		);
		const found = readTraitFile(node, "country_leader", "test.txt")[
			"army_chief_organizational_1"
		];

		assert.deepStrictEqual(found?.modifiers, [
			{ key: "command_cap_increase", value: 5 },
			{ key: "experience_gain_army", value: 0.05 },
		]);
	});

	it("leaves a constant it cannot resolve visible rather than dropping the line", () => {
		const found = trait(
			`leader_traits = { x = { command_cap_increase = @nowhere } }`,
			"x",
		);

		assert.deepStrictEqual(found.modifiers, [
			{ key: "command_cap_increase", value: "@nowhere" },
		]);
	});
});

describe("util/characterTraits skills and types", () => {
	it("separates the skill points a trait grants from its modifiers", () => {
		const found = trait(
			`
            leader_traits = {
                armor_officer = {
                    type = land
                    trait_type = personality_trait
                    attack_skill_factor = 1
                    planning_skill = 1
                    recon_factor = 0.25
                }
            }
        `,
			"armor_officer",
			"unit_leader",
		);

		assert.deepStrictEqual(found.skillBonuses, [
			{ key: "attack_skill_factor", value: 1 },
			{ key: "planning_skill", value: 1 },
		]);
		assert.deepStrictEqual(found.modifiers, [{ key: "recon_factor", value: 0.25 }]);
	});

	it("reads a type written as a single symbol", () => {
		const found = trait(
			`leader_traits = { seawolf = { type = navy } }`,
			"seawolf",
			"unit_leader",
		);

		assert.deepStrictEqual(found.types, ["navy"]);
		assert.strictEqual(found.source, "unit_leader");
	});

	it("reads a type written as a braced list", () => {
		const found = trait(
			`leader_traits = { politically_connected = { type = { land navy } } }`,
			"politically_connected",
			"unit_leader",
		);

		assert.deepStrictEqual(found.types, ["land", "navy"]);
	});

	it("reads trait_type", () => {
		const found = trait(
			`leader_traits = { x = { trait_type = status_trait } }`,
			"x",
			"unit_leader",
		);

		assert.strictEqual(found.traitType, "status_trait");
	});
});
