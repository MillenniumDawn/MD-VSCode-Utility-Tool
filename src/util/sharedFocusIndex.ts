import type * as vscode from "vscode";

import { IndexFile } from "./indexListing";
import { localize } from "./i18n";
import { FileSourceOptions } from "./fileloader";
import { readIndexFileContent, reportIndexParseFailure } from "./indexHalf";
import { createThreeHalfIndex } from "./indexFactory";
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getFlags } from "./featureflags";

// The parent mods get a half of their own, so a focus the workspace redefines in a differently named
// file resolves to the workspace's file by construction, not by which of the two parsed last.
interface FocusHalf {
	// Filename -> array of focus keys
	index: Record<string, string[]>;
	// Reverse map for O(1) lookup: focusKey -> filename
	keyToFile: Map<string, string>;
}

const FOCUS_CACHE_VERSION = 2;

/** One file's focus ids, as one line of the cache. */
type FocusCacheRecord = [file: string, keys: string[]];

const focusIndex = createThreeHalfIndex<FocusHalf, FocusCacheRecord>({
	name: "sharedFocusIndex",
	message: localize("sharedFocusIndex.building", "Building Shared Focus index..."),
	rebuildMessage: localize(
		"sharedFocusIndex.workspace.building",
		"Building workspace Focus index...",
	),
	rebuildFailureMessage: "Building workspace Focus index failed.",
	enabled: () => getFlags().sharedFocusIndex,
	roots: ["common/national_focus"],
	extension: ".txt",
	cacheVersion: FOCUS_CACHE_VERSION,
	newHalf: () => ({ index: {}, keyToFile: new Map() }),
	hydrate: ({ index, keyToFile }, [file, keys], skipFiles) => {
		if (skipFiles.has(file)) {
			return;
		}
		index[file] = keys;
		for (const key of keys) {
			keyToFile.set(key, file);
		}
	},
	parseFile: async (half, file, options) => {
		const ids = await readFocusIds(file, options);
		if (ids === undefined) {
			return false;
		}
		applyFocusIds(file.path, ids, half);
		return true;
	},
	serialize: ({ index }) => Object.entries(index),
	removeFile: (workspace, relative) => applyFocusIds(relative, [], workspace),
	mergeFile: (workspace, parsed, relative) =>
		applyFocusIds(relative, parsed.index[relative] ?? [], workspace),
});

/**
 * Reading and parsing half of the index fill. Returns the file's focus ids, an empty list when the
 * file holds no focus definitions at all, or undefined when parsing failed -- so the caller decides
 * whether a failure means "write nothing" (the build) or "keep what is already indexed" (a re-index).
 */
async function readFocusIds(
	focusFile: IndexFile,
	options: FileSourceOptions,
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
	{ index, keyToFile }: FocusHalf,
): void {
	const previous = index[focusFile];
	if (previous) {
		for (const key of previous) {
			if (keyToFile.get(key) === focusFile) {
				keyToFile.delete(key);
			}
		}
	}

	if (ids.length === 0) {
		delete index[focusFile];
		return;
	}

	index[focusFile] = ids;
	for (const key of ids) {
		keyToFile.set(key, focusFile);
	}
}

export async function findFileByFocusKey(
	key: string,
): Promise<string | undefined> {
	if (!getFlags().sharedFocusIndex) {
		return undefined;
	}
	await focusIndex.ensureBuilt().catch(() => undefined);
	return focusIndex
		.inPrecedence()
		.map((half) => half.keyToFile.get(key))
		.find((file) => file !== undefined);
}

export function registerSharedFocusIndex(): vscode.Disposable {
	return focusIndex.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetSharedFocusIndexForTests(): void {
	focusIndex.resetForTests();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = focusIndex.handlers;
