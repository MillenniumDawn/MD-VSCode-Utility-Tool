import * as vscode from "vscode";
import * as path from "path";
import { debounceByInput, mapLimit } from "./common";
import { readFileFromModOrHOI4 } from "./fileloader";
import {
	IndexFile,
	IndexListing,
	listIndexFiles,
	toIndexFiles,
} from "./indexListing";
import { localize } from "./i18n";
import { sendEvent } from "./telemetry";
import { createIndexBuilder } from "./indexBuild";
import { attachTaskWithErrorLogging } from "./promiseUtils";
import { Logger } from "./logger";
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { sharedFocusIndex } from "./featureflags";
import {
	loadCacheManifest,
	loadCacheData,
	saveCacheManifest,
	saveCacheData,
	computeStaleFiles,
	IndexTimer,
} from "./indexCache";

interface FocusIndex {
	[file: string]: string[]; // Filename -> array of focus keys
}

const globalFocusIndex: FocusIndex = {};
let workspaceFocusIndex: FocusIndex = {};

// Reverse maps for O(1) lookup: focusKey -> filename
const globalFocusKeyToFile = new Map<string, string>();
const workspaceFocusKeyToFile = new Map<string, string>();

export function registerSharedFocusIndex(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	if (sharedFocusIndex) {
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
	name: "sharedFocusIndex",
	message: localize(
		"sharedFocusIndex.building",
		"Building Shared Focus index...",
	),
	build: () => {
		estimatedSize = [0];
		return Promise.all([
			buildGlobalFocusIndex(estimatedSize),
			buildWorkspaceFocusIndex(estimatedSize),
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

async function buildGlobalFocusIndex(estimatedSize: [number]): Promise<void> {
	const options = { mod: false, hoi4: true, recursively: true };
	await buildFocusIndexWithCache(
		"focusIndex.global",
		() => listIndexFiles({ roots: [focusRoot], options }),
		globalFocusIndex,
		globalFocusKeyToFile,
		options,
		estimatedSize,
	);
}

async function buildWorkspaceFocusIndex(
	estimatedSize: [number],
): Promise<void> {
	const options = { mod: true, hoi4: false, recursively: true };
	await buildFocusIndexWithCache(
		"focusIndex.workspace",
		() => listIndexFiles({ roots: [focusRoot], options }),
		workspaceFocusIndex,
		workspaceFocusKeyToFile,
		options,
		estimatedSize,
	);
}

async function buildFocusIndexWithCache(
	cacheName: string,
	listFiles: () => Promise<IndexListing>,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	const timer = new IndexTimer(cacheName);
	try {
		await buildFocusIndexWithTimer(
			timer,
			cacheName,
			listFiles,
			focusIndex,
			reverseMap,
			options,
			estimatedSize,
		);
	} finally {
		// A build that threw must not leave a phase behind in the live-build report.
		timer.dispose();
	}
}

async function buildFocusIndexWithTimer(
	timer: IndexTimer,
	cacheName: string,
	listFiles: () => Promise<IndexListing>,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	// The listing runs here rather than in the caller so that the timer covers it. On a desktop
	// install it is now the directory walk and the mtimes together, which is where a slow cold build
	// spends its time, and it used to happen before the timer existed.
	timer.begin("list");
	const {
		filePaths: focusFiles,
		uris,
		mtimes: currentMtimes,
	} = await listFiles();

	timer.begin("cache");
	const manifest = await loadCacheManifest(cacheName, FOCUS_CACHE_VERSION);
	let filesToParse = focusFiles;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, currentMtimes);
		const cachedData = await loadCacheData(cacheName);

		if (
			cachedData &&
			staleness.stale.length +
				staleness.removed.length +
				staleness.added.length <
				focusFiles.length
		) {
			try {
				const cached: FocusIndex = JSON.parse(cachedData);
				const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
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
				filesToParse = [...staleness.stale, ...staleness.added];
			} catch {
				Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
				filesToParse = focusFiles;
			}
		}
	}

	timer.begin("parse");
	let parsed = 0;
	const toParse = toIndexFiles(filesToParse, uris);
	await mapLimit(toParse, 8, async (f) => {
		await fillFocusItems(f, focusIndex, reverseMap, options, estimatedSize);
		timer.progress(++parsed, toParse.length);
	});
	timer.end(focusFiles.length, filesToParse.length);

	// fire-and-forget: write data before manifest for atomicity
	void Promise.all([
		saveCacheData(cacheName, JSON.stringify(focusIndex)),
		saveCacheManifest(
			cacheName,
			focusFiles,
			currentMtimes,
			FOCUS_CACHE_VERSION,
		),
	]).catch((e) => Logger.error(`Cache save failed for ${cacheName}: ${e}`));
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
	let fileBuffer: Buffer;
	let fileContent: string;
	try {
		[fileBuffer] = await readFileFromModOrHOI4(
			filePath,
			options,
			focusFile.uri,
		);
		fileContent = fileBuffer.toString();
	} catch (e) {
		// A file listed but unreadable -- deleted between the listing and the read, or locked --
		// costs this one file and nothing else. Reading used to sit outside the try, so one such
		// file rejected the whole build and left the index half-populated for the session.
		Logger.warn(`Shared focus index: can't read ${filePath}: ${e}`);
		return undefined;
	}

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
		const baseMessage = options.hoi4
			? localize("sharedFocusIndex.vanilla", "[Vanilla]")
			: localize("sharedFocusIndex.mod", "[Mod]");

		const failureMessage = localize(
			"sharedFocusIndex.parseFailure",
			"Parsing failed! Please check if the file has issues!",
		);
		// prefer stack for focus parse failures, fall back to message (unlike localisationIndex which logs message only)
		const errText =
			e instanceof Error
				? e.stack || e.message
				: (() => {
						try {
							return String(e);
						} catch {
							return Object.prototype.toString.call(e);
						}
					})();
		Logger.error(`${baseMessage} ${filePath} ${failureMessage}\n${errText}`);
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

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	workspaceFocusIndex = {};
	workspaceFocusKeyToFile.clear();

	const folderChangeSize: [number] = [0];
	const task = buildWorkspaceFocusIndex(folderChangeSize);
	vscode.window.setStatusBarMessage(
		"$(loading~spin) " +
			localize(
				"sharedFocusIndex.workspace.building",
				"Building workspace Focus index...",
			),
		task,
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			vscode.window.showInformationMessage(
				localize(
					"sharedFocusIndex.workspace.builddone",
					"Building workspace Focus index done.",
				),
			);
			sendEvent("sharedFocusIndex.workspace", {
				size: folderChangeSize[0].toString(),
			});
		},
		"Building workspace Focus index failed.",
		Logger.error,
	);
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
	if (!builder.hasStarted()) {
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
			void reindexWorkspaceFocusFile(file);
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
	if (file.path.endsWith(".txt") && document.isDirty) {
		buildGate.runAfterBuild(() => {
			void reindexWorkspaceFocusFile(file);
		});
	}
}

function onCreateFiles(e: vscode.FileCreateEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".txt")) {
				void reindexWorkspaceFocusFile(file);
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
			if (file.path.endsWith(".txt")) {
				removeWorkspaceFocusIndex(file);
			}
		}
	});
}

function onRenameFiles(e: vscode.FileRenameEvent) {
	onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
	onCreateFiles({ files: e.files.map((f) => f.newUri) });
}

/** The path a focus file is indexed under, or undefined when it isn't a workspace focus file. */
function toWorkspaceFocusPath(file: vscode.Uri): string | undefined {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (!wsFolder) {
		return undefined;
	}

	const relative = path
		.relative(wsFolder.uri.path, file.path)
		.replace(/\\+/g, "/");
	return relative.startsWith("common/national_focus/") ? relative : undefined;
}

function removeWorkspaceFocusIndex(file: vscode.Uri) {
	const relative = toWorkspaceFocusPath(file);
	if (!relative) {
		return;
	}

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
	const relative = toWorkspaceFocusPath(file);
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
export const __testHandlers = {
	onCreateFiles,
	onDeleteFiles,
	onCloseTextDocument,
};
