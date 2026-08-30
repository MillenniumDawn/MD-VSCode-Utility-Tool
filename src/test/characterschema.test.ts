import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import {
	HOICharacter,
	HOICharacterRole,
	getCharactersFromFile,
} from "../previewdef/character/schema";
import { conditionToString } from "../hoiformat/condition";

// The blocks below are transcribed from Millennium Dawn's common/characters: AFG.txt for a
// character wearing three roles at once, TUR.txt for the duplicated `portraits` category the game
// allows, CHE.txt for a quoted `expire`, and CHI.txt/UKR.txt for the advisor and scientist shapes.
// Between them they cover everything the roster needs the schema to keep.

function charactersOf(input: string): HOICharacter[] {
	return getCharactersFromFile(parseHoi4File(input), "test.txt").characters;
}

function character(input: string, id: string): HOICharacter {
	const found = charactersOf(input).find((c) => c.id === id);
	assert.ok(found, `expected a character named ${id}`);
	return found;
}

function role(character: HOICharacter, kind: string): HOICharacterRole {
	const found = character.roles.find((r) => r.kind === kind);
	assert.ok(found, `expected a ${kind} role`);
	return found;
}

const massoud = `
    characters = {
        AFG_ahmed_shah_massoud = {
            name = "Ahmad Shah Massoud"
            portraits = {
                army = {
                    small = "gfx/leaders/AFG/small/Ahmad_Shah_Massoud_small.dds"
                    large = "gfx/leaders/AFG/Ahmad_Shah_Massoud.dds"
                }
                civilian = {
                    large = "gfx/leaders/AFG/Ahmad_Shah_Massoud.dds"
                }
            }
            field_marshal = {
                traits = { trickster trait_mountaineer expert_improviser }
                skill = 5
                attack_skill = 4
                defense_skill = 5
                planning_skill = 3
                logistics_skill = 4
            }
            country_leader = {
                ideology = Neutral_Muslim_Brotherhood
                traits = {
                    guerrilla_leader
                    likeable
                }
            }
            advisor = {
                slot = army_chief
                idea_token = ahmed_shah_massoud
                traits = {
                    army_chief_planning_3
                }
                cost = 100
                ai_will_do = {
                    factor = 1.000
                    modifier = {
                        factor = 3
                        has_country_flag = wants_a_planner
                    }
                }
            }
        }
    }
`;

describe("previewdef/character/schema structure", () => {
	it("reads every character in the file", () => {
		const characters = charactersOf(`
            characters = {
                ALG_first = { name = "First" }
                ALG_second = { name = "Second" }
            }
        `);

		assert.deepStrictEqual(
			characters.map((c) => c.id),
			["ALG_first", "ALG_second"],
		);
	});

	it("keeps all three roles of a character that wears three", () => {
		const found = character(massoud, "AFG_ahmed_shah_massoud");

		assert.deepStrictEqual(
			found.roles.map((r) => r.kind),
			["field_marshal", "country_leader", "advisor"],
		);
	});

	it("reads a quoted name literally and defaults the description key to the id", () => {
		const found = character(massoud, "AFG_ahmed_shah_massoud");

		assert.strictEqual(found.name, "Ahmad Shah Massoud");
		assert.strictEqual(found.descKey, "AFG_ahmed_shah_massoud_desc");
	});

	it("reads a name written as a bare token", () => {
		// Millennium Dawn's AST.txt writes nineteen of these: the name is a localisation key rather
		// than the text itself.
		const found = character(
			`characters = { AST_tony_abbott = { name = tony_abbott } }`,
			"AST_tony_abbott",
		);

		assert.strictEqual(found.name, "tony_abbott");
	});

	it("takes the description key from an explicit desc", () => {
		const found = character(
			`
            characters = {
                TUR_bulent_ecevit = {
                    country_leader = {
                        ideology = Conservative
                        desc = "TUR_bulent_ecevit_desc"
                    }
                }
            }
        `,
			"TUR_bulent_ecevit",
		);

		assert.strictEqual(found.descKey, "TUR_bulent_ecevit_desc");
	});

	it("ignores a block that is not a role", () => {
		const found = character(
			`characters = { ALG_x = { name = "X" something_else = { a = 1 } } }`,
			"ALG_x",
		);

		assert.deepStrictEqual(found.roles, []);
	});

	it("returns nothing for a file with no characters block", () => {
		assert.deepStrictEqual(charactersOf(`# just a comment\n`), []);
		assert.deepStrictEqual(charactersOf(`ideas = { country = { x = { } } }`), []);
	});
});

