import type * as vscode from "vscode";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { getFlags } from "./featureflags";
import { IndexFile } from "./indexListing";
import { localize } from "./i18n";
import uniq from "lodash/uniq";
import { FileSourceOptions } from "./fileloader";
import { readIndexFileContent, reportIndexParseFailure } from "./indexHalf";
import { createThreeHalfIndex } from "./indexFactory";

interface GfxIndexItem {
	file: string;
}

// The parent mods get a half of their own rather than a share of the workspace's. Precedence
// between sources is what the halves are for: inside one half the last file to parse wins, and
// the parse queue is four wide, so a sprite the workspace redefines in a differently named .gfx
// would resolve to the parent's file on some builds and the workspace's on others.
interface GfxHalf {
	index: Record<string, GfxIndexItem | undefined>;
	// Reverse map for O(1) removal: file path -> sprite names from that file. The workspace half
	// alone keeps one: nothing invalidates a vanilla or parent file per-file, so building one there
	// only ever wrote an empty object into the cache.
	fileToKeys: Map<string, string[]> | null;
}

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

// 4: progressBarType sprites are indexed, and a .gfx left open at its end is read as the game reads
// it (vanilla powerbalanceview.gfx), so a cache written before either is missing sprites.
const GFX_CACHE_VERSION = 4;

/**
 * One .gfx file, as one line of the cache: the sprites the index resolves to it, and -- in the
 * workspace half, the only one that keeps them -- every sprite name the file defines, including
 * ones another file has since taken over.
 */
interface GfxCacheRecord {
	file: string;
	sprites: string[];
	keys?: string[];
}

function toGfxCacheRecords({ index, fileToKeys }: GfxHalf): GfxCacheRecord[] {
	const records = new Map<string, GfxCacheRecord>();
	const recordFor = (file: string): GfxCacheRecord => {
		let record = records.get(file);
		if (!record) {
			record = { file, sprites: [] };
			records.set(file, record);
		}
		return record;
	};

	for (const spriteName in index) {
		const item = index[spriteName];
		if (item) {
			recordFor(item.file).sprites.push(spriteName);
		}
	}
	for (const [file, keys] of fileToKeys ?? []) {
		recordFor(file).keys = [...keys];
	}
	return [...records.values()];
}

const gfxIndex = createThreeHalfIndex<GfxHalf, GfxCacheRecord>({
	name: "gfxIndex",
	message: localize("gfxindex.building", "Building GFX index..."),
	rebuildMessage: localize("gfxindex.workspace.building", "Building workspace GFX index..."),
	rebuildFailureMessage: "Building workspace GFX index failed.",
	enabled: () => getFlags().gfxIndex,
	roots: ["interface"],
	filter: (relativePath) => relativePath.toLocaleLowerCase().endsWith(".gfx"),
	extension: ".gfx",
	cacheVersion: GFX_CACHE_VERSION,
	newHalf: (source) => ({ index: {}, fileToKeys: source === "workspace" ? new Map() : null }),
	hydrate: ({ index, fileToKeys }, record, skipFiles) => {
		if (skipFiles.has(record.file)) {
			return;
		}
		for (const spriteName of record.sprites) {
			index[spriteName] = { file: record.file };
		}
		if (fileToKeys && record.keys) {
			fileToKeys.set(record.file, record.keys);
		}
		bumpGfxIndexVersion();
	},
	parseFile: async (half, file, options) => {
		const parsed = await fillGfxItems(file, half, options);
		bumpGfxIndexVersion();
		return parsed;
	},
	serialize: toGfxCacheRecords,
	removeFile: ({ index, fileToKeys }, relative) => {
		for (const key of fileToKeys?.get(relative) ?? []) {
			if (index[key]?.file === relative) {
				delete index[key];
			}
		}
		fileToKeys?.delete(relative);
	},
	mergeFile: (workspace, parsed, relative) => {
		Object.assign(workspace.index, parsed.index);
		const keys = parsed.fileToKeys?.get(relative);
		if (keys) {
			workspace.fileToKeys?.set(relative, keys);
		}
	},
	changed: bumpGfxIndexVersion,
});

export async function getGfxContainerFile(
	gfxName: string | undefined,
): Promise<string | undefined> {
	if (!getFlags().gfxIndex || !gfxName) {
		return undefined;
	}

	await gfxIndex.ensureBuilt().catch(() => undefined);
	return gfxIndex
		.inPrecedence()
		.map((half) => half.index[gfxName])
		.find((item) => item !== undefined)?.file;
}

/**
 * Every sprite name the index holds, from both halves. For a caller that has to look at the names
 * themselves rather than resolve one it already knows -- listing which countries ship art for a
 * technology means reading the whole namespace once, not probing every tag against every id.
 * Empty when the index is off, like `getGfxContainerFile`.
 */
export async function getIndexedGfxNames(): Promise<string[]> {
	if (!getFlags().gfxIndex) {
		return [];
	}

	await gfxIndex.ensureBuilt().catch(() => undefined);
	const { global, parents, workspace } = gfxIndex.halves();
	return uniq([global, ...parents, workspace].flatMap((half) => Object.keys(half.index)));
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

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillGfxItems(
	gfxFile: IndexFile,
	{ index, fileToKeys }: GfxHalf,
	options: FileSourceOptions,
): Promise<boolean> {
	const filePath = gfxFile.path;

	const fileBuffer = await readIndexFileContent("Gfx index", gfxFile, options);
	if (fileBuffer === undefined) {
		return false;
	}

	try {
		const spriteTypes = getSpriteTypes(
			parseHoi4File(
				fileBuffer.toString(),
				localize("infile", "In file {0}:\n", filePath),
				{ keepTokens: false, closeBlocksAtEof: true },
			),
		);
		const spriteNames: string[] = [];
		for (const spriteType of spriteTypes) {
			index[spriteType.name] = { file: filePath };
			if (fileToKeys) {
				spriteNames.push(spriteType.name);
			}
		}
		if (fileToKeys && spriteNames.length > 0) {
			fileToKeys.set(filePath, spriteNames);
		}
		return true;
	} catch (e) {
		// This used to go to the debug console wrapped in a UserError, so a malformed .gfx file
		// never showed up in the output channel where every other index reports.
		reportIndexParseFailure(filePath, options, e);
		return false;
	}
}

export function registerGfxIndex(): vscode.Disposable {
	return gfxIndex.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetGfxIndexForTests(): void {
	gfxIndex.resetForTests();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = gfxIndex.handlers;
