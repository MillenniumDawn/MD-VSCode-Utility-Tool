import "./setup";
import * as assert from "assert";
import { ConditionItem } from "../../hoiformat/condition";
import { conditionDropdown, setConditionOptions } from "../../../webviewsrc/util/conditiontree";

describe("webview/util/conditiontree condition dropdown", () => {
	const war: ConditionItem = { scopeName: "", nodeContent: "has_war = yes" };
	const scoped: ConditionItem = { scopeName: "FROM", nodeContent: "tag = SOV" };
	const separator: ConditionItem = { scopeName: "ROOT", nodeContent: "a!|b" };
	const quoted: ConditionItem = { scopeName: "FROM", nodeContent: 'has_country_flag = "<x>"' };

	function dropdownElement(): HTMLDivElement {
		document.body.innerHTML = `<div id="conditions"><span class="value"></span></div>`;
		return document.getElementById("conditions") as HTMLDivElement;
	}

	it("starts at the given selection and reports it, then each change", async () => {
		const reported: ConditionItem[][] = [];
		const dropdown = conditionDropdown(dropdownElement(), [scoped], async (selection) => {
			reported.push(selection);
		});
		setConditionOptions(dropdown, [war, scoped, separator], [war, separator]);

		assert.deepStrictEqual(reported, [[scoped], [war, separator]]);
		dropdown.dispose();
	});

	it("reads a value with no separator as a trigger with no scope", () => {
		const reported: ConditionItem[][] = [];
		const dropdown = conditionDropdown(dropdownElement(), [], async (selection) => {
			reported.push(selection);
		});
		dropdown.selectedValues$.next(["has_war = yes"]);

		assert.deepStrictEqual(reported[reported.length - 1], [war]);
		dropdown.dispose();
	});

	it("lists the conditions as options, escaped, with the scope in front", () => {
		const dropdown = conditionDropdown(dropdownElement(), [], async () => undefined);
		setConditionOptions(dropdown, [war, quoted], [quoted]);

		const options = Array.from(dropdown.select.querySelectorAll(".option"));
		assert.deepStrictEqual(
			options.map((option) => option.getAttribute("value")),
			["!|has_war = yes", 'FROM!|has_country_flag = "<x>"'],
		);
		assert.strictEqual(options[1]?.textContent, '[FROM]has_country_flag = "<x>"');
		assert.strictEqual(dropdown.select.querySelectorAll("x").length, 0);
		assert.strictEqual(
			(dropdown.select.querySelector("span.value") as HTMLSpanElement).textContent,
			'[FROM]has_country_flag = "<x>"',
		);
		dropdown.dispose();
	});
});
