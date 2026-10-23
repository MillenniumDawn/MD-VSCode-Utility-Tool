import type * as vscode from "vscode";
import { host } from "./host";
import { getFlags } from "./featureflags";
import { IndexFile } from "./indexListing";
import { localize } from "./i18n";
import { FileSourceOptions } from "./fileloader";
import { readIndexFileContent, reportIndexParseFailure } from "./indexHalf";
import { createThreeHalfIndex } from "./indexFactory";
import {
	defaultYmlSuffix,
	isoBySettingName,
	ymlSuffixByIso,
	ymlSuffixes,
} from "./locales";

type LocalisationData = Record<string, Record<string, string>>;

// A half of its own for the parent mods, for the same reason the gfx index has one: within a half
// the last file parsed wins, so a key the workspace overrides in a differently named .yml would
// otherwise show the parent's text on some builds.
interface LocalisationHalf {
	index: LocalisationData;
	// Which localisation keys came from which file, per language:
	// langKey -> filePath -> Set<localisationKey>. A cache is only worth hydrating from if it
	// carries this: without it a warm build restored no keys and parsed no fresh files, leaving the
	// half empty.
	fileMap: Record<string, Record<string, Set<string>>>;
}

const LOC_CACHE_VERSION = 2;
const langSuffixPattern = ymlSuffixes.join("|");
const localisationFileFilter = new RegExp(
	`.*_(${langSuffixPattern})\\.yml$`,
	"i",
);

/**
 * One language of one .yml file, as one line of the cache. The file's keys are the entries' keys,
 * so the cache no longer carries a second copy of every key alongside the index.
 */
type LocCacheRecord = [
	langKey: string,
	filePath: string,
	entries: Record<string, string>,
];

const localisationIndex = createThreeHalfIndex<LocalisationHalf, LocCacheRecord>({
	name: "localisationIndex",
	message: localize("localisationIndex.building", "Building Localisation index..."),
	rebuildMessage: localize(
		"localisationIndex.workspace.building",
		"Building workspace localisation index...",
	),
	rebuildFailureMessage: "Building workspace localisation index failed.",
	enabled: () => getFlags().localisationIndex,
	roots: ["localisation"],
	filter: (relativePath) => localisationFileFilter.test(relativePath),
	extension: ".yml",
	cacheVersion: LOC_CACHE_VERSION,
	fullRebuildOnAnyChange: true,
	newHalf: () => ({ index: {}, fileMap: {} }),
	hydrate: ({ index, fileMap }, [langKey, filePath, entries], skipFiles) => {
		if (skipFiles.has(filePath)) {
			return;
		}
		Object.assign(index[langKey] ?? (index[langKey] = {}), entries);
		const fileMapForLang = fileMap[langKey] ?? (fileMap[langKey] = {});
		fileMapForLang[filePath] = new Set(Object.keys(entries));
	},
	parseFile: fillLocalisationItems,
	// Each value is copied from the index rather than from the file, so a key two files define
	// is cached with the text that won, as it always was.
	serialize: ({ index, fileMap }) => {
		const records: LocCacheRecord[] = [];
		for (const langKey in fileMap) {
			const languageIndex = index[langKey] ?? {};
			const filesForLang = fileMap[langKey] ?? {};
			for (const filePath in filesForLang) {
				const entries: Record<string, string> = {};
				for (const key of filesForLang[filePath] ?? []) {
					const value = languageIndex[key];
					if (value !== undefined) {
						entries[key] = value;
					}
				}
				records.push([langKey, filePath, entries]);
			}
		}
		return records;
	},
	removeFile: ({ index, fileMap }, relative) => {
		for (const langKey of Object.keys(fileMap)) {
			const fileKeys = fileMap[langKey]?.[relative];
			if (!fileKeys) {
				continue;
			}

			const languageIndex = index[langKey];
			if (languageIndex) {
				for (const key of fileKeys) {
					delete languageIndex[key];
				}
			}
			delete fileMap[langKey]?.[relative];
		}
	},
	mergeFile: (workspace, parsed, relative) => {
		for (const langKey in parsed.index) {
			Object.assign(
				workspace.index[langKey] ?? (workspace.index[langKey] = {}),
				parsed.index[langKey],
			);

			const keys = parsed.fileMap[langKey]?.[relative];
			if (keys) {
				(workspace.fileMap[langKey] ?? (workspace.fileMap[langKey] = {}))[relative] = keys;
			}
		}
	},
});

