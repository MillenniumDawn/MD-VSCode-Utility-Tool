import * as vscode from "vscode";

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
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getFlags } from "./featureflags";

interface FocusIndex {
	[file: string]: string[]; // Filename -> array of focus keys
}

const globalFocusIndex: FocusIndex = {};
// The parent mods' own half, so a focus the workspace redefines in a differently named file resolves
// to the workspace's file by construction, not by which of the two parsed last.
let parentFocusIndexes: FocusIndex[] = [];
let workspaceFocusIndex: FocusIndex = {};

// Reverse maps for O(1) lookup: focusKey -> filename
const globalFocusKeyToFile = new Map<string, string>();
const parentFocusKeyToFiles: Map<string, string>[] = [];
const workspaceFocusKeyToFile = new Map<string, string>();

// Both halves report into this so the telemetry event carries the whole build's size. Reset per
// build, since a build that failed and is retried would otherwise keep counting from where it left off.
let estimatedSize: [number] = [0];

const builder = createIndexBuilder({
	name: "sharedFocusIndex",
	message: localize(
		"sharedFocusIndex.building",
		"Building Shared Focus index...",
	),
	build: async (progress) => {
		estimatedSize = [0];
		const context = await captureIndexBuildContext();
		return Promise.all([
			buildGlobalFocusIndex(estimatedSize, progress, context),
			buildParentFocusIndex(estimatedSize, progress, context),
			buildWorkspaceFocusIndex(estimatedSize, progress, context),
		]);
	},
	onSuccess: () => {
		sendEvent("sharedFocusIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void, void]> {
	return builder.ensureBuilt();
}

const FOCUS_CACHE_VERSION = 2;

/** One file's focus ids, as one line of the cache. */
type FocusCacheRecord = [file: string, keys: string[]];

const focusRoot = "common/national_focus";

async function buildGlobalFocusIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context: IndexBuildContext,
): Promise<void> {
	await buildFocusIndexHalf(
		"sharedFocusIndex.global",
		{ mod: false, hoi4: true, recursively: true },
		globalFocusIndex,
		globalFocusKeyToFile,
		estimatedSize,
		progress,
		context,
	);
}

async function buildParentFocusIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	const parents = buildContext.parentModUris;
	parentFocusIndexes = parents.map(() => ({}));
	parentFocusKeyToFiles.length = parents.length;
	// No parents, no half: a mod that extends nothing pays no listing and writes no cache for it.
	if (parents.length === 0) {
		return;
	}
	await Promise.all(
		parents.map((parent, index) => {
			const reverseMap = new Map<string, string>();
			parentFocusKeyToFiles[index] = reverseMap;
			return buildFocusIndexHalf(
				`sharedFocusIndex.parent.${index}`,
				{
					workspace: false,
					hoi4: false,
					recursively: true,
					parentModUris: [parent],
				},
				parentFocusIndexes[index]!,
				reverseMap,
				estimatedSize,
				progress,
				buildContext,
			);
		}),
	);
}

async function buildWorkspaceFocusIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	await buildFocusIndexHalf(
		"sharedFocusIndex.workspace",
		{ mod: true, parent: false, hoi4: false, recursively: true },
		workspaceFocusIndex,
		workspaceFocusKeyToFile,
		estimatedSize,
		progress,
		buildContext,
	);
}

async function buildFocusIndexHalf(
	cacheName: string,
	options: ListFilesOptions,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	estimatedSize: [number],
	progress: IndexProgress,
	context: IndexBuildContext,
): Promise<void> {
	await buildIndexHalf<FocusCacheRecord>(
		{
			cacheName,
			version: FOCUS_CACHE_VERSION,
			cacheScope: context.cacheScope,
			dependencyGeneration: context.dependencyGeneration,
			listFiles: (token) =>
				listIndexFiles({ roots: [focusRoot], options: { ...options, token } }),
			hydrate: ([file, keys], skipFiles) => {
				if (skipFiles.has(file)) {
					return;
				}
				focusIndex[file] = keys;
				for (const key of keys) {
					reverseMap.set(key, file);
				}
			},
			parseFile: (file) =>
				fillFocusItems(file, focusIndex, reverseMap, options, estimatedSize),
			serialize: () => Object.entries(focusIndex),
		},
		progress,
	);
}

async function fillFocusItems(
	focusFile: IndexFile,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: FileSourceOptions,
	estimatedSize?: [number],
): Promise<void> {
	const ids = await readFocusIds(focusFile, options, estimatedSize);
	if (ids === undefined) {
		return;
	}

	applyFocusIds(focusFile.path, ids, focusIndex, reverseMap);
}

/**
 * Reading and parsing half of the index fill. Returns the file's focus ids, an empty list when the
 * file holds no focus definitions at all, or undefined when parsing failed -- so the caller decides
 * whether a failure means "write nothing" (the build) or "keep what is already indexed" (a re-index).
 */
