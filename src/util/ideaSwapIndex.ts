import type * as vscode from "vscode";
import { IndexFile } from "./indexListing";
import { localize } from "./i18n";
import { FileSourceOptions } from "./fileloader";
import { readIndexFileContent, reportIndexParseFailure } from "./indexHalf";
import { createThreeHalfIndex } from "./indexFactory";
import { Node, parseHoi4File } from "../hoiformat/hoiparser";
import { getFlags } from "./featureflags";
import { Logger } from "./logger";

/*
 * Where every `swap_ideas` in the workspace is written, so an idea preview can say which idea an
 * idea turns into.
 *
 * The swaps are almost never in the ideas file itself -- they live in the focus, decision and
 * scripted-effect files that perform them -- so answering "what does this idea become" means having
 * read all of common/ and events/. That is the reason this index sits behind its own setting and is
 * off by default: it reads a great deal more than the other three.
 *
 * Two things keep the cost down. Only files whose text contains the literal `swap_ideas` are
 * parsed, which in a mod the size of Millennium Dawn is a couple of hundred out of nearly four
 * thousand. And the result is cached to disk against file mtimes, so a second session pays for the
 * mtime walk and nothing else.
 */

export interface IdeaSwap {
	from: string;
	to: string;
	file: string;
	start: number;
	end: number;
}

// What is cached per file: the swap without the file name, which the key already carries.
interface SwapRecord {
	from: string;
	to: string;
	start: number;
	end: number;
}

interface SwapIndex {
	[file: string]: SwapRecord[];
}

const SWAP_CACHE_VERSION = 2;

/** One file's swaps, as one line of the cache. */
type SwapCacheRecord = [file: string, swaps: SwapRecord[]];

// The parent mods get a half of their own, like the other indexes. This one is keyed by file rather
// than by id, so nothing here races; the half exists so that deleting a workspace override of a
// parent's file leaves the parent's copy in place rather than dropping both.
const swapIndex = createThreeHalfIndex<SwapIndex, SwapCacheRecord>({
	name: "ideaSwapIndex",
	message: localize("ideaSwapIndex.building", "Building idea swap index..."),
	rebuildMessage: localize(
		"ideaSwapIndex.workspace.building",
		"Building workspace idea swap index...",
	),
	rebuildFailureMessage: "Building workspace idea swap index failed.",
	enabled: () => getFlags().ideaSwapIndex,
	// The roots a swap can be written under. `common` and `events` between them cover focus trees,
	// decisions, scripted effects, scripted GUIs, balance-of-power blocks and the ideas files
	// themselves, and enumerating the subfolders instead would silently miss whichever one a mod
	// invents next.
	roots: ["common", "events"],
	filter: (relativePath) => relativePath.toLowerCase().endsWith(".txt"),
	// A mod that has no events/ folder at all is ordinary, and it should cost that root rather than
	// the whole index. The other three indexes have a single root and let it propagate.
	tolerateRootErrors: true,
	extension: ".txt",
	cacheVersion: SWAP_CACHE_VERSION,
	newHalf: () => ({}),
	hydrate: (half, [file, swaps], skipFiles) => {
		if (skipFiles.has(file)) {
			return;
		}
		half[file] = swaps;
		markSwapIndexChanged();
	},
	parseFile: fillSwaps,
	serialize: (half) => Object.entries(half),
	removeFile: (workspace, relative) => {
		delete workspace[relative];
	},
	mergeFile: (workspace, parsed, relative) => {
		const swaps = parsed[relative];
		if (swaps) {
			workspace[relative] = swaps;
		}
	},
	changed: markSwapIndexChanged,
});

/** Returns whether the file was read and parsed, so a re-index knows not to discard what it has. */
async function fillSwaps(
	half: SwapIndex,
	swapFile: IndexFile,
	options: FileSourceOptions,
): Promise<boolean> {
	const filePath = swapFile.path;
	const fileBuffer = await readIndexFileContent(
		"Idea swap index",
		swapFile,
		options,
	);
	if (fileBuffer === undefined) {
		return false;
	}
	const fileContent = fileBuffer.toString();

	// The prescan that makes this affordable: parsing is what costs, and the overwhelming majority
	// of files never mention a swap.
	if (!fileContent.includes("swap_ideas")) {
		delete half[filePath];
		markSwapIndexChanged();
		return true;
	}

	try {
		const swaps = extractIdeaSwaps(
			parseHoi4File(
				fileContent,
				localize("infile", "In file {0}:\n", filePath),
			),
		);
		if (swaps.length > 0) {
			half[filePath] = swaps;
		} else {
			delete half[filePath];
		}
		markSwapIndexChanged();
		return true;
	} catch (e) {
		reportIndexParseFailure(filePath, options, e);
		return false;
	}
}

/**
 * Every `swap_ideas` block in a parse tree, wherever it sits. Exported for the tests, which drive
 * it against a parsed string rather than the file system.
 */
export function extractIdeaSwaps(node: Node): SwapRecord[] {
	const result: SwapRecord[] = [];
	walk(node);
	return result;

	function walk(current: Node): void {
		if (!Array.isArray(current.value)) {
			return;
		}

		for (const child of current.value) {
			if (child.name?.toLowerCase() === "swap_ideas") {
				readSwapBlock(child, result);
				// A swap block holds nothing but remove_idea/add_idea, so there is nothing below it
				// worth descending into.
				continue;
			}
			walk(child);
		}
	}
}

