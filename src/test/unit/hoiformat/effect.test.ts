import * as assert from "assert";
import { ConditionComplexExpr, ConditionItem, conditionToString } from "../../../hoiformat/condition";
import {
	EffectComplexExpr,
	EffectItem,
	GuardedEffectItem,
	extractEffectValue,
	findGuardedEffectItems,
	projectEffects,
} from "../../../hoiformat/effect";
import { Scope, countryScope } from "../../../hoiformat/scope";
import { EffectTreeNode } from "../../../previewdef/sharedpayload";
import { first, parse } from "../hoi";

const germany: Scope = { scopeName: "GER", scopeType: "country" };
const a: ConditionItem = { scopeName: "", nodeContent: "a = 1" };

// An effect block as an event option reaches the evaluator: the children of the block, in a scope.
function effectOf(source: string, scope: Scope = countryScope, excludedKeys?: string[]): EffectComplexExpr {
	return extractEffectValue(parse(source).value, scope, excludedKeys).effect;
}

// What a preview is sent, on one line: statements joined by `;`, a guarded group as `when`, a
// random_list as `one of` with each branch behind its weight.
function write(nodes: EffectTreeNode[]): string {
	return nodes
		.map((node) => {
			switch (node.kind) {
				case "line":
					return (node.scopeName ? `[${node.scopeName}]` : "") + node.content;
				case "group":
					return `when ${conditionToString(node.condition)} { ${write(node.items)} }`;
				case "choice":
					return `one of { ${node.items.map((item) => `${item.possibility}: ${write(item.effect)}`).join(" | ")} }`;
			}
		})
		.join("; ");
}

function statement(nodeContent: string): EffectItem {
	return { scopeName: "", nodeContent, node: first(nodeContent) };
}

function found(items: GuardedEffectItem[]): string[] {
	return items.map(
		(guarded) =>
			(guarded.item.scopeName ? `[${guarded.item.scopeName}]` : "") +
			`${guarded.item.nodeContent} when ${conditionToString(guarded.condition)}` +
			(guarded.possibility === undefined ? "" : ` at ${guarded.possibility}`),
	);
}