describe("previewdef/character/schema portraits", () => {
	it("reads every category and size", () => {
		const found = character(massoud, "AFG_ahmed_shah_massoud");

		assert.deepStrictEqual(found.portraits, [
			{
				category: "army",
				size: "small",
				value: "gfx/leaders/AFG/small/Ahmad_Shah_Massoud_small.dds",
			},
			{
				category: "army",
				size: "large",
				value: "gfx/leaders/AFG/Ahmad_Shah_Massoud.dds",
			},
			{
				category: "civilian",
				size: "large",
				value: "gfx/leaders/AFG/Ahmad_Shah_Massoud.dds",
			},
		]);
	});

	it("merges a category written twice rather than losing the first", () => {
		// TUR_ercument_tatlioglu writes two separate `army = { }` blocks, and the game reads both.
		const found = character(
			`
            characters = {
                TUR_ercument_tatlioglu = {
                    portraits = {
                        army = { small = "gfx/leaders/TUR/small/X_small.dds" }
                        army = { large = "gfx/leaders/TUR/X.dds" }
                    }
                }
            }
        `,
			"TUR_ercument_tatlioglu",
		);

		assert.deepStrictEqual(found.portraits, [
			{ category: "army", size: "small", value: "gfx/leaders/TUR/small/X_small.dds" },
			{ category: "army", size: "large", value: "gfx/leaders/TUR/X.dds" },
		]);
	});

	it("reads a sprite name whether it is quoted or bare", () => {
		const found = character(
			`
            characters = {
                DEN_x = {
                    portraits = {
                        army = {
                            large = "GFX_Anders_Fogh_Rasmussen"
                            small = GFX_Kirsten_Jacobsen
                        }
                    }
                }
            }
        `,
			"DEN_x",
		);

		assert.deepStrictEqual(
			found.portraits.map((p) => p.value),
			["GFX_Anders_Fogh_Rasmussen", "GFX_Kirsten_Jacobsen"],
		);
	});
});

