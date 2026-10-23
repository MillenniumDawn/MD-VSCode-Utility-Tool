import "./setup";
import * as assert from "assert";
import { ModifierLine } from "../../previewdef/sharedpayload";
import { appendGroups, modifierLineToDom, modifierSection } from "../../../webviewsrc/util/card";

const line: ModifierLine = { key: "recon_factor", name: "Recon", value: "+25%", tone: "good" };

describe("webview/util/card modifier lists", () => {
	for (const prefix of ["char", "idea"]) {
		describe(`with the ${prefix} prefix`, () => {
			it("writes the name, the value and the tone the payload decided", () => {
				const row = modifierLineToDom(prefix, line);
				assert.strictEqual(row.className, `${prefix}-mod`);
				assert.strictEqual(row.querySelector(`.${prefix}-mod-name`)?.textContent, "Recon");
				const value = row.querySelector(`.${prefix}-mod-value`);
				assert.strictEqual(value?.textContent, "+25%");
				assert.ok(value?.classList.contains(`${prefix}-mod-good`));
			});

			it("keeps the raw token as the name's tooltip", () => {
				const name = modifierLineToDom(prefix, line).querySelector(`.${prefix}-mod-name`) as HTMLElement;
				assert.strictEqual(name.title, "recon_factor");
			});

			it("carries the bad and neutral tones through as well", () => {
				for (const tone of ["bad", "neutral"] as const) {
					const value = modifierLineToDom(prefix, { ...line, tone }).querySelector(`.${prefix}-mod-value`);
					assert.ok(value?.classList.contains(`${prefix}-mod-${tone}`), tone);
				}
			});

			it("draws a section only when it has lines, with its title when given one", () => {
				assert.strictEqual(modifierSection(prefix, "Research bonus", []), undefined);

				const untitled = modifierSection(prefix, undefined, [line]);
				assert.strictEqual(untitled?.className, `${prefix}-mods`);
				assert.strictEqual(untitled?.querySelector(`.${prefix}-mods-head`), null);

				const titled = modifierSection(prefix, "Research bonus", [line, line]);
				assert.strictEqual(titled?.querySelector(`.${prefix}-mods-head`)?.textContent, "Research bonus");
				assert.strictEqual(titled?.querySelectorAll(`.${prefix}-mod`).length, 2);
			});

			it("appends one section per group that has lines", () => {
				const container = document.createElement("div");
				appendGroups(prefix, container, [
					{ title: "Infantry", lines: [line] },
					{ title: "Empty", lines: [] },
					{ title: "Armor", lines: [line] },
				]);
				assert.deepStrictEqual(
					[...container.querySelectorAll(`.${prefix}-mods-head`)].map((head) => head.textContent),
					["Infantry", "Armor"],
				);
			});
		});
	}
});
