import * as assert from "assert";
import {
	childNodes,
	hasContent,
	readBoolean,
	readModifierPairs,
	readModifierPairsFromNode,
	readScalar,
} from "../../../hoiformat/rawblock";
import { Raw } from "../../../hoiformat/schema";
import { first } from "../hoi";

const raw = (source: string): Raw => ({ _raw: first(source), _token: undefined });

describe("hoiformat/rawblock", () => {
	describe("a value", () => {
		// [what is written after `a`, readScalar, readBoolean]
		const values: [string, number | string | boolean | undefined, boolean | undefined][] = [
			["= 5", 5, undefined],
			["= -0.5", -0.5, undefined],
			['= "two words"', "two words", undefined],
			['= "yes"', "yes", undefined],
			["= yes", true, true],
			["= no", false, false],
			// A constant or a variable keeps its name, so the reader sees which one was written.
			["= @pp_bonus", "@pp_bonus", undefined],
			["= var:my_var", "var:my_var", undefined],
			["= { b = 1 }", undefined, undefined],
			["", undefined, undefined],
		];

		for (const [text, scalar, boolean] of values) {
			it(`\`a ${text}\` reads as ${JSON.stringify(scalar)}`, () => {
				const value = first(`a ${text}`).value;
				assert.strictEqual(readScalar(value), scalar);
				assert.strictEqual(readBoolean(value), boolean);
			});
		}
	});

	describe("readModifierPairs", () => {
		const modifier = `
			modifier = {
				stability_factor = 0.1
				political_power_gain = @pp_bonus
				custom_modifier_tooltip = my_tt
				Custom_Effect_Tooltip = other_tt
				hidden_modifier = { war_support_factor = 0.1 }
				disable_strategic_redeployment = yes
				a_bare_flag
				name = "two words"
			}
		`;
		const pairs = [
			{ key: "stability_factor", value: 0.1 },
			{ key: "political_power_gain", value: "@pp_bonus" },
			{ key: "disable_strategic_redeployment", value: true },
			{ key: "name", value: "two words" },
		];

		it("lists the key and value lines of a block, without tooltips and nested blocks", () => {
			assert.deepStrictEqual(readModifierPairs(raw(modifier)), pairs);
			assert.deepStrictEqual(readModifierPairsFromNode(first(modifier)), pairs);
		});

		it("lists nothing for a missing block or a value that is not one", () => {
			assert.deepStrictEqual(readModifierPairs(undefined), []);
			assert.deepStrictEqual(readModifierPairs(raw("modifier = none")), []);
		});
	});

	describe("a block's content", () => {
		const contents: [string, number][] = [
			["a = { b = 1 c = 2 }", 2],
			["a = { }", 0],
			["a = 1", 0],
		];

		for (const [source, size] of contents) {
			it(`\`${source}\` has ${size} children`, () => {
				const node = first(source);
				assert.strictEqual(childNodes(node).length, size);
				assert.strictEqual(hasContent(raw(source)), size > 0);
			});
		}

		it("is missing when the field is", () => {
			assert.strictEqual(hasContent(undefined), false);
		});
	});
});
