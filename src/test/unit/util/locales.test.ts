import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
	defaultYmlSuffix,
	isoBySettingName,
	locales,
	ymlSuffixByIso,
	ymlSuffixBySettingName,
	ymlSuffixes,
} from "../../../util/locales";

describe("util/locales", () => {
	it("lists the languages the previewLocalisation setting offers, defaulting as it does", () => {
		// From out-test/src/test/unit/util, where this file is compiled to.
		const manifest = path.resolve(__dirname, "../../../../../package.json");
		const settings = JSON.parse(fs.readFileSync(manifest, "utf8")).contributes.configuration.flatMap(
			(section: { properties: Record<string, unknown> }) => Object.entries(section.properties),
		);
		const [, setting] = settings.find(([name]: [string]) => name === "mdHoi4Utilities.previewLocalisation");
		assert.deepStrictEqual(locales.map((l) => l.settingName).sort(), [...setting.enum].sort());
		assert.strictEqual(ymlSuffixBySettingName[setting.default], defaultYmlSuffix);
	});

	it("maps each language one to one, with lower-case ISO codes", () => {
		for (const locale of locales) {
			assert.strictEqual(isoBySettingName[locale.settingName], locale.iso);
			assert.strictEqual(ymlSuffixByIso[locale.iso], locale.ymlSuffix);
			assert.strictEqual(ymlSuffixBySettingName[locale.settingName], locale.ymlSuffix);
			assert.strictEqual(locale.iso, locale.iso.toLowerCase());
		}
		assert.deepStrictEqual(ymlSuffixes, locales.map((l) => l.ymlSuffix));
		assert.strictEqual(new Set(ymlSuffixes).size, locales.length);
		assert.strictEqual(Object.keys(ymlSuffixByIso).length, locales.length);
	});
});
