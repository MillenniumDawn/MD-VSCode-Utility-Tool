import * as vscode from "vscode";

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
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { sharedFocusIndex } from "./featureflags";

interface FocusIndex {
	[file: string]: string[]; // Filename -> array of focus keys
}

const globalFocusIndex: FocusIndex = {};
let workspaceFocusIndex: FocusIndex = {};

// Reverse maps for O(1) lookup: focusKey -> filename
const globalFocusKeyToFile = new Map<string, string>();
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
	build: (progress) => {
		estimatedSize = [0];
		return Promise.all([
			buildGlobalFocusIndex(estimatedSize, progress),
			buildWorkspaceFocusIndex(estimatedSize, progress),
		]);
	},
	onSuccess: () => {
		sendEvent("sharedFocusIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void]> {
	return builder.ensureBuilt();
}

const FOCUS_CACHE_VERSION = 1;

const focusRoot = "common/national_focus";

async function buildGlobalFocusIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildFocusIndexHalf(
		"sharedFocusIndex.global",
		{ mod: false, hoi4: true, recursively: true },
		globalFocusIndex,
		globalFocusKeyToFile,
		estimatedSize,
		progress,
	);
}

async function buildWorkspaceFocusIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildFocusIndexHalf(
		"sharedFocusIndex.workspace",
		{ mod: true, hoi4: false, recursively: true },
		workspaceFocusIndex,
		workspaceFocusKeyToFile,
		estimatedSize,
		progress,
	);
}

async function buildFocusIndexHalf(
	cacheName: string,
	options: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildIndexHalf<FocusIndex>(
		{
			cacheName,
			version: FOCUS_CACHE_VERSION,
			listFiles: (token) =>
				listIndexFiles({ roots: [focusRoot], options: { ...options, token } }),
			hydrate: (cached, skipFiles) => {
				for (const file in cached) {
					if (!skipFiles.has(file)) {
						const keys = cached[file];
						if (keys === undefined) {
							continue;
						}
						focusIndex[file] = keys;
						for (const key of keys) {
							reverseMap.set(key, file);
						}
					}
				}
			},
			parseFile: (file) =>
				fillFocusItems(file, focusIndex, reverseMap, options, estimatedSize),
			serialize: () => focusIndex,
		},
		progress,
	);
}

async function fillFocusItems(
	focusFile: IndexFile,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: { mod?: boolean; hoi4?: boolean },
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
	options: { mod?: boolean; hoi4?: boolean },
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
	if (!sharedFocusIndex) {
		return undefined;
	}
	await ensureIndexBuilt().catch(() => undefined);
	return workspaceFocusKeyToFile.get(key) ?? globalFocusKeyToFile.get(key);
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
	const ids = await readFocusIds({ path: relative }, { hoi4: false });
	if (ids === undefined) {
		return;
	}

	applyFocusIds(relative, ids, workspaceFocusIndex, workspaceFocusKeyToFile);
}

const watchers = createIndexWatchers({
	enabled: sharedFocusIndex,
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
	workspaceFocusIndex = {};
	globalFocusKeyToFile.clear();
	workspaceFocusKeyToFile.clear();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