describe("hoiformat/effect", () => {
	describe("an effect block", () => {
		const chain =
			"when a = 1 { x = 1 }; when and(ornot(a = 1), b = 1) { y = 1 }; when and(ornot(a = 1), ornot(b = 1)) { z = 1 }";
		const blocks: [string, string, string][] = [
			["nothing in an empty block", "", ""],
			["a statement", "add_stability = 0.1", "add_stability = 0.1"],
			["statements in the order written", "add_stability = 0.1 add_war_support = 0.05", "add_stability = 0.1; add_war_support = 0.05"],
			["a hidden_effect as part of the block around it", "hidden_effect = { set_country_flag = seen } add_stability = 0.1", "set_country_flag = seen; add_stability = 0.1"],
			["the scope a statement is written in, and leaves it again", "GER = { add_stability = 0.1 } add_war_support = 0.05", "[GER]add_stability = 0.1; add_war_support = 0.05"],
			["a scope entered from another one", "GER = { every_owned_state = { add_manpower = 100 } }", "[GER.every_owned_state]add_manpower = 100"],
			// A scope only triggers can enter stays a plain statement.
			["a trigger scope as a statement", "any_owned_state = { add_manpower = 100 }", "any_owned_state = { add_manpower = 100 }"],
			["an if as a group behind its limit", "if = { limit = { a = 1 } x = 1 }", "when a = 1 { x = 1 }"],
			["an else behind the limit negated", "if = { limit = { a = 1 } x = 1 else = { z = 1 } }", "when a = 1 { x = 1 }; when ornot(a = 1) { z = 1 }"],
			["an else_if behind every limit before it negated", "if = { limit = { a = 1 } x = 1 else_if = { limit = { b = 1 } y = 1 } else = { z = 1 } }", chain],
			["an else_if and an else written after the if the same way", "if = { limit = { a = 1 } x = 1 } else_if = { limit = { b = 1 } y = 1 } else = { z = 1 }", chain],
			["an if inside an if behind both limits", "if = { limit = { a = 1 } if = { limit = { b = 1 } x = 1 } }", "when and(a = 1, b = 1) { x = 1 }"],
			["one group for everything behind the same limit", "if = { limit = { a = 1 } x = 1 GER = { y = 1 } }", "when a = 1 { [GER]y = 1; x = 1 }"],
			["nothing for an if without a limit or an else without an if", "if = { x = 1 } else = { z = 1 } y = 1", "y = 1"],
			["nothing for an else_if or an else that is not a block", "if = { limit = { a = 1 } x = 1 } else_if = no else = no", "when a = 1 { x = 1 }"],
			[
				"a random_list as a choice between its weighted branches",
				"random_list = { 70 = { add_stability = 0.1 } 30 = { add_war_support = 0.05 } }",
				"one of { 70: add_stability = 0.1 | 30: add_war_support = 0.05 }",
			],
			[
				"a branch without the modifier that weights it",
				"random_list = { 70 = { modifier = { factor = 2 } x = 1 } 30 = { y = 1 } }",
				"one of { 70: x = 1 | 30: y = 1 }",
			],
			["the one branch left when the others have no weight", "random_list = { 0 = { x = 1 } 100 = { y = 1 } }", "y = 1"],
			["nothing for a random_list no branch of which has a weight", "random_list = { 0 = { x = 1 } }", ""],
			[
				"the if around a random_list on every branch of it",
				"if = { limit = { a = 1 } random_list = { 50 = { x = 1 } 50 = { y = 1 } } }",
				"one of { 50: when a = 1 { x = 1 } | 50: when a = 1 { y = 1 } }",
			],
		];

		for (const [title, source, expected] of blocks) {
			it(`reads ${title}`, () => {
				assert.strictEqual(write(projectEffects(effectOf(source))), expected);
			});
		}

		it("reads a block in the scope it was given", () => {
			assert.strictEqual(write(projectEffects(effectOf("add_stability = 0.1", germany))), "[GER]add_stability = 0.1");
		});

		it("skips the excluded keys of the block itself, not of a block inside it", () => {
			const effect = effectOf("ai_chance = { factor = 2 } x = 1 GER = { ai_chance = { factor = 1 } }", countryScope, ["ai_chance"]);
			assert.strictEqual(write(projectEffects(effect)), "[GER]ai_chance = { factor = 1 }; x = 1");
		});

		it("returns a lone statement bare, with the node it was parsed from", () => {
			const node = first("add_stability = 0.1");
			assert.deepStrictEqual(extractEffectValue([node], countryScope).effect, {
				scopeName: "",
				nodeContent: "add_stability = 0.1",
				node,
			});
		});

		it("returns nothing for an empty block or a value that is not a block", () => {
			assert.strictEqual(effectOf(""), null);
			assert.strictEqual(extractEffectValue(5, countryScope).effect, null);
		});
	});

	describe("projectEffects", () => {
		const line = (content: string): EffectTreeNode => ({ kind: "line", scopeName: "", content });
		const x = statement("x = 1");
		const y = statement("y = 1");

		const projections: [string, EffectComplexExpr, EffectTreeNode[]][] = [
			["nothing", null, []],
			["a statement as a line, without its node", x, [line("x = 1")]],
			[
				"an unguarded group as its items and a guarded one as a group",
				{ condition: true, items: [x, { condition: a, items: [y] }] },
				[line("x = 1"), { kind: "group", condition: a, items: [line("y = 1")] }],
			],
			["a group with nothing inside as nothing", { condition: a, items: [null, { condition: true, items: [] }] }, []],
			[
				"a random_list as a choice, without the branches that hold nothing",
				{ items: [{ possibility: 70, effect: x }, { possibility: 30, effect: null }] },
				[{ kind: "choice", items: [{ possibility: 70, effect: [line("x = 1")] }] }],
			],
			["a random_list of empty branches as nothing", { items: [{ possibility: 100, effect: null }] }, []],
		];

		for (const [title, effect, expected] of projections) {
			it(`projects ${title}`, () => {
				assert.deepStrictEqual(projectEffects(effect), expected);
			});
		}
	});

	describe("findGuardedEffectItems", () => {
		const events = ["country_event", "news_event"];
		const calls: [string, string, string[]][] = [
			["nothing in an empty block", "", []],
			["nothing when no statement has the name", "add_stability = 0.1", []],
			[
				"statements by name, whatever case the file writes it in",
				"Country_Event = a.1 add_stability = 0.1 news_event = { id = b.1 }",
				["Country_Event = a.1 when true", "news_event = { id = b.1 } when true"],
			],
			["a statement in the scope it runs in", "GER = { country_event = a.1 }", ["[GER]country_event = a.1 when true"]],
			[
				"a statement behind every if around it",
				"if = { limit = { a = 1 } if = { limit = { b = 1 } country_event = a.1 } }",
				["country_event = a.1 when and(a = 1, b = 1)"],
			],
			[
				"a statement in an else behind the negated limit",
				"if = { limit = { a = 1 } x = 1 else = { country_event = a.2 } }",
				["country_event = a.2 when ornot(a = 1)"],
			],
			[
				"a statement in a random_list with its weight, and the guard around the list once",
				"if = { limit = { a = 1 } random_list = { 30 = { country_event = a.1 } 70 = { country_event = a.2 } } }",
				["country_event = a.1 when a = 1 at 30", "country_event = a.2 when a = 1 at 70"],
			],
		];

		for (const [title, source, expected] of calls) {
			it(`finds ${title}`, () => {
				assert.deepStrictEqual(found(findGuardedEffectItems(effectOf(source), events)), expected);
			});
		}

		it("does not state a guard it was given a second time", () => {
			const effect = effectOf("if = { limit = { a = 1 } country_event = a.1 }");
			const given: ConditionComplexExpr = { ...a };
			assert.deepStrictEqual(found(findGuardedEffectItems(effect, events, given)), ["country_event = a.1 when a = 1"]);
		});

		it("adds to the list it was given", () => {
			const list: GuardedEffectItem[] = [];
			findGuardedEffectItems(effectOf("country_event = a.1"), events, true, undefined, list);
			assert.strictEqual(findGuardedEffectItems(effectOf("news_event = b.1"), events, true, undefined, list), list);
			assert.deepStrictEqual(found(list), ["country_event = a.1 when true", "news_event = b.1 when true"]);
		});
	});
});
