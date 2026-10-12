import * as assert from "assert";
import { parseYaml } from "../../../util/yaml";

describe("util/yaml", () => {
	const documents: [string, string, unknown][] = [
		["a mapping", "a: 1\nb: text", { a: 1, b: "text" }],
		["nested mappings and lists", "events:\n  - id: a.1\n    days: 3\n  - id: a.2", { events: [{ id: "a.1", days: 3 }, { id: "a.2" }] }],
		["yes and no as text, as JSON has no such booleans", "a: yes\nb: true", { a: "yes", b: true }],
		["an empty file as nothing", "", undefined],
		["a file of comments as nothing", "# only a comment\n", undefined],
		// The loose quoting of a localisation file: a version after the colon, quotes inside quotes.
		["a localisation file", 'l_english:\n SOV_plan:0 "The "Five Year" Plan"\n SOV_plan_desc: "Plain"', { l_english: { SOV_plan: 'The "Five Year" Plan', SOV_plan_desc: "Plain" } }],
	];

	for (const [title, text, expected] of documents) {
		it(`reads ${title}`, () => {
			assert.deepStrictEqual(parseYaml(text), expected);
		});
	}

	const refused: [string, string, RegExp][] = [
		["a second document", "a: 1\n---\nb: 2", /single document/],
		["a tag that would run code", "a: !!js/function 'function () {}'", /js\/function/],
		["an unclosed list", "key: [unterminated", /./],
		// The repair rewrites line two, and its copy fails a line further down, on the unclosed
		// list. The error has to be the one for the text as the file has it.
		["text no repair can save, as the file has it", 'l_english:\n KEY:0 "a "b" c"\n KEY2: [x', /bad indentation/],
	];

	for (const [title, text, message] of refused) {
		it(`refuses ${title}`, () => {
			assert.throws(() => parseYaml(text), (error: Error) => error.name === "YAMLException" && message.test(error.message));
		});
	}
});
