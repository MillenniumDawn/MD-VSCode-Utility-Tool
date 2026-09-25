import * as vscode from "vscode";
import { getFlags } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { createIndexBuilder, IndexProgress } from "./indexBuild";
import { FileSourceOptions, ListFilesOptions } from "./fileloader";
import {
	buildIndexHalf,
	captureIndexBuildContext,
	IndexBuildContext,
	readIndexFileContent,
	reportIndexParseFailure,
} from "./indexHalf";
import { createIndexWatchers, toWorkspaceRelativePath } from "./indexWatchers";
import {
	defaultYmlSuffix,
	isoBySettingName,
	ymlSuffixByIso,
	ymlSuffixes,
} from "./locales";

type LocalisationData = Record<string, Record<string, string>>;

const globalLocalisationIndex: LocalisationData = {};
const globalLocalisationFileMap: Record<
	string,
	Record<string, Set<string>>
> = {};
// A half of its own for the parent mods, for the same reason the gfx index has one: within a half
// the last file parsed wins, so a key the workspace overrides in a differently named .yml would
// otherwise show the parent's text on some builds.
let parentLocalisationIndexes: LocalisationData[] = [];
let workspaceLocalisationIndex: LocalisationData = {};

// Tracks which localisation keys came from which file, per language
// langKey -> filePath -> Set<localisationKey>
const workspaceLocalisationFileMap: Record<
	string,
	Record<string, Set<string>>
> = {};

// The parent half's parallel map. Its cache is only worth hydrating from if it carries fileMap
// data: without it a warm build restored no parent keys and parsed no fresh files, leaving the
// parent half empty.
const parentLocalisationFileMaps: Record<
	string,
	Record<string, Set<string>>
>[] = [];

// Both halves report into this so the telemetry event carries the whole build's size. Reset per
// build, since a build that failed and is retried would otherwise keep counting from where it left off.
let estimatedSize: [number] = [0];

