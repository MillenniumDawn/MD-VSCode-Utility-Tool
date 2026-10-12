import * as assert from "assert";
import { Scope, countryScope, scopeDefs, tryMoveScope } from "../../../hoiformat/scope";
import { first, parse } from "../hoi";

const germany: Scope = { scopeName: "GER", scopeType: "country" };
const state: Scope = { scopeName: "123", scopeType: "state" };
const mio: Scope = { scopeName: "GER_krupp", scopeType: "mio" };
const from: Scope = { scopeName: "FROM", scopeType: "unknown" };

const country = (scopeName: string): Scope => ({ scopeName, scopeType: "country" });
const unknown = (scopeName: string): Scope => ({ scopeName, scopeType: "unknown" });

describe("hoiformat/scope", () => {
	describe("tryMoveScope", () => {
		// [what is written, the stack it is met in, where, the scope it enters or false]
		const moves: [string, Scope[], "condition" | "effect", Scope | false][] = [
			["GER = { }", [countryScope], "condition", germany],
			["D01 = { }", [countryScope], "effect", country("D01")],
			["GER_erwin_rommel = { }", [countryScope], "effect", { scopeName: "GER_erwin_rommel", scopeType: "character" }],
			["mio:GER_krupp = { }", [germany], "effect", mio],
			["123 = { }", [germany], "effect", state],

			["THIS = { }", [germany, state], "condition", state],
			["ROOT = { }", [germany, state, mio], "condition", germany],
			["ROOT = { }", [], "condition", countryScope],
			["PREV = { }", [germany, state, mio], "effect", state],
			["prev.prev = { }", [germany, state, mio], "effect", germany],
			["PREV.PREV.PREV = { }", [germany, state, mio], "effect", germany],
			// Inside an organization FROM is the country that owns it; anywhere else it is not known.
			["FROM = { }", [germany, mio], "effect", country("FROM")],
			["FROM = { }", [germany], "effect", from],
			["From.From = { }", [germany], "condition", unknown("From.From")],

			["var:my_target = { }", [germany], "effect", unknown("GER.{var:my_target}")],
			["var:influence_array^0 = { }", [germany], "effect", unknown("GER.{var:influence_array^0}")],
			["var:ROOT.my_target = { }", [germany], "effect", unknown("GER.{var:root.my_target}")],
			// A variable addressed through a tag, a state or `global` is the same from any scope.
			["var:FRA.my_target = { }", [germany], "effect", unknown("{var:fra.my_target}")],
			["var:123.my_target = { }", [germany], "effect", unknown("{var:123.my_target}")],
			["var:global.my_target = { }", [germany], "effect", unknown("{var:global.my_target}")],
			["event_target:my_target = { }", [germany], "condition", unknown("{event_target:my_target}")],
			["global_event_target:my_target = { }", [germany], "condition", unknown("{global_event_target:my_target}")],

			["capital_scope = { }", [germany], "condition", { scopeName: "GER.capital_scope", scopeType: "state" }],
			["Capital_Scope = { }", [countryScope], "effect", { scopeName: ".capital_scope", scopeType: "state" }],
			["owner = { }", [germany, state], "effect", country("123.owner")],
			["owner = { }", [germany, from], "effect", country("FROM.owner")],
			["owner = { }", [germany], "effect", false],
			// A scope reachable from anywhere goes by its own name.
			["any_country = { }", [germany, state], "condition", country("any_country")],
			["any_country = { }", [germany], "effect", false],
			["every_country = { }", [germany], "effect", country("every_country")],
			["every_country = { }", [germany], "condition", false],
			["any_owned_state = { }", [germany], "effect", false],

			["add_stability = { }", [germany], "effect", false],
			["GER = yes", [germany], "condition", false],
			["GER", [germany], "condition", false],
		];

		for (const [source, stack, type, expected] of moves) {
			const where = stack.map((scope) => scope.scopeName || "a country").join(" > ") || "an empty stack";
			const outcome = expected ? `enters ${expected.scopeType} ${expected.scopeName || "(unnamed)"}` : "is no scope";
			it(`\`${source}\` in ${where}, as ${type}, ${outcome}`, () => {
				const after = [...stack];
				assert.strictEqual(tryMoveScope(first(source), after, type), expected !== false);
				assert.deepStrictEqual(after, expected ? [...stack, expected] : stack);
			});
		}

		it("is no scope for a node without a name", () => {
			const stack = [germany];
			assert.strictEqual(tryMoveScope(parse("a = 1"), stack, "effect"), false);
			assert.deepStrictEqual(stack, [germany]);
		});
	});

	describe("scopeDefs", () => {
		it("lists every scope under its own lower-case name, usable somewhere", () => {
			const entries = Object.entries(scopeDefs);
			assert.ok(entries.length > 50, `only ${entries.length} scopes`);
			for (const [key, def] of entries) {
				assert.strictEqual(def.name, key);
				assert.strictEqual(key, key.toLowerCase());
				assert.ok(def.condition || def.effect, `${key} can be used nowhere`);
			}
		});
	});
});