describe("previewdef/character/schema roles", () => {
	it("reads a country leader's ideology and traits", () => {
		const leader = role(character(massoud, "AFG_ahmed_shah_massoud"), "country_leader");

		assert.strictEqual(leader.ideology, "Neutral_Muslim_Brotherhood");
		assert.deepStrictEqual(leader.traits, ["guerrilla_leader", "likeable"]);
	});

	it("reads an expire date whether it is quoted or bare", () => {
		const quoted = role(
			character(
				`characters = { CHE_x = { country_leader = { expire = "2005.3.8" } } }`,
				"CHE_x",
			),
			"country_leader",
		);
		const bare = role(
			character(
				`characters = { AST_x = { country_leader = { expire = 2030.1.1.1 } } }`,
				"AST_x",
			),
			"country_leader",
		);

		assert.strictEqual(quoted.expire, "2005.3.8");
		assert.strictEqual(bare.expire, "2030.1.1.1");
	});

	it("reads a commander's skills in the game's own order", () => {
		const marshal = role(character(massoud, "AFG_ahmed_shah_massoud"), "field_marshal");

		assert.deepStrictEqual(marshal.skills, [
			{ key: "skill", value: 5 },
			{ key: "attack_skill", value: 4 },
			{ key: "defense_skill", value: 5 },
			{ key: "planning_skill", value: 3 },
			{ key: "logistics_skill", value: 4 },
		]);
	});

	it("reads a navy leader's own two skill fields", () => {
		const admiral = role(
			character(
				`
            characters = {
                TUR_x = {
                    navy_leader = {
                        traits = { fly_swatter }
                        skill = 4
                        maneuvering_skill = 3
                        coordination_skill = 2
                    }
                }
            }
        `,
				"TUR_x",
			),
			"navy_leader",
		);

		assert.deepStrictEqual(admiral.skills, [
			{ key: "skill", value: 4 },
			{ key: "maneuvering_skill", value: 3 },
			{ key: "coordination_skill", value: 2 },
		]);
	});

	it("reads an advisor's slot, token and cost", () => {
		const advisor = role(character(massoud, "AFG_ahmed_shah_massoud"), "advisor");

		assert.strictEqual(advisor.slot, "army_chief");
		assert.strictEqual(advisor.ideaToken, "ahmed_shah_massoud");
		assert.strictEqual(advisor.cost, 100);
		assert.deepStrictEqual(advisor.traits, ["army_chief_planning_3"]);
	});

	it("does not read an ai_will_do weight as the role's modifiers", () => {
		// `modifier = { factor = 3 ... }` inside ai_will_do weights an AI decision; reading it as a
		// modifier would put "Factor: +3" on the card and claim the advisor grants it.
		const advisor = role(character(massoud, "AFG_ahmed_shah_massoud"), "advisor");

		assert.deepStrictEqual(advisor.modifiers, []);
	});

	it("reads an advisor's own modifier and research_bonus blocks", () => {
		const advisor = role(
			character(
				`
            characters = {
                CHI_general_kwai = {
                    advisor = {
                        slot = high_command
                        ledger = army
                        research_bonus = { CAT_armor = 0.10 }
                        modifier = { army_org_factor = 0.05 }
                    }
                }
            }
        `,
				"CHI_general_kwai",
			),
			"advisor",
		);

		assert.strictEqual(advisor.ledger, "army");
		assert.deepStrictEqual(advisor.researchBonuses, [{ key: "CAT_armor", value: 0.1 }]);
		assert.deepStrictEqual(advisor.modifiers, [{ key: "army_org_factor", value: 0.05 }]);
	});

	it("reads a scientist's specialisation skills", () => {
		const scientist = role(
			character(
				`
            characters = {
                UKR_x = {
                    scientist = {
                        traits = { scientist_trait_bright }
                        skills = {
                            specialization_nuclear = 2
                            specialization_air = 2
                        }
                    }
                }
            }
        `,
				"UKR_x",
			),
			"scientist",
		);

		assert.deepStrictEqual(scientist.skills, [
			{ key: "specialization_nuclear", value: 2 },
			{ key: "specialization_air", value: 2 },
		]);
	});

	it("reads legacy_id", () => {
		const commander = role(
			character(
				`characters = { ALG_x = { corps_commander = { skill = 2 legacy_id = 4711 } } }`,
				"ALG_x",
			),
			"corps_commander",
		);

		assert.strictEqual(commander.legacyId, 4711);
	});

	it("reads the conditions an advisor is gated on", () => {
		const advisor = role(
			character(
				`
            characters = {
                ENG_richard_moore = {
                    advisor = {
                        slot = political_advisor
                        allowed = { original_tag = ENG }
                        available = { has_intelligence_agency = yes }
                        on_add = { OWNER = { set_country_flag = x } }
                    }
                }
            }
        `,
				"ENG_richard_moore",
			),
			"advisor",
		);

		assert.strictEqual(conditionToString(advisor.allowed), "original_tag = ENG");
		assert.strictEqual(
			conditionToString(advisor.available),
			"has_intelligence_agency = yes",
		);
		assert.strictEqual(advisor.visible, true);
		assert.strictEqual(advisor.hasOnAdd, true);
		assert.strictEqual(advisor.hasOnRemove, false);
	});

	it("points navigation at the role's own line", () => {
		const found = character(massoud, "AFG_ahmed_shah_massoud");
		const marshal = role(found, "field_marshal");

		assert.ok(found.token);
		assert.ok(marshal.token);
		assert.ok(marshal.token.start > found.token.start);
	});
});
