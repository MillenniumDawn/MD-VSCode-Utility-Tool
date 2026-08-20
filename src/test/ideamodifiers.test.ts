import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import {
	ModifierDefinitions,
	formatModifierValue,
	formatResearchBonuses,
	humaniseKey,
	readModifierDefinitions,
	resolveDefinition,
	toneFor,
} from "../previewdef/idea/modifiers";

// The definitions below are transcribed from Millennium Dawn's
// common/modifier_definitions/political_modifier_definitions.txt and the vanilla
// lar_operation_modifiers_pre_definition.txt.
//
// The two halves of this module are tested apart: what a mod wrote down, which must be obeyed
// exactly, and what has to be guessed for the modifiers the game defines internally and no file
// describes.

function definitionsOf(input: string): ModifierDefinitions {
	return readModifierDefinitions(parseHoi4File(input));
}

describe("previewdef/idea/modifiers definitions", () => {
	it("reads every field a definition can carry", () => {
		const definitions = definitionsOf(`
            operation_cost = {
                color_type = bad
                value_type = percentage
                precision = 0
                category = intelligence_agency
            }
        `);

		assert.deepStrictEqual(definitions["operation_cost"], {
			colorType: "bad",
			valueType: "percentage",
			precision: 0,
			postfix: "none",
		});
	});

	it("falls back to the game's own defaults for fields a definition leaves out", () => {
		const definitions = definitionsOf(`popularity_attack_modifier = { color_type = good }`);

		assert.deepStrictEqual(definitions["popularity_attack_modifier"], {
			colorType: "good",
			valueType: "number",
			precision: 2,
			postfix: "none",
		});
	});

	it("ignores a value that is not one the game accepts", () => {
		const definitions = definitionsOf(`
            odd = { value_type = furlongs color_type = purple postfix = fortnights }
        `);

		assert.deepStrictEqual(definitions["odd"], {
			colorType: "bad",
			valueType: "number",
			precision: 2,
			postfix: "none",
		});
	});
});

describe("previewdef/idea/modifiers resolution", () => {
	const definitions = definitionsOf(`
        productivity_growth_modifier = { color_type = good value_type = number precision = 2 }
    `);

	// The point of reading common/modifier_definitions at all: the _factor guess would call this a
	// percentage and show "-400%" where the game shows "-4.00".
	it("obeys a definition rather than guessing", () => {
		assert.strictEqual(
			resolveDefinition("productivity_growth_modifier", definitions).valueType,
			"number",
		);
	});

	it("reads an undefined _factor modifier as a percentage", () => {
		assert.strictEqual(resolveDefinition("stability_factor", {}).valueType, "percentage");
	});

	it("reads any other undefined modifier as a plain number", () => {
		assert.strictEqual(resolveDefinition("political_power_gain", {}).valueType, "number");
	});

	// The curated table exists for the modifiers the game shows as a percentage without the suffix
	// that would give it away.
	it("applies the override table to a built-in the suffix rule misses", () => {
		assert.strictEqual(resolveDefinition("monthly_population", {}).valueType, "percentage");
		assert.strictEqual(
			resolveDefinition("industrial_capacity_factory", {}).valueType,
			"percentage",
		);
		assert.strictEqual(resolveDefinition("conscription", {}).valueType, "percentage");
	});

	// A file the mod wrote about the same key wins over the curated guess, which is only ever a
	// stand-in for a file that does not exist.
	it("lets a definition beat the override table", () => {
		const definitions = definitionsOf(`conscription = { value_type = number precision = 3 }`);
		assert.strictEqual(resolveDefinition("conscription", definitions).valueType, "number");
		assert.strictEqual(resolveDefinition("conscription", definitions).precision, 3);
	});
});

