import * as vscode from "vscode";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { gfxIndex } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import uniq from "lodash/uniq";
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

interface GfxIndexItem {
	file: string;
}

const globalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
// The parent mods get a half of their own rather than a share of the workspace's. Precedence
// between sources is what the halves are for: inside one half the last file to parse wins, and
// the parse queue is four wide, so a sprite the workspace redefines in a differently named .gfx
// would resolve to the parent's file on some builds and the workspace's on others.
let parentGfxIndexes: Record<string, GfxIndexItem | undefined>[] = [];
let workspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};

// Reverse map for O(1) removal: file path -> sprite names from that file
const workspaceGfxFileToKeys = new Map<string, string[]>();

// The sprite namespace has no file of its own for a cache built from it to stat, so every mutation
// of either half moves this instead. Bumped *after* the write everywhere: a bump before it would let
// a reader store the new version alongside the old data and then never refetch it.
let gfxIndexVersion = 0;

function bumpGfxIndexVersion(): void {
	gfxIndexVersion++;
}

/** Changes whenever getIndexedGfxNames or getGfxContainerFile may answer differently. */
export function getGfxIndexVersion(): number {
	return gfxIndexVersion;
}

// Both halves report into this so the telemetry event carries the whole build's size. Reset per
// build, since a build that failed and is retried would otherwise keep counting from where it left off.
let estimatedSize: [number] = [0];

const builder = createIndexBuilder({
	name: "gfxIndex",
	message: localize("gfxindex.building", "Building GFX index..."),
	build: async (progress) => {
		estimatedSize = [0];
		const context = await captureIndexBuildContext();
		return Promise.all([
			buildGlobalGfxIndex(estimatedSize, progress, context),
			buildParentGfxIndex(estimatedSize, progress, context),
			buildWorkspaceGfxIndex(estimatedSize, progress, context),
		]);
	},
	onSuccess: () => {
		sendEvent("gfxIndex", { size: estimatedSize[0].toString() });
	},
});

const buildGate = builder.gate;

function ensureIndexBuilt(): Promise<[void, void, void]> {
	return builder.ensureBuilt();
}

/** The game's order: the working mod, then the mods it extends, then vanilla. */
export async function getGfxContainerFile(
	gfxName: string | undefined,
): Promise<string | undefined> {
	if (!gfxIndex || !gfxName) {
		return undefined;
	}

	await ensureIndexBuilt().catch(() => undefined);
	return (
		workspaceGfxIndex[gfxName] ??
		parentGfxIndexes
			.map((index) => index[gfxName])
			.find((item) => item !== undefined) ??
		globalGfxIndex[gfxName]
	)?.file;
}

/**
 * Every sprite name the index holds, from both halves. For a caller that has to look at the names
 * themselves rather than resolve one it already knows -- listing which countries ship art for a
 * technology means reading the whole namespace once, not probing every tag against every id.
 * Empty when the index is off, like `getGfxContainerFile`.
 */
export async function getIndexedGfxNames(): Promise<string[]> {
	if (!gfxIndex) {
		return [];
	}

	await ensureIndexBuilt().catch(() => undefined);
	return uniq([
		...Object.keys(globalGfxIndex),
		...parentGfxIndexes.flatMap((index) => Object.keys(index)),
		...Object.keys(workspaceGfxIndex),
	]);
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
	context: IndexBuildContext,
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
		context,
	);
}

async function buildParentGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	const parents = buildContext.parentModUris;
	parentGfxIndexes = parents.map(() => ({}));
	// No parents, no half: a mod that extends nothing pays no listing and writes no cache for it.
	if (parents.length === 0) {
		return;
	}
	await Promise.all(
		parents.map((parent, index) =>
			buildGfxIndexHalf(
				`gfxIndex.parent.${index}`,
				{
					workspace: false,
					hoi4: false,
					recursively: true,
					parentModUris: [parent],
				},
				parentGfxIndexes[index]!,
				null,
				estimatedSize,
				progress,
				buildContext,
			),
		),
	);
}

async function buildWorkspaceGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
	context?: IndexBuildContext,
): Promise<void> {
	const buildContext = context ?? (await captureIndexBuildContext());
	await buildGfxIndexHalf(
		"gfxIndex.workspace",
		{ parent: false, hoi4: false, recursively: true },
		workspaceGfxIndex,
		workspaceGfxFileToKeys,
		estimatedSize,
		progress,
		buildContext,
	);
}

async function buildGfxIndexHalf(
	cacheName: string,
	options: ListFilesOptions,
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	estimatedSize: [number],
	progress: IndexProgress,
	context: IndexBuildContext,
): Promise<void> {
	await buildIndexHalf<GfxCacheData>(
		{
			cacheName,
			version: GFX_CACHE_VERSION,
			cacheScope: context.cacheScope,
			dependencyGeneration: context.dependencyGeneration,
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
				bumpGfxIndexVersion();
			},
			parseFile: async (file) => {
				await fillGfxItems(
					file,
					targetIndex,
					fileToKeysMap,
					options,
					estimatedSize,
				);
				bumpGfxIndexVersion();
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
	options: FileSourceOptions,
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
			bumpGfxIndexVersion();
		},
		build: buildWorkspaceGfxIndex,
		message: localize(
			"gfxindex.workspace.building",
			"Building workspace GFX index...",
		),
		telemetryEvent: "gfxIndex.workspace",
		failureMessage: "Building workspace GFX index failed.",
	},
	rebuildParent: {
		reset: () => {
			parentGfxIndexes = [];
			bumpGfxIndexVersion();
		},
		build: buildParentGfxIndex,
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
	bumpGfxIndexVersion();
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

	// No URI: a re-index reaches one file, so resolving it the usual way costs nothing. Workspace
	// only: a re-index that fires after the file was deleted must not read the parent's copy into
	// this half, which is the one half the parent's files are never in.
	const parsedIndex: Record<string, GfxIndexItem | undefined> = {};
	const parsedKeys = new Map<string, string[]>();
	const parsed = await fillGfxItems(
		{ path: relative },
		parsedIndex,
		parsedKeys,
		{ parent: false, hoi4: false },
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
	bumpGfxIndexVersion();
}
// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetGfxIndexForTests(): void {
	builder.reset();
	for (const key of Object.keys(globalGfxIndex)) {
		delete globalGfxIndex[key];
	}
	parentGfxIndexes = [];
	workspaceGfxIndex = {};
	workspaceGfxFileToKeys.clear();
	bumpGfxIndexVersion();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = watchers.handlers;
