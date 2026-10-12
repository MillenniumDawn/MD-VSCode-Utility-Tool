import * as assert from "assert";
import {
	ConditionComplexExpr,
	ConditionFolderType,
	ConditionItem,
	andCondition,
	applyCondition,
	conditionToString,
	extractConditionFolder,
	extractConditionValue,
	extractConditionValues,
	extractConditionalExprs,
	simplifyCondition,
} from "../../../hoiformat/condition";
import { countryScope } from "../../../hoiformat/scope";
import { parse } from "../hoi";

const leaf = (nodeContent: string, scopeName = ""): ConditionItem => ({ scopeName, nodeContent });
const folder = (type: ConditionFolderType) => (...items: ConditionComplexExpr[]): ConditionComplexExpr => ({ type, items });
const and = folder("and");
const or = folder("or");
const ornot = folder("ornot");
const andnot = folder("andnot");
const count = (amount: number, ...items: ConditionComplexExpr[]): ConditionComplexExpr => ({ type: "count", amount, items });

const a = leaf("a = 1");
const b = leaf("b = 1");
const c = leaf("c = 1");
const x = leaf("x = 1");
const y = leaf("y = 1");
const z = leaf("z = 1");

// A trigger block as a focus's `available` reaches the evaluator: in the country scope, simplified.
function trigger(source: string): ConditionComplexExpr {
	return extractConditionValue(parse(source).value, countryScope).condition;
}

// Every way of holding some of the leaves true and the rest false.
function assignments(leaves: ConditionItem[]): ConditionItem[][] {
	return Array.from({ length: 1 << leaves.length }, (_, mask) => leaves.filter((_leaf, i) => mask & (1 << i)));
}

function assertSameTruth(actual: ConditionComplexExpr, expected: ConditionComplexExpr, leaves: ConditionItem[]): void {
	for (const held of assignments(leaves)) {
		assert.strictEqual(
			applyCondition(actual, held),
			applyCondition(expected, held),
			`with ${held.map(conditionToString).join(", ") || "nothing"} held`,
		);
	}
}

