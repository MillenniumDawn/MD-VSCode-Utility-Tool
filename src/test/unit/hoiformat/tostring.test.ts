import * as assert from "assert";
import { nodeToString } from "../../../hoiformat/tostring";
import { first, parse } from "../hoi";

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
});
