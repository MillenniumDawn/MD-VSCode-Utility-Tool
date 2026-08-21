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
import { extractFocusIds } from "../previewdef/focustree/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { sharedFocusIndex } from "./featureflags";
import {
	loadCacheManifest,
	loadCacheData,
	saveCacheManifest,
	saveCacheData,
	getFileMtimes,
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
		buildGlobalFocusIndex(estimatedSize),
		buildWorkspaceFocusIndex(estimatedSize),
	]);
	buildTask = task;
	buildGate.start(task);

	vscode.window.setStatusBarMessage(
		"$(loading~spin) " +
			localize("sharedFocusIndex.building", "Building Shared Focus index..."),
		task,
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			vscode.window.showInformationMessage(
				localize(
					"sharedFocusIndex.builddone",
					"Building Shared Focus index done.",
				),
			);
			sendEvent("sharedFocusIndex", { size: estimatedSize[0].toString() });
		},
		"Building Shared Focus index failed.",
		Logger.error,
	);

	return task;
}

const FOCUS_CACHE_VERSION = 1;

async function buildGlobalFocusIndex(estimatedSize: [number]): Promise<void> {
	const options = { mod: false, hoi4: true, recursively: true };
	const focusFiles = (
		await listFilesFromModOrHOI4("common/national_focus", options)
	).map((f) => "common/national_focus/" + f);
	await buildFocusIndexWithCache(
		"focusIndex.global",
		focusFiles,
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
	const focusFiles = (
		await listFilesFromModOrHOI4("common/national_focus", options)
	).map((f) => "common/national_focus/" + f);
	await buildFocusIndexWithCache(
		"focusIndex.workspace",
		focusFiles,
		workspaceFocusIndex,
		workspaceFocusKeyToFile,
		options,
		estimatedSize,
	);
}

async function buildFocusIndexWithCache(
	cacheName: string,
	focusFiles: string[],
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	const timer = new IndexTimer(cacheName);
	const resolveUri = (relativePath: string) =>
		getFilePathFromModOrHOI4(relativePath, options);
	const currentMtimes = await getFileMtimes(focusFiles, resolveUri);
	timer.mark("mtime");

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
	timer.mark("cache");

	await mapLimit(filesToParse, 8, (f) =>
		fillFocusItems(f, focusIndex, reverseMap, options, estimatedSize),
	);
	timer.mark("parse");
	timer.log(focusFiles.length, filesToParse.length);

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
	focusFile: string,
	focusIndex: FocusIndex,
	reverseMap: Map<string, string>,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<void> {
	const ids = await readFocusIds(focusFile, options, estimatedSize);
	if (ids === undefined) {
		return;
	}

	applyFocusIds(focusFile, ids, focusIndex, reverseMap);
}

/**
 * Reading and parsing half of the index fill. Returns the file's focus ids, an empty list when the
 * file holds no focus definitions at all, or undefined when parsing failed -- so the caller decides
 * whether a failure means "write nothing" (the build) or "keep what is already indexed" (a re-index).
 */
async function readFocusIds(
	focusFile: string,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<string[] | undefined> {
	const [fileBuffer] = await readFileFromModOrHOI4(focusFile, options);
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
				localize("infile", "In file {0}:\n", focusFile),
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
		Logger.error(`${baseMessage} ${focusFile} ${failureMessage}\n${errText}`);
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
	if (!buildTask) {
		return;
	}

	workspaceFocusIndex = {};
	workspaceFocusKeyToFile.clear();

	const estimatedSize: [number] = [0];
	const task = buildWorkspaceFocusIndex(estimatedSize);
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
				size: estimatedSize[0].toString(),
			});
		},
		"Building workspace Focus index failed.",
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
			void reindexWorkspaceFocusFile(file);
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
			void reindexWorkspaceFocusFile(file);
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
				void reindexWorkspaceFocusFile(file);
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

	let ids: string[] | undefined;
	try {
		ids = await readFocusIds(relative, { hoi4: false });
	} catch (e) {
		// readFocusIds only throws when the file can't be read at all; a parse failure it logs and
		// reports as undefined. Either way the previously indexed ids stay in place.
		Logger.error(`Re-indexing ${relative} failed: ${e}`);
		return;
	}

	if (ids === undefined) {
		return;
	}

	applyFocusIds(relative, ids, workspaceFocusIndex, workspaceFocusKeyToFile);
}

// Test-only: clears memoized build state so isolated tests can exercise the lazy-build path.
export function __resetSharedFocusIndexForTests(): void {
	buildTask = undefined;
	buildGate.reset();
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