async function readFocusIds(
	focusFile: IndexFile,
	options: FileSourceOptions,
	estimatedSize?: [number],
): Promise<string[] | undefined> {
	const filePath = focusFile.path;
	const fileBuffer = await readIndexFileContent(
		"Shared focus index",
		focusFile,
		options,
	);
	if (fileBuffer === undefined) {
		return undefined;
	}
	const fileContent = fileBuffer.toString();

	// Skip files that don't contain any focus type definitions
	if (
		!fileContent.includes("focus_tree") &&
		!fileContent.includes("shared_focus") &&
		!fileContent.includes("joint_focus")
	) {
		return [];
	}

	try {
		const ids = extractFocusIds(
			parseHoi4File(
				fileContent,
				localize("infile", "In file {0}:\n", filePath),
				{ keepTokens: false },
			),
		);

		if (estimatedSize) {
			estimatedSize[0] += fileBuffer.length;
		}

		return ids;
	} catch (e) {
		reportIndexParseFailure(filePath, options, e);
		return undefined;
	}
}

/**
 * Writing half of the index fill: swaps a file's entry for a fresh set of ids in one step, dropping
 * only the keys that entry still owns. An empty list removes the file from the index entirely.
 */
function applyFocusIds(
	focusFile: string,
	ids: string[],
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
): void {
	const previous = focusIndex[focusFile];
	if (previous) {
		for (const key of previous) {
			if (reverseMap.get(key) === focusFile) {
				reverseMap.delete(key);
			}
		}
	}

	if (ids.length === 0) {
		delete focusIndex[focusFile];
		return;
	}

	focusIndex[focusFile] = ids;
	for (const key of ids) {
		reverseMap.set(key, focusFile);
	}
}

export async function findFileByFocusKey(
	key: string,
): Promise<string | undefined> {
	if (!getFlags().sharedFocusIndex) {
		return undefined;
	}
	await ensureIndexBuilt().catch(() => undefined);
	// The game's order: the working mod, then the mods it extends, then vanilla.
	return (
		workspaceFocusKeyToFile.get(key) ??
		parentFocusKeyToFiles
			.map((map) => map.get(key))
			.find((file) => file !== undefined) ??
		globalFocusKeyToFile.get(key)
	);
}

function removeWorkspaceFocusFile(relative: string): void {
	applyFocusIds(relative, [], workspaceFocusIndex, workspaceFocusKeyToFile);
}

/**
 * Re-indexes an edited focus file: parse first, swap the entry in afterwards. Clearing the entry up
 * front (what an edit used to do) left the index without any of the file's focuses for as long as the
 * re-parse took, and a focus tree preview refreshing in that window -- which the same edit triggers,
 * on the same one second debounce -- resolved none of the file's shared focuses and silently dropped
 * the whole branch from the tree. A file that fails to parse midway through an edit keeps the ids it
 * was last indexed with, instead of losing them until the next edit that happens to parse.
 */
async function reindexWorkspaceFocusFile(file: vscode.Uri): Promise<void> {
	const relative = toWorkspaceRelativePath(file, `${focusRoot}/`);
	if (!relative) {
		return;
	}

	// readFocusIds reports both an unreadable file and a parse failure as undefined, logging either
	// itself, so there is nothing to catch here: the previously indexed ids stay in place.
	// No URI: a re-index reaches one file, so resolving it the usual way costs nothing worth avoiding.
	// Workspace only: a re-index that fires after the file was deleted must not read the parent's
	// copy into this half.
	const ids = await readFocusIds(
		{ path: relative },
		{ parent: false, hoi4: false },
	);
	if (ids === undefined) {
		return;
	}

	applyFocusIds(relative, ids, workspaceFocusIndex, workspaceFocusKeyToFile);
}

const watchers = createIndexWatchers({
	enabled: getFlags().sharedFocusIndex,
	extension: ".txt",
	hasStarted: () => builder.hasStarted(),
	gate: buildGate,
	reindexFile: (file) => {
		void reindexWorkspaceFocusFile(file);
	},
	removeFile: (file) => {
		const relative = toWorkspaceRelativePath(file, `${focusRoot}/`);
		if (relative) {
			removeWorkspaceFocusFile(relative);
		}
	},
	rebuildWorkspace: {
		reset: () => {
			workspaceFocusIndex = {};
			workspaceFocusKeyToFile.clear();
		},
		build: buildWorkspaceFocusIndex,
		message: localize(
			"sharedFocusIndex.workspace.building",
			"Building workspace Focus index...",
		),
		telemetryEvent: "sharedFocusIndex.workspace",
		failureMessage: "Building workspace Focus index failed.",
	},
	rebuildParent: {
		reset: () => {
			parentFocusIndexes = [];
			parentFocusKeyToFiles.length = 0;
		},
		build: buildParentFocusIndex,
	},
});

export function registerSharedFocusIndex(): vscode.Disposable {
	return watchers.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetSharedFocusIndexForTests(): void {
	builder.reset();
	for (const file of Object.keys(globalFocusIndex)) {
		delete globalFocusIndex[file];
	}
	parentFocusIndexes = [];
	workspaceFocusIndex = {};
	globalFocusKeyToFile.clear();
	parentFocusKeyToFiles.length = 0;
	workspaceFocusKeyToFile.clear();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
