import * as vscode from "vscode";
import * as path from "path";
import { debounceByInput, mapLimit } from "./common";
import {
	getFilePathFromModOrHOI4,
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4,
} from "./fileloader";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { attachTaskWithErrorLogging, createBuildGate } from "./promiseUtils";
import { Logger } from "./logger";
import { Node, parseHoi4File } from "../hoiformat/hoiparser";
import { ideaSwapIndex } from "./featureflags";
import {
	loadCacheManifest,
	loadCacheData,
	saveCacheManifest,
	saveCacheData,
	getFileMtimes,
	computeStaleFiles,
	IndexTimer,
} from "./indexCache";

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

// The roots a swap can be written under. `common` and `events` between them cover focus trees,
// decisions, scripted effects, scripted GUIs, balance-of-power blocks and the ideas files
// themselves, and enumerating the subfolders instead would silently miss whichever one a mod
// invents next.
const swapRoots = ["common", "events"];

const globalSwapIndex: SwapIndex = {};
let workspaceSwapIndex: SwapIndex = {};

export function registerIdeaSwapIndex(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	if (ideaSwapIndex) {
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

// Memoized build promise: first caller starts the build, concurrent callers await the same one.
let buildTask: Promise<[void, void]> | undefined;
// Gates incremental-event handlers so they don't race the build's writes to the index maps.
const buildGate = createBuildGate();

function ensureIndexBuilt(): Promise<[void, void]> {
	if (buildTask) {
		return buildTask;
	}

	const estimatedSize: [number] = [0];
	const task = Promise.all([
		buildGlobalSwapIndex(estimatedSize),
		buildWorkspaceSwapIndex(estimatedSize),
	]);
	buildTask = task;
	buildGate.start(task);

	vscode.window.setStatusBarMessage(
		"$(loading~spin) " +
			localize("ideaSwapIndex.building", "Building idea swap index..."),
		task,
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			sendEvent("ideaSwapIndex", { size: estimatedSize[0].toString() });
		},
		"Building idea swap index failed.",
		Logger.error,
	);

	return task;
}

const SWAP_CACHE_VERSION = 1;

async function listSwapFiles(options: {
	mod?: boolean;
	hoi4?: boolean;
}): Promise<string[]> {
	const listOptions = { ...options, recursively: true };
	const lists = await Promise.all(
		swapRoots.map(async (root) => {
			const files = await listFilesFromModOrHOI4(root, listOptions).catch(
				() => [] as string[],
			);
			return files
				.filter((f) => f.toLowerCase().endsWith(".txt"))
				.map((f) => `${root}/${f}`);
		}),
	);
	return lists.flat();
}

async function buildGlobalSwapIndex(estimatedSize: [number]): Promise<void> {
	const options = { mod: false, hoi4: true };
	await buildSwapIndexWithCache(
		"ideaSwapIndex.global",
		await listSwapFiles(options),
		globalSwapIndex,
		options,
		estimatedSize,
	);
}

async function buildWorkspaceSwapIndex(estimatedSize: [number]): Promise<void> {
	const options = { mod: true, hoi4: false };
	await buildSwapIndexWithCache(
		"ideaSwapIndex.workspace",
		await listSwapFiles(options),
		workspaceSwapIndex,
		options,
		estimatedSize,
	);
}

async function buildSwapIndexWithCache(
	cacheName: string,
	swapFiles: string[],
	swapIndex: SwapIndex,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	const timer = new IndexTimer(cacheName);
	const resolveUri = (relativePath: string) =>
		getFilePathFromModOrHOI4(relativePath, options);
	const currentMtimes = await getFileMtimes(swapFiles, resolveUri);
	timer.mark("mtime");

	const manifest = await loadCacheManifest(cacheName, SWAP_CACHE_VERSION);
	let filesToParse = swapFiles;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, currentMtimes);
		const cachedData = await loadCacheData(cacheName);

		if (
			cachedData &&
			staleness.stale.length + staleness.removed.length + staleness.added.length <
				swapFiles.length
		) {
			try {
				const cached: SwapIndex = JSON.parse(cachedData);
				const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
				for (const file in cached) {
					if (!skipFiles.has(file)) {
						const swaps = cached[file];
						if (swaps === undefined) {
							continue;
						}
						swapIndex[file] = swaps;
					}
				}
				filesToParse = [...staleness.stale, ...staleness.added];
			} catch {
				Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
				filesToParse = swapFiles;
			}
		}
	}
	timer.mark("cache");

	await mapLimit(filesToParse, 8, (f) =>
		fillSwaps(f, swapIndex, options, estimatedSize),
	);
	timer.mark("parse");
	timer.log(swapFiles.length, filesToParse.length);

	// fire-and-forget: write data before manifest for atomicity
	void Promise.all([
		saveCacheData(cacheName, JSON.stringify(swapIndex)),
		saveCacheManifest(cacheName, swapFiles, currentMtimes, SWAP_CACHE_VERSION),
	]).catch((e) => Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}

