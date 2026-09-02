import * as vscode from "vscode";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { gfxIndex } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import { uniq } from "lodash";
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

interface GfxIndexItem {
	file: string;
}

const globalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
let workspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};

// Reverse map for O(1) removal: file path -> sprite names from that file
const workspaceGfxFileToKeys = new Map<string, string[]>();


// Both halves report into this so the telemetry event carries the whole build's size. Reset per
// build, since a build that failed and is retried would otherwise keep counting from where it left off.
let estimatedSize: [number] = [0];

const builder = createIndexBuilder({
	name: "gfxIndex",
	message: localize("gfxindex.building", "Building GFX index..."),
	build: (progress) => {
		estimatedSize = [0];
		return Promise.all([
			buildGlobalGfxIndex(estimatedSize, progress),
			buildWorkspaceGfxIndex(estimatedSize, progress),
		]);
	},
	onSuccess: () => {
		sendEvent("gfxIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void]> {
	return builder.ensureBuilt();
}

export async function getGfxContainerFile(
	gfxName: string | undefined,
): Promise<string | undefined> {
	if (!gfxIndex || !gfxName) {
		return undefined;
	}

	await ensureIndexBuilt().catch(() => undefined);
	return (globalGfxIndex[gfxName] ?? workspaceGfxIndex[gfxName])?.file;
}

export async function getGfxContainerFiles(
	gfxNames: (string | undefined)[],
): Promise<string[]> {
	return uniq(
		(await Promise.all(gfxNames.map(getGfxContainerFile))).filter(
			(v): v is string => v !== undefined,
		),
	);
}

const GFX_CACHE_VERSION = 1;

interface GfxCacheData {
	index: Record<string, GfxIndexItem | undefined>;
	fileToKeys: Record<string, string[]>;
}

const gfxRoot = "interface";
const isGfxFile = (relativePath: string) =>
	relativePath.toLocaleLowerCase().endsWith(".gfx");

async function buildGlobalGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	// The global half keeps no file-to-keys map: nothing invalidates a vanilla file per-file, so
	// building one only ever wrote an empty object into the cache.
	await buildGfxIndexHalf(
		"gfxIndex.global",
		{ mod: false, recursively: true },
		globalGfxIndex,
		null,
		estimatedSize,
		progress,
	);
}

async function buildWorkspaceGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildGfxIndexHalf(
		"gfxIndex.workspace",
		{ hoi4: false, recursively: true },
		workspaceGfxIndex,
		workspaceGfxFileToKeys,
		estimatedSize,
		progress,
	);
}

async function buildGfxIndexHalf(
	cacheName: string,
	options: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildIndexHalf<GfxCacheData>(
		{
			cacheName,
			version: GFX_CACHE_VERSION,
			listFiles: (token) =>
				listIndexFiles({
					roots: [gfxRoot],
					filter: isGfxFile,
					options: { ...options, token },
				}),
			hydrate: (cached, skipFiles) => {
				for (const spriteName in cached.index) {
					const item = cached.index[spriteName];
					if (item && !skipFiles.has(item.file)) {
						targetIndex[spriteName] = item;
					}
				}
				if (fileToKeysMap && cached.fileToKeys) {
					for (const file in cached.fileToKeys) {
						if (!skipFiles.has(file)) {
							const keys = cached.fileToKeys[file];
							if (keys !== undefined) {
								fileToKeysMap.set(file, keys);
							}
						}
					}
				}
			},
			parseFile: async (file) => {
				await fillGfxItems(
					file,
					targetIndex,
					fileToKeysMap,
					options,
					estimatedSize,
				);
			},
			serialize: () => ({
				index: targetIndex,
				fileToKeys: Object.fromEntries(fileToKeysMap ?? []),
			}),
		},
		progress,
	);
}

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillGfxItems(
	gfxFile: IndexFile,
	gfxIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<boolean> {
	const filePath = gfxFile.path;
	if (estimatedSize) {
		// The path's length, not the file's, which is what this has always counted.
		estimatedSize[0] += filePath.length;
	}

	const fileBuffer = await readIndexFileContent("Gfx index", gfxFile, options);
	if (fileBuffer === undefined) {
		return false;
	}

	try {
		const spriteTypes = getSpriteTypes(
			parseHoi4File(
				fileBuffer.toString(),
				localize("infile", "In file {0}:\n", filePath),
				{ keepTokens: false },
			),
		);
		const spriteNames: string[] = [];
		for (const spriteType of spriteTypes) {
			gfxIndex[spriteType.name] = { file: filePath };
			if (fileToKeysMap) {
				spriteNames.push(spriteType.name);
			}
			if (estimatedSize) {
				estimatedSize[0] += spriteType.name.length + 8;
			}
		}
		if (fileToKeysMap && spriteNames.length > 0) {
			fileToKeysMap.set(filePath, spriteNames);
		}
		return true;
	} catch (e) {
		// This used to go to the debug console wrapped in a UserError, so a malformed .gfx file
		// never showed up in the output channel where every other index reports.
		reportIndexParseFailure(filePath, options, e);
		return false;
	}
}

const watchers = createIndexWatchers({
	enabled: gfxIndex,
	extension: ".gfx",
	hasStarted: () => builder.hasStarted(),
	gate: buildGate,
	reindexFile: (file) => {
		void reindexWorkspaceGfxFile(file);
	},
	removeFile: (file) => {
		const relative = toWorkspaceRelativePath(file, `${gfxRoot}/`);
		if (relative) {
			removeWorkspaceGfxFile(relative);
		}
	},
	rebuildWorkspace: {
		reset: () => {
			workspaceGfxIndex = {};
			workspaceGfxFileToKeys.clear();
		},
		build: buildWorkspaceGfxIndex,
		message: localize(
			"gfxindex.workspace.building",
			"Building workspace GFX index...",
		),
		telemetryEvent: "gfxIndex.workspace",
		failureMessage: "Building workspace GFX index failed.",
	},
});

export function registerGfxIndex(): vscode.Disposable {
	return watchers.register();
}

function removeWorkspaceGfxFile(relative: string): void {
	const keys = workspaceGfxFileToKeys.get(relative);
	if (!keys) {
		return;
	}

	for (const key of keys) {
		if (workspaceGfxIndex[key]?.file === relative) {
			delete workspaceGfxIndex[key];
		}
	}
	workspaceGfxFileToKeys.delete(relative);
}

/**
 * Re-indexes an edited .gfx file: parse first, swap the entry in afterwards.
 *
 * Clearing the entry up front -- what an edit used to do -- left every sprite the file defines
 * unresolvable for as long as the re-parse took, and a preview refreshing in that window drew
 * them as missing. A file that fails to parse midway through an edit keeps the sprites it was
 * last indexed with, which is what the shared focus index already did.
 */
async function reindexWorkspaceGfxFile(file: vscode.Uri): Promise<void> {
	const relative = toWorkspaceRelativePath(file, `${gfxRoot}/`);
	if (!relative) {
		return;
	}

	// No URI: a re-index reaches one file, so resolving it the usual way costs nothing.
	const parsedIndex: Record<string, GfxIndexItem | undefined> = {};
	const parsedKeys = new Map<string, string[]>();
	const parsed = await fillGfxItems(
		{ path: relative },
		parsedIndex,
		parsedKeys,
		{ hoi4: false },
	);
	if (!parsed) {
		return;
	}

	removeWorkspaceGfxFile(relative);
	for (const spriteName in parsedIndex) {
		const item = parsedIndex[spriteName];
		if (item) {
			workspaceGfxIndex[spriteName] = item;
		}
	}
	const keys = parsedKeys.get(relative);
	if (keys && keys.length > 0) {
		workspaceGfxFileToKeys.set(relative, keys);
	}
}
// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetGfxIndexForTests(): void {
	builder.reset();
	for (const key of Object.keys(globalGfxIndex)) {
		delete globalGfxIndex[key];
	}
	workspaceGfxIndex = {};
	workspaceGfxFileToKeys.clear();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