describe("previewdef/idea/modifiers value formatting", () => {
	const percentage = resolveDefinition("stability_factor", {});
	const number = resolveDefinition("political_power_gain", {});

	it("scales a percentage and writes the sign", () => {
		assert.strictEqual(formatModifierValue(-0.1, percentage), "-10%");
		assert.strictEqual(formatModifierValue(0.25, percentage), "+25%");
	});

	it("leaves a plain number unscaled", () => {
		assert.strictEqual(formatModifierValue(-4, number), "-4");
		assert.strictEqual(formatModifierValue(0.3, number), "+0.3");
	});

	// percentage_in_hundred is already out of a hundred, so multiplying would be wrong twice over.
	it("does not scale percentage_in_hundred", () => {
		const definition = { ...percentage, valueType: "percentage_in_hundred" as const };
		assert.strictEqual(formatModifierValue(25, definition), "+25%");
	});

	it("trims trailing zeroes without eating the number", () => {
		assert.strictEqual(formatModifierValue(2, number), "+2");
		assert.strictEqual(formatModifierValue(0, number), "0");
		assert.strictEqual(formatModifierValue(0.5, number), "+0.5");
	});

	it("honours the precision a definition asked for", () => {
		assert.strictEqual(
			formatModifierValue(0.12345, { ...percentage, precision: 0 }),
			"+12%",
		);
	});

	it("writes a postfix the definition asked for", () => {
		assert.strictEqual(
			formatModifierValue(3, { ...number, postfix: "days" }),
			"+3 days",
		);
	});

	it("says yes or no rather than a number", () => {
		assert.strictEqual(formatModifierValue(true, number), "yes");
		assert.strictEqual(
			formatModifierValue(1, { ...number, valueType: "yes_no" }),
			"yes",
		);
		assert.strictEqual(
			formatModifierValue(0, { ...number, valueType: "yes_no" }),
			"no",
		);
	});

	// A `@constant` or a variable reference has no number to scale, so it is shown as written rather
	// than dropped.
	it("shows a symbol value as it was written", () => {
		assert.strictEqual(formatModifierValue("@stability_hit", number), "@stability_hit");
	});
});

describe("previewdef/idea/modifiers tone", () => {
	const plain = resolveDefinition("political_power_gain", {});

	it("reads a positive number as good and a negative one as bad", () => {
		assert.strictEqual(toneFor("political_power_gain", 0.3, plain, false), "good");
		assert.strictEqual(toneFor("political_power_gain", -0.3, plain, false), "bad");
	});

	it("colours nothing when the value is zero or not a number", () => {
		assert.strictEqual(toneFor("political_power_gain", 0, plain, false), "neutral");
		assert.strictEqual(toneFor("cant_send_volunteers", true, plain, false), "neutral");
	});

	// Cheaper is better, so the sign alone would colour these backwards.
	it("inverts the sign for a modifier where less is better", () => {
		const definition = resolveDefinition("production_cost_factor", {});
		assert.strictEqual(toneFor("production_cost_factor", -0.1, definition, false), "good");
		assert.strictEqual(toneFor("production_cost_factor", 0.1, definition, false), "bad");
		assert.strictEqual(toneFor("consumer_goods_factor", -0.05, definition, false), "good");
	});

	it("lets a definition's color_type decide which direction is good", () => {
		const definitions = definitionsOf(`operation_cost = { color_type = bad }`);
		const definition = resolveDefinition("operation_cost", definitions);
		assert.strictEqual(toneFor("operation_cost", -0.2, definition, true), "good");
		assert.strictEqual(toneFor("operation_cost", 0.2, definition, true), "bad");
	});

	// color_type neutral says the modifier has no inherent direction, not that its value cannot be
	// read, so it falls through to the sign rule rather than blanking the colour.
	it("falls back to the sign when a definition says the modifier is neutral", () => {
		const definitions = definitionsOf(`middling = { color_type = neutral }`);
		const definition = resolveDefinition("middling", definitions);
		assert.strictEqual(toneFor("middling", 0.2, definition, true), "good");
		assert.strictEqual(toneFor("middling", -0.2, definition, true), "bad");
	});
});

describe("previewdef/idea/modifiers research bonuses", () => {
	// A research_bonus value is always a factor, whatever the category is called, so the _factor
	// suffix rule that governs modifiers has nothing to say here.
	it("reads every research bonus as a percentage", async () => {
		const lines = await formatResearchBonuses([
			{ key: "CAT_fuel_oil", value: 0.05 },
			{ key: "armor", value: 0.1 },
		]);

		assert.deepStrictEqual(
			lines.map((l) => [l.key, l.value, l.tone]),
			[
				["CAT_fuel_oil", "+5%", "good"],
				["armor", "+10%", "good"],
			],
		);
	});

	it("reads a negative research bonus as bad", async () => {
		const lines = await formatResearchBonuses([{ key: "armor", value: -0.1 }]);
		assert.strictEqual(lines[0]?.tone, "bad");
	});

	it("makes the category readable when nothing localises it", async () => {
		const lines = await formatResearchBonuses([{ key: "CAT_fuel_oil", value: 0.05 }]);
		assert.strictEqual(lines[0]?.name, "CAT_fuel_oil".replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
	});
});

describe("previewdef/idea/modifiers naming", () => {
	it("makes a raw key readable when nothing localises it", () => {
		assert.strictEqual(humaniseKey("stability_factor"), "Stability Factor");
		assert.strictEqual(
			humaniseKey("production_speed_buildings_factor"),
			"Production Speed Buildings Factor",
		);
	});
});
