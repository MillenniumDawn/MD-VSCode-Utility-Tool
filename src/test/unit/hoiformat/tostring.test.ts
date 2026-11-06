import * as assert from "assert";
import { conditionToString, extractConditionValue } from "../../../hoiformat/condition";
import { extractEffectValue, projectEffects } from "../../../hoiformat/effect";
import { Node } from "../../../hoiformat/hoiparser";
import { countryScope } from "../../../hoiformat/scope";
import { nodeToString } from "../../../hoiformat/tostring";
import { children, first, parse } from "../hoi";

describe("hoiformat/tostring", () => {
	describe("nodeToString", () => {
		// Written the way nodeToString writes, so each one has to come back out unchanged.
		const sources = [
			"a = 1",
			"a > -0.5",
			"GER",
			'name = "two words"',
			"tags = { GER FRA 12 }",
			"color = rgb { 255 0 0 }",
			"available = { }",
			"if = { limit = { tag = GER date > 1936.1.1 } add_stability = 0.1 }",
		];

		for (const source of sources) {
			it(`writes \`${source}\` back as it was read`, () => {
				const written = nodeToString(first(source));
				assert.strictEqual(written, source);
				assert.deepStrictEqual(parse(written), parse(source));
			});
		}

		it("writes loose spacing, comments and separators as single spaces", () => {
			assert.strictEqual(nodeToString(first("a={b=1,c=2 # note\n\td  =  yes;}")), "a = { b = 1 c = 2 d = yes }");
		});
	});

	describe("escaping", () => {
		const cases: { source: string; written: string; title: string }[] = [
			{
				title: "escaped quotes",
				source: "msg = \"say \\\"hi\\\"\"",
				written: "msg = \"say \\\"hi\\\"\"",
			},
			{
				title: "backslash between ordinary characters",
				source: "path = \"C:\\mods\\GER\"",
				written: "path = \"C:\\\\mods\\\\GER\"",
			},
			{
				title: "backslash before the closing quote",
				source: "dir = \"C:\\mods\\\"",
				written: "dir = \"C:\\\\mods\\\\\"",
			},
			{
				title: "backslash and quote together",
				source: "mix = \"a\\\\\\\"b\"",
				written: "mix = \"a\\\\\\\"b\"",
			},
			{
				title: "literal backslash-n",
				source: "esc = \"line1\\\\nline2\"",
				written: "esc = \"line1\\\\nline2\"",
			},
			{
				title: "a real newline in the string",
				source: "nl = \"line1\nline2\"",
				written: "nl = \"line1\nline2\"",
			},
			{
				title: "an ordinary string",
				source: "name = \"plain text\"",
				written: "name = \"plain text\"",
			},
			{
				title: "escaped quotes inside a nested block",
				source: "text = { label = \"a \\\"deep\\\" thing\" }",
				written: "text = { label = \"a \\\"deep\\\" thing\" }",
			},
		];

		for (const item of cases) {
			it(`round-trips ${item.title}`, () => {
				const parsed = first(item.source);

				const written = nodeToString(parsed);
				assert.strictEqual(written, item.written, "the renderer escaped the wrong characters");

				const readBack = first(written);
				assert.deepStrictEqual(readBack, parsed, "the written text reads back as a different node");

				assert.strictEqual(nodeToString(readBack), item.written);
			});
		}

		it("escapes quotes in the text a condition renders", () => {
			const { condition } = extractConditionValue(
				children("limit = { has_dlc = \"say \\\"hi\\\"\" }")[0]!.value as Node[],
				countryScope,
			);

			assert.strictEqual(conditionToString(condition), "has_dlc = \"say \\\"hi\\\"\"");
		});

		it("escapes quotes in the text an effect renders", () => {
			const option = children("option = { effect = { custom_tooltip = \"see \\\"more\\\"\" } }")[0]!;
			const effectNode = (option.value as Node[]).find((child) => child.name === "effect")!;
			const { effect } = extractEffectValue(effectNode.value, countryScope);

			assert.deepStrictEqual(projectEffects(effect), [
				{ kind: "line", scopeName: "", content: "custom_tooltip = \"see \\\"more\\\"\"" },
			]);
		});
	});
});