function readSwapBlock(node: Node, into: SwapRecord[]): void {
	if (!Array.isArray(node.value)) {
		return;
	}

	const removed: string[] = [];
	const added: string[] = [];
	for (const child of node.value) {
		const name = child.name?.toLowerCase();
		const value = symbolName(child.value);
		if (value === undefined) {
			continue;
		}
		if (name === "remove_idea") {
			removed.push(value);
		} else if (name === "add_idea") {
			added.push(value);
		}
	}

	if (removed.length === 0 || added.length === 0) {
		return;
	}

	const start = node.nameToken?.start ?? 0;
	const end = node.valueEndToken?.end ?? node.nameToken?.end ?? start;

	// The usual block is one of each. When a block lists several, matching counts pair up in the
	// order written -- that is what the game does -- and mismatched counts fall back to every
	// combination rather than dropping the extras.
	if (removed.length === added.length) {
		for (let i = 0; i < removed.length; i++) {
			pushSwap(into, removed[i], added[i], start, end);
		}
		return;
	}

	for (const from of removed) {
		for (const to of added) {
			pushSwap(into, from, to, start, end);
		}
	}
}

function pushSwap(
	into: SwapRecord[],
	from: string | undefined,
	to: string | undefined,
	start: number,
	end: number,
): void {
	if (from === undefined || to === undefined || from === to) {
		return;
	}
	into.push({ from, to, start, end });
}

function symbolName(value: Node["value"]): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value.name;
	}
	return undefined;
}

/**
 * Every swap reachable from the given ideas, following the chain in both directions until it stops
 * growing. A chain that leaves the previewed file is followed out of it, so the reader sees where
 * an idea ends up even when the rest of the chain is defined elsewhere.
 */
export async function getIdeaSwaps(ideaIds: string[]): Promise<IdeaSwap[]> {
	if (!getFlags().ideaSwapIndex || ideaIds.length === 0) {
		return [];
	}

	await swapIndex.ensureBuilt().catch((e: unknown) => {
		Logger.warn(`[Index] ideaSwap: lookup for ${ideaIds.length} idea(s) served without the index: ${e}`);
	});

	const byIdea = buildLookup();
	const seen = new Set<string>();
	const found = new Map<string, IdeaSwap>();
	const queue = [...ideaIds];

	// Bounded so a mod that swaps an idea back and forth across hundreds of files cannot turn one
	// preview into an unbounded walk. Chains in practice are a handful of steps.
	let budget = 1000;
	while (queue.length > 0 && budget-- > 0) {
		const id = queue.shift();
		if (id === undefined || seen.has(id)) {
			continue;
		}
		seen.add(id);

		for (const swap of byIdea.get(id) ?? []) {
			const key = `${swap.from}\u0000${swap.to}\u0000${swap.file}\u0000${swap.start}`;
			if (found.has(key)) {
				continue;
			}
			found.set(key, swap);
			queue.push(swap.from, swap.to);
		}
	}

	// Sorted so the payload is deterministic whatever order the maps happen to iterate in.
	return [...found.values()].sort(
		(a, b) =>
			a.from.localeCompare(b.from) ||
			a.to.localeCompare(b.to) ||
			a.file.localeCompare(b.file) ||
			a.start - b.start,
	);
}

// The mod's copy of a file shadows the game's, so a workspace entry replaces the global entry for
// the same relative path rather than adding to it.
/*
 * The idea -> swaps lookup, rebuilt only when the index behind it has actually changed.
 *
 * This used to be rebuilt from scratch on every getIdeaSwaps call -- spreading both whole indexes
 * into a new object and walking every swap in the workspace -- and an idea preview calls it once
 * per idea it renders. The revision counter is bumped by everything that writes to either index,
 * so a stale lookup cannot outlive the data it was built from.
 */
let swapRevision = 0;
let cachedLookup: Map<string, IdeaSwap[]> | undefined;
let cachedLookupRevision = -1;

function markSwapIndexChanged(): void {
	swapRevision++;
}

function buildLookup(): Map<string, IdeaSwap[]> {
	if (cachedLookup !== undefined && cachedLookupRevision === swapRevision) {
		return cachedLookup;
	}

	// The game's order, lowest first, so a file every layer has is read from the working mod's copy.
	const merged: SwapIndex = Object.assign({}, ...swapIndex.inPrecedence().reverse());
	const byIdea = new Map<string, IdeaSwap[]>();

	for (const [file, records] of Object.entries(merged)) {
		for (const record of records ?? []) {
			const swap: IdeaSwap = { ...record, file };
			addTo(byIdea, record.from, swap);
			addTo(byIdea, record.to, swap);
		}
	}

	cachedLookup = byIdea;
	cachedLookupRevision = swapRevision;
	return byIdea;
}

function addTo(
	map: Map<string, IdeaSwap[]>,
	key: string,
	swap: IdeaSwap,
): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(swap);
	} else {
		map.set(key, [swap]);
	}
}

export function registerIdeaSwapIndex(): vscode.Disposable {
	return swapIndex.register();
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetIdeaSwapIndexForTests(): void {
	swapIndex.resetForTests();
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = swapIndex.handlers;
