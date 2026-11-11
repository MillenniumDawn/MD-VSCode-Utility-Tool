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
import { FilePrecedenceIndex } from "./filePrecedenceIndex";

interface GfxIndexItem {
	file: string;
}

type GfxHalf = FilePrecedenceIndex<GfxIndexItem>;

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
// 6: every file retains its own sprites, including definitions shadowed by a later file.
// Version 5 also contains winner-only records (the failed-read retry migration).
const GFX_CACHE_VERSION = 6;

/** One file's actual sprite names, including shadowed definitions. */
interface GfxCacheRecord {
	file: string;
	sprites: string[];
}

function toGfxCacheRecords(half: GfxHalf): GfxCacheRecord[] {
	return half.records().map(({ file, entries }) => ({ file, sprites: Object.keys(entries) }));
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
	newHalf: () => new FilePrecedenceIndex(),
	recordFilePath: (record) => record.file,
	hydrate: (half, record, skipFiles) => {
		if (skipFiles.has(record.file)) {
			return;
		}
		half.setFile(record.file, Object.fromEntries(record.sprites.map(name => [name, { file: record.file }])));
		bumpGfxIndexVersion();
	},
	parseFile: async (half, file, options) => {
		const parsed = await fillGfxItems(file, half, options);
		bumpGfxIndexVersion();
		return parsed;
	},
	serialize: toGfxCacheRecords,
	removeFile: (half, relative) => half.removeFile(relative),
	mergeFile: (workspace, parsed, relative) => {
		const record = parsed.records().find(record => record.file === relative);
		if (record) {
			workspace.setFile(relative, record.entries);
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
	half: GfxHalf,
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
		half.setFile(filePath, Object.fromEntries(spriteTypes.map(sprite => [sprite.name, { file: filePath }])));
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