export async function getLocalisedTextQuick(
	localisationKey: string | undefined,
): Promise<string | undefined> {
	if (getFlags().previewLocalisation) {
		return getLocalisedText(
			localisationKey,
			isoBySettingName[getFlags().previewLocalisation] ?? host().env.language,
		);
	}
	return getLocalisedText(localisationKey, host().env.language);
}

export async function getLocalisedText(
	localisationKey: string | undefined,
	language: string,
): Promise<string | undefined> {
	if (!localisationKey) {
		return localisationKey;
	}

	if (!getFlags().localisationIndex) {
		return localisationKey ?? "";
	}

	await localisationIndex.ensureBuilt().catch(() => undefined);

	const langKey = ymlSuffixByIso[language.toLowerCase()] || defaultYmlSuffix;
	const defaultLangKey = defaultYmlSuffix;

	return (
		lookupLocalisation(langKey, localisationKey) ??
		lookupLocalisation(defaultLangKey, localisationKey) ??
		localisationKey
	);
}

/** The game's order: the working mod, then the mods it extends, then vanilla. */
function lookupLocalisation(
	langKey: string,
	localisationKey: string,
): string | undefined {
	return localisationIndex
		.inPrecedence()
		.map((half) => half.index[langKey]?.[localisationKey])
		.find((value) => value !== undefined);
}

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillLocalisationItems(
	{ index, fileMap }: LocalisationHalf,
	localisationFile: IndexFile,
	options: FileSourceOptions,
): Promise<boolean> {
	const filePath = localisationFile.path;
	const fileBuffer = await readIndexFileContent(
		"Localisation index",
		localisationFile,
		options,
	);
	if (fileBuffer === undefined) {
		return false;
	}
	const content = fileBuffer.toString();

	try {
		const localisations = parseLocalisation(content);
		for (const langKey in localisations) {
			const languageLocalisations = localisations[langKey] ?? {};
			Object.assign(index[langKey] ?? (index[langKey] = {}), languageLocalisations);
			(fileMap[langKey] ?? (fileMap[langKey] = {}))[filePath] = new Set(
				Object.keys(languageLocalisations),
			);
		}
		return true;
	} catch (e) {
		// This logged only the message, where the focus index logged the stack. Both go through the
		// same reporter now, which prefers the stack.
		reportIndexParseFailure(filePath, options, e);
		return false;
	}
}

const langHeaderRegex = /^\s*(l_[a-z_]+):\s*(?:#.*)?$/i;
// key: optional version number, then the greedy quoted value (preserves embedded quotes, ignores a trailing `# comment`).
const localisationEntryRegex = /^\s*([^\s:#][^:]*):\s*\d*\s*"(.*)"/;

// Parses a HOI4 localisation .yml line by line rather than round-tripping through a YAML parser.
// Each line is independent, so a single malformed entry (e.g. a value with no closing quote) is
// skipped on its own instead of corrupting every entry after it in the same file.
export function parseLocalisation(fileContent: string): LocalisationData {
	const result: LocalisationData = {};
	let currentLang: string | undefined;

	for (const rawLine of fileContent.split(/\r?\n/)) {
		const line = rawLine.replace(/^﻿/, "");
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) {
			continue;
		}

		const headerMatch = langHeaderRegex.exec(line);
		if (headerMatch) {
			currentLang = headerMatch[1] ?? "l_english";
			if (!result[currentLang]) {
				result[currentLang] = {};
			}
			continue;
		}

		if (!currentLang) {
			continue;
		}

		const entryMatch = localisationEntryRegex.exec(line);
		if (entryMatch) {
			const key = entryMatch[1];
			const value = entryMatch[2];
			if (key !== undefined && value !== undefined) {
				const currentLanguage =
					result[currentLang] ?? (result[currentLang] = {});
				currentLanguage[key.trim()] = value;
			}
		}
	}

	return result;
}

export function registerLocalisationIndex(): vscode.Disposable {
	return localisationIndex.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetLocalisationIndexForTests(): void {
	localisationIndex.resetForTests();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = localisationIndex.handlers;
