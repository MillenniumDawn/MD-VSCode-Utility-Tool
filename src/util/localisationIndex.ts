import * as vscode from "vscode";
import { localisationIndex, previewLocalisation } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { createIndexBuilder, IndexProgress } from "./indexBuild";
import {
	buildIndexHalf,
	readIndexFileContent,
	reportIndexParseFailure,
} from "./indexHalf";
import {
	createIndexWatchers,
	toWorkspaceRelativePath,
} from "./indexWatchers";
import {
	defaultYmlSuffix,
	isoBySettingName,
	ymlSuffixByIso,
	ymlSuffixes,
} from "./locales";

type LocalisationData = Record<string, Record<string, string>>;

const globalLocalisationIndex: LocalisationData = {};
let workspaceLocalisationIndex: LocalisationData = {};

// Tracks which localisation keys came from which file, per language
// langKey -> filePath -> Set<localisationKey>
const workspaceLocalisationFileMap: Record<
	string,
	Record<string, Set<string>>
> = {};



// Both halves report into this so the telemetry event carries the whole build's size. Reset per
// build, since a build that failed and is retried would otherwise keep counting from where it left off.
let estimatedSize: [number] = [0];

const builder = createIndexBuilder({
	name: "localisationIndex",
	message: localize(
		"localisationIndex.building",
		"Building Localisation index...",
	),
	build: (progress) => {
		estimatedSize = [0];
		return Promise.all([
			buildGlobalLocalisationIndex(estimatedSize, progress),
			buildWorkspaceLocalisationIndex(estimatedSize, progress),
		]);
	},
	onSuccess: () => {
		sendEvent("localisationIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void]> {
	return builder.ensureBuilt();
}

export async function getLocalisedTextQuick(
	localisationKey: string | undefined,
): Promise<string | undefined> {
	if (previewLocalisation) {
		return getLocalisedText(
			localisationKey,
			isoBySettingName[previewLocalisation] ?? vscode.env.language,
		);
	}
	return getLocalisedText(localisationKey, vscode.env.language);
}

export async function getLocalisedText(
	localisationKey: string | undefined,
	language: string,
): Promise<string | undefined> {
	if (!localisationKey) {
		return localisationKey;
	}

	if (!localisationIndex) {
		return localisationKey ?? "";
	}

	await ensureIndexBuilt().catch(() => undefined);

	const langKey = ymlSuffixByIso[language.toLowerCase()] || defaultYmlSuffix;
	const defaultLangKey = defaultYmlSuffix;

	let text =
		globalLocalisationIndex[langKey]?.[localisationKey] ||
		workspaceLocalisationIndex[langKey]?.[localisationKey];

	if (!text) {
		text =
			globalLocalisationIndex[defaultLangKey]?.[localisationKey] ||
			workspaceLocalisationIndex[defaultLangKey]?.[localisationKey];
	}

	return text ?? localisationKey;
}

const LOC_CACHE_VERSION = 1;
const langSuffixPattern = ymlSuffixes.join("|");
const localisationFileFilter = new RegExp(
	`.*_(${langSuffixPattern})\\.yml$`,
	"i",
);

interface LocCacheData {
	index: LocalisationData;
	fileMap: Record<string, Record<string, string[]>>; // langKey -> filePath -> keys[]
}

const localisationRoot = "localisation";
const isLocalisationFile = (relativePath: string) =>
	localisationFileFilter.test(relativePath);

async function buildGlobalLocalisationIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	// The global half keeps no per-file key map: nothing invalidates a vanilla file on its own, so
	// maintaining one only ever wrote an empty object into the cache.
	await buildLocalisationIndexHalf(
		"localisationIndex.global",
		{ mod: false, hoi4: true, recursively: true },
		globalLocalisationIndex,
		null,
		estimatedSize,
		progress,
	);
}

async function buildWorkspaceLocalisationIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildLocalisationIndexHalf(
		"localisationIndex.workspace",
		{ mod: true, hoi4: false, recursively: true },
		workspaceLocalisationIndex,
		workspaceLocalisationFileMap,
		estimatedSize,
		progress,
	);
}

async function buildLocalisationIndexHalf(
	cacheName: string,
	options: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	targetIndex: LocalisationData,
	fileMap: Record<string, Record<string, Set<string>>> | null,
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildIndexHalf<LocCacheData>(
		{
			cacheName,
			version: LOC_CACHE_VERSION,
			listFiles: (token) =>
				listIndexFiles({
					roots: [localisationRoot],
					filter: isLocalisationFile,
					options: { ...options, token },
				}),
			hydrate: (cached, skipFiles) => {
				for (const langKey in cached.index) {
					const cachedLanguageIndex = cached.index[langKey] ?? {};
					const targetLanguageIndex =
						targetIndex[langKey] ?? (targetIndex[langKey] = {});
					const fileKeysForLang = cached.fileMap?.[langKey] ?? {};
					for (const filePath in fileKeysForLang) {
						if (!skipFiles.has(filePath)) {
							const keys = fileKeysForLang[filePath] ?? [];
							for (const key of keys) {
								const value = cachedLanguageIndex[key];
								if (value !== undefined) {
									targetLanguageIndex[key] = value;
								}
							}
							if (fileMap) {
								const fileMapForLang =
									fileMap[langKey] ?? (fileMap[langKey] = {});
								fileMapForLang[filePath] = new Set(keys);
							}
						}
					}
				}
			},
			parseFile: async (file) => {
				await fillLocalisationItems(
					file,
					targetIndex,
					fileMap,
					options,
					estimatedSize,
				);
			},
			// TODO: serialising this runs on the extension host thread and produces the whole index
			// plus a second copy of every key in `fileMap` as one string. On a mod the size of
			// Millennium Dawn that is hundreds of megabytes, enough to stall the host and, at the top
			// end, to exceed V8's maximum string length outright. Left alone for now because this
			// index is off by default and off on the machines the hangs were reported from.
			// Streaming the write, or caching per language, is the way out.
			serialize: () => {
				const serializedFileMap: Record<
					string,
					Record<string, string[]>
				> = {};
				if (fileMap) {
					for (const langKey in fileMap) {
						const perFile: Record<string, string[]> = {};
						for (const filePath in fileMap[langKey]) {
							perFile[filePath] = [...(fileMap[langKey]?.[filePath] ?? [])];
						}
						serializedFileMap[langKey] = perFile;
					}
				}
				return { index: targetIndex, fileMap: serializedFileMap };
			},
		},
		progress,
	);
}

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillLocalisationItems(
	localisationFile: IndexFile,
	localisationIndex: LocalisationData,
	fileMap: Record<string, Record<string, Set<string>>> | null,
	options: {
		mod?: boolean;
		hoi4?: boolean;
	},
	estimatedSize?: [number],
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
			if (!localisationIndex[langKey]) {
				localisationIndex[langKey] = {};
			}

			const languageLocalisations = localisations[langKey] ?? {};
			Object.assign(localisationIndex[langKey], languageLocalisations);

			if (fileMap) {
				if (!fileMap[langKey]) {
					fileMap[langKey] = {};
				}
				fileMap[langKey][filePath] = new Set(
					Object.keys(languageLocalisations),
				);
			}

			if (estimatedSize) {
				estimatedSize[0] += Object.keys(languageLocalisations).reduce(
					(sum, key) =>
						sum + key.length + (languageLocalisations[key] ?? "").length,
					0,
				);
			}
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

function removeWorkspaceLocalisationFile(relative: string): void {
	const langKey = getLangKeyFromPath(relative);
	const fileKeys = workspaceLocalisationFileMap[langKey]?.[relative];
	if (fileKeys && workspaceLocalisationIndex[langKey]) {
		for (const key of fileKeys) {
			delete workspaceLocalisationIndex[langKey][key];
		}
		delete workspaceLocalisationFileMap[langKey]?.[relative];
	}
}

/**
 * Re-indexes an edited localisation file: parse first, swap the entries in afterwards.
 *
 * Clearing the file's keys up front -- what an edit used to do -- left every string it defines
 * unresolved for as long as the re-parse took, and a preview refreshing in that window, which the
 * same edit triggers on the same debounce, fell back to showing raw keys. A file that fails to
 * parse midway through an edit keeps the strings it was last indexed with.
 */
async function reindexWorkspaceLocalisationFile(
	file: vscode.Uri,
): Promise<void> {
	const relative = toWorkspaceRelativePath(file, `${localisationRoot}/`);
	if (!relative) {
		return;
	}

	// No URI: a re-index reaches one file, so resolving it the usual way costs nothing.
	const parsedIndex: LocalisationData = {};
	const parsedFileMap: Record<string, Record<string, Set<string>>> = {};
	const parsed = await fillLocalisationItems(
		{ path: relative },
		parsedIndex,
		parsedFileMap,
		{ hoi4: false },
	);
	if (!parsed) {
		return;
	}

	removeWorkspaceLocalisationFile(relative);
	for (const langKey in parsedIndex) {
		const target =
			workspaceLocalisationIndex[langKey] ??
			(workspaceLocalisationIndex[langKey] = {});
		Object.assign(target, parsedIndex[langKey]);

		const keys = parsedFileMap[langKey]?.[relative];
		if (keys) {
			const fileMapForLang =
				workspaceLocalisationFileMap[langKey] ??
				(workspaceLocalisationFileMap[langKey] = {});
			fileMapForLang[relative] = keys;
		}
	}
}

const watchers = createIndexWatchers({
	enabled: localisationIndex,
	extension: ".yml",
	hasStarted: () => builder.hasStarted(),
	gate: buildGate,
	reindexFile: (file) => {
		void reindexWorkspaceLocalisationFile(file);
	},
	removeFile: (file) => {
		const relative = toWorkspaceRelativePath(file, `${localisationRoot}/`);
		if (relative) {
			removeWorkspaceLocalisationFile(relative);
		}
	},
	rebuildWorkspace: {
		reset: () => {
			workspaceLocalisationIndex = {};
			for (const key of Object.keys(workspaceLocalisationFileMap)) {
				delete workspaceLocalisationFileMap[key];
			}
		},
		build: buildWorkspaceLocalisationIndex,
		message: localize(
			"localisationIndex.workspace.building",
			"Building workspace localisation index...",
		),
		telemetryEvent: "localisationIndex.workspace",
		failureMessage: "Building workspace localisation index failed.",
	},
});

export function registerLocalisationIndex(): vscode.Disposable {
	return watchers.register();
}

function getLangKeyFromPath(filePath: string): string {
	const match = filePath.match(localisationFileFilter);
	return match?.[1] ?? "l_english";
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetLocalisationIndexForTests(): void {
	builder.reset();
	for (const key of Object.keys(globalLocalisationIndex)) {
		delete globalLocalisationIndex[key];
	}
	workspaceLocalisationIndex = {};
	for (const key of Object.keys(workspaceLocalisationFileMap)) {
		delete workspaceLocalisationFileMap[key];
	}
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
