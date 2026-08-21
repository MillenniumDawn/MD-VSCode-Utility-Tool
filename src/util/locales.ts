/*
 * The languages the extension knows about, in one place.
 *
 * This used to be three tables in two files: localisationIndex.ts held ISO code -> yml suffix and
 * setting name -> ISO code, and vsccommon.ts held a third mapping setting name -> yml suffix
 * directly, which was the composition of the other two. Adding a language meant remembering all
 * three and keeping them consistent, and nothing checked that they were.
 *
 * The setting names below are the enum of `mdHoi4Utilities.previewLocalisation` in package.json
 * and have to keep matching it. The suffixes are what Paradox localisation files carry, as in
 * `focus_l_english.yml`.
 */

export interface LocaleDef {
	/** As offered by the `mdHoi4Utilities.previewLocalisation` setting. */
	settingName: string;
	/** As reported by `vscode.env.language`, lowercase. */
	iso: string;
	/** The `l_*` suffix of a localisation file for this language. */
	ymlSuffix: string;
}

export const locales: readonly LocaleDef[] = [
	{ settingName: "English", iso: "en", ymlSuffix: "l_english" },
	{ settingName: "Brazilian Portuguese", iso: "pt-br", ymlSuffix: "l_braz_por" },
	{ settingName: "German", iso: "de", ymlSuffix: "l_german" },
	{ settingName: "French", iso: "fr", ymlSuffix: "l_french" },
	{ settingName: "Spanish", iso: "es", ymlSuffix: "l_spanish" },
	{ settingName: "Polish", iso: "pl", ymlSuffix: "l_polish" },
	{ settingName: "Russian", iso: "ru", ymlSuffix: "l_russian" },
	{ settingName: "Japanese", iso: "ja", ymlSuffix: "l_japanese" },
	{ settingName: "Simplified Chinese", iso: "zh-cn", ymlSuffix: "l_simp_chinese" },
];

/** What an unknown or unset language falls back to, everywhere. */
export const defaultYmlSuffix = "l_english";

function indexBy<K extends keyof LocaleDef>(
	key: K,
	value: (locale: LocaleDef) => string,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const locale of locales) {
		result[locale[key]] = value(locale);
	}
	return result;
}

/** ISO code -> yml suffix. Keys are lowercase; look up with a lowercased language. */
export const ymlSuffixByIso = indexBy("iso", (l) => l.ymlSuffix);

/** Setting name -> ISO code. */
export const isoBySettingName = indexBy("settingName", (l) => l.iso);

/** Setting name -> yml suffix, the composition of the two above. */
export const ymlSuffixBySettingName = indexBy("settingName", (l) => l.ymlSuffix);

/** Every suffix, for building the pattern that recognises a localisation file. */
export const ymlSuffixes = locales.map((l) => l.ymlSuffix);
