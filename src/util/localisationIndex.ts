import * as vscode from "vscode";
import * as path from "path";
import { debounceByInput } from "./common";
import { localisationIndex, previewLocalisation } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { attachTaskWithErrorLogging } from "./promiseUtils";
import {
	createIndexBuilder,
	IndexProgress,
	withIndexProgress,
} from "./indexBuild";
import {
	buildIndexHalf,
	readIndexFileContent,
	reportIndexParseFailure,
} from "./indexHalf";
import { Logger } from "./logger";
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


export function registerLocalisationIndex(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	if (localisationIndex) {
		disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(onChangeWorkspaceFolders),
		);
		disposables.push(
			vscode.workspace.onDidChangeTextDocument(onChangeTextDocument),
		);
		disposables.push(
			vscode.workspace.onDidCloseTextDocument(onCloseTextDocument),
		);
		disposables.push(vscode.workspace.onDidCreateFiles(onCreateFiles));
		disposables.push(vscode.workspace.onDidDeleteFiles(onDeleteFiles));
		disposables.push(vscode.workspace.onDidRenameFiles(onRenameFiles));
	}

	return vscode.Disposable.from(...disposables);
}

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
			parseFile: (file) =>
				fillLocalisationItems(
					file,
					targetIndex,
					fileMap,
					options,
					estimatedSize,
				),
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

async function fillLocalisationItems(
	localisationFile: IndexFile,
	localisationIndex: LocalisationData,
	fileMap: Record<string, Record<string, Set<string>>> | null,
	options: {
		mod?: boolean;
		hoi4?: boolean;
	},
	estimatedSize?: [number],
): Promise<void> {
	const filePath = localisationFile.path;
	const fileBuffer = await readIndexFileContent(
		"Localisation index",
		localisationFile,
		options,
	);
	if (fileBuffer === undefined) {
		return;
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
	} catch (e) {
		// This logged only the message, where the focus index logged the stack. Both go through the
		// same reporter now, which prefers the stack.
		reportIndexParseFailure(filePath, options, e);
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

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	workspaceLocalisationIndex = {};
	for (const langKey in workspaceLocalisationFileMap) {
		delete workspaceLocalisationFileMap[langKey];
	}
	const estimatedSize: [number] = [0];
	const task = withIndexProgress(
		localize(
			"localisationIndex.workspace.building",
			"Building workspace Localisation index...",
		),
		(progress) => buildWorkspaceLocalisationIndex(estimatedSize, progress),
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			sendEvent("localisationIndex.workspace", {
				size: estimatedSize[0].toString(),
			});
		},
		"Building workspace Localisation index failed.",
		Logger.error,
	);
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	const file = e.document.uri;
	if (file.path.endsWith(".yml")) {
		onChangeTextDocumentImpl(file);
	}
}

const onChangeTextDocumentImpl = debounceByInput(
	(file: vscode.Uri) => {
		buildGate.runAfterBuild(() => {
			removeWorkspaceLocalisationIndex(file);
			addWorkspaceLocalisationIndex(file);
		});
	},
	(file) => file.toString(),
	1000,
	{ trailing: true },
);

function onCloseTextDocument(document: vscode.TextDocument) {
	if (!builder.hasStarted()) {
		return;
	}

	const file = document.uri;
	if (file.path.endsWith(".yml") && document.isDirty) {
		buildGate.runAfterBuild(() => {
			removeWorkspaceLocalisationIndex(file);
			addWorkspaceLocalisationIndex(file);
		});
	}
}

function onCreateFiles(e: vscode.FileCreateEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".yml")) {
				addWorkspaceLocalisationIndex(file);
			}
		}
	});
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".yml")) {
				removeWorkspaceLocalisationIndex(file);
			}
		}
	});
}

function onRenameFiles(e: vscode.FileRenameEvent) {
	onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
	onCreateFiles({ files: e.files.map((f) => f.newUri) });
}

function removeWorkspaceLocalisationIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("localisation/")) {
			const langKey = getLangKeyFromPath(relative);
			const fileKeys = workspaceLocalisationFileMap[langKey]?.[relative];
			if (fileKeys && workspaceLocalisationIndex[langKey]) {
				for (const key of fileKeys) {
					delete workspaceLocalisationIndex[langKey][key];
				}
				delete workspaceLocalisationFileMap[langKey]?.[relative];
			}
		}
	}
}

function addWorkspaceLocalisationIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("localisation/")) {
			// No URI: a re-index reaches one file, so resolving it the usual way costs nothing.
			void fillLocalisationItems(
				{ path: relative },
				workspaceLocalisationIndex,
				workspaceLocalisationFileMap,
				{ hoi4: false },
			);
		}
	}
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
export const __testHandlers = {
	onCreateFiles,
	onDeleteFiles,
	onCloseTextDocument,
};