describe("hoiformat/condition", () => {
	describe("conditionToString", () => {
		const strings: [ConditionComplexExpr, string][] = [
			[true, "true"],
			[false, "false"],
			[leaf("has_war = yes"), "has_war = yes"],
			[leaf("has_war = yes", "GER"), "[GER]has_war = yes"],
			[and(a, or(b, c)), "and(a = 1, or(b = 1, c = 1))"],
			[andnot(a, ornot(b)), "andnot(a = 1, ornot(b = 1))"],
			[count(2, a, b, c), "count(a = 1, b = 1, c = 1) == 2"],
		];

		for (const [condition, expected] of strings) {
			it(`writes ${expected}`, () => {
				assert.strictEqual(conditionToString(condition), expected);
			});
		}
	});

	describe("a trigger block", () => {
		const triggers: [string, string][] = [
			["", "true"],
			["has_war = yes", "has_war = yes"],
			["has_war = yes is_major = yes", "and(has_war = yes, is_major = yes)"],
			["num_of_factories > 50 date > 1936.1.1", "and(num_of_factories > 50, date > 1936.1.1)"],
			['has_idea = "two words"', 'has_idea = "two words"'],
			["has_country_flag = { flag = seen days > 30 }", "has_country_flag = { flag = seen days > 30 }"],
			["OR = { a = 1 b = 1 }", "or(a = 1, b = 1)"],
			["or = { a = 1 b = 1 }", "or(a = 1, b = 1)"],
			["AND = { a = 1 b = 1 }", "and(a = 1, b = 1)"],
			["hidden_trigger = { a = 1 }", "a = 1"],
			["NOT = { a = 1 }", "ornot(a = 1)"],
			["NOT = { a = 1 b = 1 }", "ornot(a = 1, b = 1)"],
			["NOT = { NOT = { a = 1 } }", "a = 1"],
			["custom_trigger_tooltip = { tooltip = my_tt a = 1 }", "a = 1"],
			["always = yes", "true"],
			["always = no", "false"],
			['always = "yes"', "true"],
			["a = 1 always = no", "false"],
			["OR = { a = 1 always = yes }", "true"],
			["count_triggers = { amount = 2 a = 1 b = 1 c = 1 }", "count(a = 1, b = 1, c = 1) == 2"],
			["count_triggers = { amount = 3 a = 1 b = 1 c = 1 }", "and(a = 1, b = 1, c = 1)"],
			["count_triggers = { amount = 4 a = 1 b = 1 c = 1 }", "false"],
			["count_triggers = { amount = 1 a = 1 always = yes }", "true"],
			["count_triggers = { amount = 1 always = yes }", "true"],
			["count_triggers = { a = 1 }", "true"],
			["GER = { has_war = yes }", "[GER]has_war = yes"],
			["GER = { any_owned_state = { is_coastal = yes } } is_major = yes", "and([GER.any_owned_state]is_coastal = yes, is_major = yes)"],
			// A scope only effects can enter stays a plain trigger line.
			["every_country = { has_war = yes }", "every_country = { has_war = yes }"],
		];

		for (const [source, expected] of triggers) {
			it(`reads \`${source}\` as ${expected}`, () => {
				assert.strictEqual(conditionToString(trigger(source)), expected);
			});
		}
	});

	describe("an if in a trigger block", () => {
		type Held = (item: ConditionItem) => boolean;
		const chains: [string, string, ConditionItem[], (held: Held) => boolean][] = [
			["passes unless its limit holds and its body does not", "if = { limit = { a = 1 } x = 1 }", [a, x], (h) => !h(a) || h(x)],
			["takes its else when the limit does not hold", "if = { limit = { a = 1 } x = 1 else = { z = 1 } }", [a, x, z], (h) => (h(a) ? h(x) : h(z))],
			[
				"walks else_if and else nested in it as one chain",
				"if = { limit = { a = 1 } x = 1 else_if = { limit = { b = 1 } y = 1 } else = { z = 1 } }",
				[a, b, x, y, z],
				(h) => (h(a) ? h(x) : h(b) ? h(y) : h(z)),
			],
			[
				"walks else_if and else written after it the same way",
				"if = { limit = { a = 1 } x = 1 } else_if = { limit = { b = 1 } y = 1 } else = { z = 1 }",
				[a, b, x, y, z],
				(h) => (h(a) ? h(x) : h(b) ? h(y) : h(z)),
			],
			[
				"passes when no limit of a chain without an else holds",
				"if = { limit = { a = 1 } x = 1 } else_if = { limit = { b = 1 } y = 1 } else_if = { limit = { c = 1 } z = 1 }",
				[a, b, c, x, y, z],
				(h) => (h(a) ? h(x) : h(b) ? h(y) : h(c) ? h(z) : true),
			],
			["is one trigger among the others around it", "y = 1 if = { limit = { a = 1 } x = 1 } z = 1", [a, x, y, z], (h) => h(y) && (!h(a) || h(x)) && h(z)],
			["loses an else that does not follow it directly", "if = { limit = { a = 1 } x = 1 } y = 1 else = { z = 1 }", [a, x, y, z], (h) => (!h(a) || h(x)) && h(y)],
			["is ignored without a limit", "if = { x = 1 } y = 1", [x, y], (h) => h(y)],
			["leaves an else and an else_if with no if before them ignored", "else_if = { limit = { a = 1 } x = 1 } else = { z = 1 } y = 1", [a, x, y, z], (h) => h(y)],
			["ignores an else_if that is not a block", "if = { limit = { a = 1 } x = 1 } else_if = no", [a, x], (h) => !h(a) || h(x)],
		];

		for (const [title, source, leaves, expected] of chains) {
			it(title, () => {
				const raw = extractConditionFolder(parse(source).value, [countryScope]);
				for (const held of assignments(leaves)) {
					const holds = expected((item) => held.includes(item));
					const message = `with ${held.map(conditionToString).join(", ") || "nothing"} held`;
					assert.strictEqual(applyCondition(raw, held), holds, message);
					assert.strictEqual(applyCondition(trigger(source), held), holds, `simplified, ${message}`);
				}
			});
		}
	});

	describe("simplifyCondition", () => {
		const simplified: [ConditionComplexExpr, string][] = [
			[true, "true"],
			[a, "a = 1"],
			[and(), "true"],
			[or(), "false"],
			[ornot(), "true"],
			[andnot(), "false"],
			[and(a, false), "false"],
			[and(a, true), "a = 1"],
			[and(true, true), "true"],
			[or(a, true), "true"],
			[or(a, false), "a = 1"],
			[or(false, false), "false"],
			[ornot(a, true), "false"],
			[ornot(false), "true"],
			[andnot(a, false), "true"],
			[andnot(true), "false"],
			[andnot(a), "ornot(a = 1)"],
			[andnot(a, b), "andnot(a = 1, b = 1)"],
			[ornot(a, b), "ornot(a = 1, b = 1)"],
			[ornot(ornot(a, b)), "or(a = 1, b = 1)"],
			[ornot(andnot(a, b)), "and(a = 1, b = 1)"],
			[ornot(ornot(a)), "a = 1"],
			[and(and(a), or(b), and(true)), "and(a = 1, b = 1)"],
			[or(and(a, false), and(b, c)), "and(b = 1, c = 1)"],
			[count(2, a, b, c), "count(a = 1, b = 1, c = 1) == 2"],
			[count(2, true, a, b), "count(a = 1, b = 1) == 1"],
			[count(2, false, a, b), "and(a = 1, b = 1)"],
			[count(1, true, a), "true"],
			[count(1, true), "true"],
			[count(0), "true"],
			[count(1), "false"],
			[count(3, a, b), "false"],
			[count(1, a), "a = 1"],
		];

		for (const [condition, expected] of simplified) {
			it(`turns ${conditionToString(condition)} into ${expected}`, () => {
				const result = simplifyCondition(condition);
				assert.strictEqual(conditionToString(result), expected);
				assertSameTruth(result, condition, [a, b, c]);
			});
		}
	});

	describe("applyCondition", () => {
		const folders: [string, ConditionComplexExpr, (a: boolean, b: boolean) => boolean][] = [
			["and", and(a, b), (p, q) => p && q],
			["or", or(a, b), (p, q) => p || q],
			["andnot", andnot(a, b), (p, q) => !(p && q)],
			["ornot", ornot(a, b), (p, q) => !(p || q)],
			["a nested folder", and(a, ornot(b)), (p, q) => p && !q],
			["a count of one", count(1, a, b), (p, q) => p || q],
			["a count of two", count(2, a, b), (p, q) => p && q],
		];

		for (const [title, condition, expected] of folders) {
			it(`evaluates ${title} over every assignment of two leaves`, () => {
				for (const held of assignments([a, b])) {
					assert.strictEqual(applyCondition(condition, held), expected(held.includes(a), held.includes(b)));
				}
			});
		}

		it("returns a boolean as it is", () => {
			assert.strictEqual(applyCondition(true, []), true);
			assert.strictEqual(applyCondition(false, [a]), false);
		});

		it("holds a leaf only when the same content in the same scope is held", () => {
			assert.strictEqual(applyCondition(a, [a]), true);
			assert.strictEqual(applyCondition(a, [{ ...a }]), true);
			assert.strictEqual(applyCondition(a, [b]), false);
			assert.strictEqual(applyCondition(a, [leaf("a = 1", "GER")]), false);
		});

		it("sees a list of held leaves that changed since the last call", () => {
			const held = [a];
			assert.strictEqual(applyCondition(b, held), false);
			held.push(b);
			assert.strictEqual(applyCondition(b, held), true);
			held.length = 0;
			assert.strictEqual(applyCondition(b, held), false);
		});
	});

	describe("andCondition", () => {
		const pairs: [ConditionComplexExpr, ConditionComplexExpr, string][] = [
			[true, a, "a = 1"],
			[a, true, "a = 1"],
			[true, true, "true"],
			[false, a, "false"],
			[a, false, "false"],
			[a, b, "and(a = 1, b = 1)"],
			[and(a, b), c, "and(a = 1, b = 1, c = 1)"],
			[and(a, true), and(and(b), c), "and(a = 1, b = 1, c = 1)"],
			[a, a, "a = 1"],
			[and(a, b), and(b, c), "and(a = 1, b = 1, c = 1)"],
			[or(a, b), or(a, b), "or(a = 1, b = 1)"],
			[or(a, b), or(a, c), "and(or(a = 1, b = 1), or(a = 1, c = 1))"],
		];

		for (const [left, right, expected] of pairs) {
			it(`joins ${conditionToString(left)} and ${conditionToString(right)} into ${expected}`, () => {
				assert.strictEqual(conditionToString(andCondition(left, right)), expected);
			});
		}
	});

	describe("extractConditionalExprs", () => {
		it("lists every leaf once, in the order it is first met", () => {
			const condition = and(a, or(b, { ...a }), ornot(c), true, count(1, andnot(x, b)));
			assert.deepStrictEqual(extractConditionalExprs(condition), [a, b, c, x]);
		});

		it("adds to the list it was given, skipping what is already there", () => {
			const list = [a];
			assert.strictEqual(extractConditionalExprs(or(a, b), list), list);
			assert.deepStrictEqual(list, [a, b]);
		});

		it("sees a list that changed since the last call", () => {
			const list = [a];
			extractConditionalExprs(b, list);
			list.push(c);
			assert.deepStrictEqual(extractConditionalExprs(and(c, x), list), [a, b, c, x]);
			list.length = 0;
			assert.deepStrictEqual(extractConditionalExprs(a, list), [a]);
		});
	});

	describe("extractConditionValue", () => {
		it("returns the simplified condition with the leaves it holds", () => {
			const value = extractConditionValue(parse("OR = { a = 1 GER = { b = 1 } } a = 1 always = yes").value, countryScope);
			assert.strictEqual(conditionToString(value.condition), "and(or(a = 1, [GER]b = 1), a = 1)");
			assert.deepStrictEqual(value.exprs, [a, leaf("b = 1", "GER")]);
		});

		it("reads the block in the scope it was given", () => {
			const value = extractConditionValue(parse("has_war = yes").value, { scopeName: "GER", scopeType: "country" });
			assert.deepStrictEqual(value.condition, leaf("has_war = yes", "GER"));
		});

		it("collects the leaves of a whole file into one list", () => {
			const list: ConditionItem[] = [];
			extractConditionValue(parse("a = 1 b = 1").value, countryScope, list);
			const value = extractConditionValue(parse("b = 1 c = 1").value, countryScope, list);
			assert.strictEqual(value.exprs, list);
			assert.deepStrictEqual(list, [a, b, c]);
		});

		it("joins several blocks, as extractConditionValues, with and", () => {
			const blocks = [parse("a = 1").value, parse("OR = { b = 1 c = 1 }").value];
			const value = extractConditionValues(blocks, countryScope);
			assert.strictEqual(conditionToString(value.condition), "and(a = 1, or(b = 1, c = 1))");
			assert.deepStrictEqual(value.exprs, [a, b, c]);
		});
	});

	describe("extractConditionFolder", () => {
		it("reads a value that is not a block as an empty folder of the type asked for", () => {
			assert.deepStrictEqual(extractConditionFolder(null, [countryScope]), { type: "and", items: [] });
			assert.deepStrictEqual(extractConditionFolder(5, [countryScope], "ornot"), { type: "ornot", items: [] });
			assert.deepStrictEqual(extractConditionFolder(null, [countryScope], "count", undefined, 2), { type: "count", amount: 2, items: [] });
		});

		it("falls back to the country scope when the stack is empty", () => {
			assert.deepStrictEqual(extractConditionFolder(parse("a = 1").value, []), and(a));
		});
	});
});
