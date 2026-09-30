import * as assert from "assert";
import { createdFiles, listTabs, scaffolderArgs, scaffolderPath, validateKey } from "../util/internationalsystem";

const strip = `
			buttonType = {
				name = "space_gui_ledger_button"
			}
			iconType = {
				name ="icon_ledger_btn_1"
			}
			buttonType = {
				name = "un_gui_ledger_button"
			}
`;

describe("util/internationalsystem", () => {
	it("lists the tabs in strip order", () => {
		assert.deepStrictEqual(listTabs(strip), ["space", "un"]);
	});

	it("rejects keys that are not lower_snake_case or already a tab", () => {
		assert.strictEqual(validateKey("forums", ["space", "un"]), undefined);
		assert.notStrictEqual(validateKey("Forums", ["space"]), undefined);
		assert.notStrictEqual(validateKey("1forums", ["space"]), undefined);
		assert.notStrictEqual(validateKey("un", ["space", "un"]), undefined);
	});

	it("passes every answer to the scaffolder as its own argument", () => {
		assert.deepStrictEqual(scaffolderArgs("forums", "Economic Forums", "Track the forums.", "un"), [
			scaffolderPath,
			"forums",
			"Economic Forums",
			"--description",
			"Track the forums.",
			"--after",
			"un",
		]);
	});

	it("opens only the files the scaffolder created for the new tab", () => {
		const output = [
			"Tabs: space, un, forums",
			"  wrote common/scripted_guis/00_missiles_scripted_guis.txt",
			"  wrote common/scripted_guis/01_international_forums_gui.txt",
			"  wrote interface/MD_countrymissilesview.gui",
			"  wrote interface/MD_international_forums.gui",
			"  wrote localisation/english/MD_international_forums_l_english.yml",
			"",
		].join("\r\n");
		assert.deepStrictEqual(createdFiles(output, "forums"), [
			"common/scripted_guis/01_international_forums_gui.txt",
			"interface/MD_international_forums.gui",
			"localisation/english/MD_international_forums_l_english.yml",
		]);
	});
});