async function fillSwaps(
	swapFile: string,
	swapIndex: SwapIndex,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<void> {
	let fileContent: string;
	try {
		const [fileBuffer] = await readFileFromModOrHOI4(swapFile, options);
		fileContent = fileBuffer.toString();
		if (estimatedSize) {
			estimatedSize[0] += fileBuffer.length;
		}
	} catch (e) {
		// A file listed but unreadable -- deleted between the listing and the read, or locked --
		// costs this one file and nothing else.
		Logger.warn(`Idea swap index: can't read ${swapFile}: ${e}`);
		return;
	}

	// The prescan that makes this affordable: parsing is what costs, and the overwhelming majority
	// of files never mention a swap.
	if (!fileContent.includes("swap_ideas")) {
		delete swapIndex[swapFile];
		return;
	}

	try {
		const swaps = extractIdeaSwaps(
			parseHoi4File(fileContent, localize("infile", "In file {0}:\n", swapFile)),
		);
		if (swaps.length > 0) {
			swapIndex[swapFile] = swaps;
		} else {
			delete swapIndex[swapFile];
		}
	} catch (e) {
		const errText = e instanceof Error ? (e.stack ?? e.message) : String(e);
		Logger.error(`Idea swap index: parsing ${swapFile} failed.\n${errText}`);
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
	if (!ideaSwapIndex || ideaIds.length === 0) {
		return [];
	}

	await ensureIndexBuilt().catch(() => undefined);

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
			const key = `${swap.from} ${swap.to} ${swap.file} ${swap.start}`;
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
function buildLookup(): Map<string, IdeaSwap[]> {
	const merged: SwapIndex = { ...globalSwapIndex, ...workspaceSwapIndex };
	const byIdea = new Map<string, IdeaSwap[]>();

	for (const [file, records] of Object.entries(merged)) {
		for (const record of records ?? []) {
			const swap: IdeaSwap = { ...record, file };
			addTo(byIdea, record.from, swap);
			addTo(byIdea, record.to, swap);
		}
	}

	return byIdea;
}

function addTo(map: Map<string, IdeaSwap[]>, key: string, swap: IdeaSwap): void {
	const existing = map.get(key);
	if (existing) {
		existing.push(swap);
	} else {
		map.set(key, [swap]);
	}
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
	if (!buildTask) {
		return;
	}

	workspaceSwapIndex = {};

	const estimatedSize: [number] = [0];
	const task = buildWorkspaceSwapIndex(estimatedSize);
	vscode.window.setStatusBarMessage(
		"$(loading~spin) " +
			localize(
				"ideaSwapIndex.workspace.building",
				"Building workspace idea swap index...",
			),
		task,
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			sendEvent("ideaSwapIndex.workspace", {
				size: estimatedSize[0].toString(),
			});
		},
		"Building workspace idea swap index failed.",
		Logger.error,
	);
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
	if (!buildTask) {
		return;
	}

	const file = e.document.uri;
	if (file.path.endsWith(".txt")) {
		onChangeTextDocumentImpl(file);
	}
}

const onChangeTextDocumentImpl = debounceByInput(
	(file: vscode.Uri) => {
		buildGate.runAfterBuild(() => {
			removeWorkspaceSwaps(file);
			addWorkspaceSwaps(file);
		});
	},
	(file) => file.toString(),
	1000,
	{ trailing: true },
);

function onCloseTextDocument(document: vscode.TextDocument) {
	if (!buildTask) {
		return;
	}

	const file = document.uri;
	if (file.path.endsWith(".txt") && document.isDirty) {
		buildGate.runAfterBuild(() => {
			removeWorkspaceSwaps(file);
			addWorkspaceSwaps(file);
		});
	}
}

function onCreateFiles(e: vscode.FileCreateEvent) {
	if (!buildTask) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".txt")) {
				addWorkspaceSwaps(file);
			}
		}
	});
}

function onDeleteFiles(e: vscode.FileDeleteEvent) {
	if (!buildTask) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".txt")) {
				removeWorkspaceSwaps(file);
			}
		}
	});
}

function onRenameFiles(e: vscode.FileRenameEvent) {
	onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
	onCreateFiles({ files: e.files.map((f) => f.newUri) });
}

function relativeSwapPath(file: vscode.Uri): string | undefined {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (!wsFolder) {
		return undefined;
	}

	const relative = path
		.relative(wsFolder.uri.path, file.path)
		.replace(/\\+/g, "/");
	if (!relative || !swapRoots.some((root) => relative.startsWith(`${root}/`))) {
		return undefined;
	}

	return relative;
}

function removeWorkspaceSwaps(file: vscode.Uri) {
	const relative = relativeSwapPath(file);
	if (relative) {
		delete workspaceSwapIndex[relative];
	}
}

function addWorkspaceSwaps(file: vscode.Uri) {
	const relative = relativeSwapPath(file);
	if (relative) {
		void fillSwaps(relative, workspaceSwapIndex, { hoi4: false });
	}
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetIdeaSwapIndexForTests(): void {
	buildTask = undefined;
	buildGate.reset();
	for (const file of Object.keys(globalSwapIndex)) {
		delete globalSwapIndex[file];
	}
	workspaceSwapIndex = {};
}

// Test-only: exposes the incremental event handlers so tests can drive the build/event race directly.
export const __testHandlers = {
	onCreateFiles,
	onDeleteFiles,
	onCloseTextDocument,
};

// Test-only: lets a test seed the workspace half of the index without touching the file system.
export function __seedWorkspaceSwapsForTests(index: {
	[file: string]: SwapRecord[];
}): void {
	workspaceSwapIndex = { ...index };
	buildTask = Promise.all([Promise.resolve(), Promise.resolve()]);
}