const builder = createIndexBuilder({
	name: "localisationIndex",
	message: localize(
		"localisationIndex.building",
		"Building Localisation index...",
	),
	build: async (progress) => {
		estimatedSize = [0];
		const context = await captureIndexBuildContext();
		return Promise.all([
			buildGlobalLocalisationIndex(estimatedSize, progress, context),
			buildParentLocalisationIndex(estimatedSize, progress, context),
			buildWorkspaceLocalisationIndex(estimatedSize, progress, context),
		]);
	},
	onSuccess: () => {
		sendEvent("localisationIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void, void]> {
	return builder.ensureBuilt();
}

export async function getLocalisedTextQuick(
	localisationKey: string | undefined,
): Promise<string | undefined> {
	if (getFlags().previewLocalisation) {
		return getLocalisedText(
			localisationKey,
			isoBySettingName[getFlags().previewLocalisation] ?? vscode.env.language,
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

	if (!getFlags().localisationIndex) {
		return localisationKey ?? "";
	}

	await ensureIndexBuilt().catch(() => undefined);

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
	return (
		workspaceLocalisationIndex[langKey]?.[localisationKey] ??
		parentLocalisationIndexes
			.map((index) => index[langKey]?.[localisationKey])
			.find((value) => value !== undefined) ??
		globalLocalisationIndex[langKey]?.[localisationKey] ??
		undefined
	);
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

const localisationRoot = "localisation";
const isLocalisationFile = (relativePath: string) =>
	localisationFileFilter.test(relativePath);

async function buildGlobalLocalisationIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context: IndexBuildContext,
): Promise<void> {
	await buildLocalisationIndexHalf(
		"localisationIndex.global",
		{ mod: false, hoi4: true, recursively: true },
		globalLocalisationIndex,
		globalLocalisationFileMap,
		estimatedSize,
		progress,
		context,
	);
}

async function buildParentLocalisationIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	const parents = buildContext.parentModUris;
	parentLocalisationIndexes = parents.map(() => ({}));
	parentLocalisationFileMaps.length = parents.length;
	await Promise.all(
		parents.map((parent, index) => {
			const fileMap: Record<string, Record<string, Set<string>>> = {};
			parentLocalisationFileMaps[index] = fileMap;
			return buildLocalisationIndexHalf(
				`localisationIndex.parent.${index}`,
				{
					workspace: false,
					hoi4: false,
					recursively: true,
					parentModUris: [parent],
				},
				parentLocalisationIndexes[index]!,
				fileMap,
				estimatedSize,
				progress,
				buildContext,
			);
		}),
	);
}

async function buildWorkspaceLocalisationIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	await buildLocalisationIndexHalf(
		"localisationIndex.workspace",
		{ mod: true, parent: false, hoi4: false, recursively: true },
		workspaceLocalisationIndex,
		workspaceLocalisationFileMap,
		estimatedSize,
		progress,
		buildContext,
	);
}

async function buildLocalisationIndexHalf(
	cacheName: string,
	options: ListFilesOptions,
	targetIndex: LocalisationData,
	fileMap: Record<string, Record<string, Set<string>>> | null,
	estimatedSize: [number],
	progress: IndexProgress,
	context: IndexBuildContext,
): Promise<void> {
	await buildIndexHalf<LocCacheRecord>(
		{
			cacheName,
			version: LOC_CACHE_VERSION,
			cacheScope: context.cacheScope,
			dependencyGeneration: context.dependencyGeneration,
			fullRebuildOnAnyChange: true,
			listFiles: (token) =>
				listIndexFiles({
					roots: [localisationRoot],
					filter: isLocalisationFile,
					options: { ...options, token },
				}),
			hydrate: ([langKey, filePath, entries], skipFiles) => {
				if (skipFiles.has(filePath)) {
					return;
				}
				Object.assign(
					targetIndex[langKey] ?? (targetIndex[langKey] = {}),
					entries,
				);
				if (fileMap) {
					const fileMapForLang = fileMap[langKey] ?? (fileMap[langKey] = {});
					fileMapForLang[filePath] = new Set(Object.keys(entries));
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
			// Each value is copied from the index rather than from the file, so a key two files define
			// is cached with the text that won, as it always was.
			serialize: () => {
				const records: LocCacheRecord[] = [];
				for (const langKey in fileMap ?? {}) {
					const languageIndex = targetIndex[langKey] ?? {};
					const filesForLang = fileMap?.[langKey] ?? {};
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
		},
		progress,
	);
}

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillLocalisationItems(
	localisationFile: IndexFile,
	localisationIndex: LocalisationData,
	fileMap: Record<string, Record<string, Set<string>>> | null,
	options: FileSourceOptions,
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
	for (const langKey of Object.keys(workspaceLocalisationFileMap)) {
		const fileKeys = workspaceLocalisationFileMap[langKey]?.[relative];
		if (!fileKeys) {
			continue;
		}

		const languageIndex = workspaceLocalisationIndex[langKey];
		if (languageIndex) {
			for (const key of fileKeys) {
				delete languageIndex[key];
			}
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

	// No URI: a re-index reaches one file, so resolving it the usual way costs nothing. Workspace
	// only: a re-index that fires after the file was deleted must not read the parent's copy into
	// this half.
	const parsedIndex: LocalisationData = {};
	const parsedFileMap: Record<string, Record<string, Set<string>>> = {};
	const parsed = await fillLocalisationItems(
		{ path: relative },
		parsedIndex,
		parsedFileMap,
		{ parent: false, hoi4: false },
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
	enabled: getFlags().localisationIndex,
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
	rebuildParent: {
		reset: () => {
			parentLocalisationIndexes = [];
			parentLocalisationFileMaps.length = 0;
		},
		build: buildParentLocalisationIndex,
	},
});

export function registerLocalisationIndex(): vscode.Disposable {
	return watchers.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetLocalisationIndexForTests(): void {
	builder.reset();
	for (const key of Object.keys(globalLocalisationIndex)) {
		delete globalLocalisationIndex[key];
	}
	for (const key of Object.keys(globalLocalisationFileMap)) {
		delete globalLocalisationFileMap[key];
	}
	parentLocalisationIndexes = [];
	workspaceLocalisationIndex = {};
	parentLocalisationFileMaps.length = 0;
	for (const key of Object.keys(workspaceLocalisationFileMap)) {
		delete workspaceLocalisationFileMap[key];
	}
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
