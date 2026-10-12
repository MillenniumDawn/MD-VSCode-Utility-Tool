import * as assert from "assert";
import { StyleTable, normalizeForStyle } from "../../../util/styletable";

describe("util/styletable", () => {
	it("builds a rule once per name and pseudo-class, and returns the class name", async () => {
		const table = new StyleTable();
		let built = 0;
		const rule = (css: string) => () => {
			built++;
			return css;
		};

		assert.strictEqual(table.style("icon", rule("\n  width: 10px;\n\theight: 20px;")), "st-icon");
		assert.strictEqual(table.style("icon", rule("never built")), "st-icon");
		assert.strictEqual(table.style("icon", rule("opacity: 0.5;"), ":hover"), "st-icon");
		assert.strictEqual(await table.style("glow", async () => "color: red;"), "st-glow");
		assert.strictEqual(await table.style("glow", async () => "never built"), "st-glow");
		table.raw("body.dark .st-icon", "\n  filter: invert(1);");

		assert.strictEqual(built, 2);
		assert.strictEqual(table.name("icon"), "st-icon");
		assert.deepStrictEqual(table.styleRecords, {
			"st-icon": "\n  width: 10px;\n\theight: 20px;",
			"st-icon:hover": "opacity: 0.5;",
			"st-glow": "color: red;",
		});
		// Leading whitespace goes from every line of a rule; raw selectors come after the classes.
		const css =
			".st-icon { width: 10px;\nheight: 20px; }\n" +
			".st-icon:hover { opacity: 0.5; }\n" +
			".st-glow { color: red; }\n" +
			"body.dark .st-icon { filter: invert(1); }\n";
		assert.strictEqual(table.toRawCss(), css);
		assert.strictEqual(table.toStyleElement("abc").replace(/\n\s+/g, "\n"), `<style nonce="abc">\n${css}</style>`);
	});

	it("writes a rule added after the css was last read", () => {
		const table = new StyleTable();
		table.style("a", () => "top: 0;");
		assert.strictEqual(table.toRawCss(), ".st-a { top: 0; }\n");
		table.style("b", () => "top: 1px;");
		table.raw("body", "margin: 0;");
		assert.strictEqual(table.toRawCss(), ".st-a { top: 0; }\n.st-b { top: 1px; }\nbody { margin: 0; }\n");
	});

	it("gives every one-time style a class of its own", async () => {
		const table = new StyleTable();
		assert.strictEqual(table.oneTimeStyle("node", () => "top: 0;"), "st-node-0");
		assert.strictEqual(table.oneTimeStyle("node", () => "top: 1px;", ":hover"), "st-node-1");
		assert.strictEqual(await table.oneTimeStyle("node", async () => "top: 2px;"), "st-node-2");
		assert.deepStrictEqual(Object.keys(table.styleRecords), ["st-node-0", "st-node-1:hover", "st-node-2"]);
	});

	for (const [name, expected] of [["GFX_focus_1", "GFX_focus_1"], ["gfx/a b.dds", "gfx_47a_32b_46dds"], ["", ""]]) {
		it(`normalizes ${JSON.stringify(name)} to ${JSON.stringify(expected)} for a class name`, () => {
			assert.strictEqual(normalizeForStyle(name), expected);
		});
	}
});
