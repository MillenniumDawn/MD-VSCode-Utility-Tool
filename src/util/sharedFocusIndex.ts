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
	const [fileBuffer] = await readFileFromModOrHOI4(focusFile, options);
	const fileContent = fileBuffer.toString();

	// Skip files that don't contain any focus type definitions
	if (
		!fileContent.includes("focus_tree") &&
		!fileContent.includes("shared_focus") &&
		!fileContent.includes("joint_focus")
	) {
		return;
	}

	try {
		const ids = extractFocusIds(
			parseHoi4File(
				fileContent,
				localize("infile", "In file {0}:\n", focusFile),
				{ keepTokens: false },
			),
		);
		focusIndex[focusFile] = ids;

		for (const key of ids) {
			reverseMap.set(key, focusFile);
		}

		if (estimatedSize) {
			estimatedSize[0] += fileBuffer.length;
		}
	} catch (e) {
		const baseMessage = options.hoi4
			? localize("sharedFocusIndex.vanilla", "[Vanilla]")
			: localize("sharedFocusIndex.mod", "[Mod]");

		const failureMessage = localize(
			"sharedFocusIndex.parseFailure",
			"Parsing failed! Please check if the file has issues!",
		);
		Logger.error(
			`${baseMessage} ${focusFile} ${failureMessage}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
		);
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
			removeWorkspaceFocusIndex(file);
			addWorkspaceFocusIndex(file);
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
			removeWorkspaceFocusIndex(file);
			addWorkspaceFocusIndex(file);
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
				addWorkspaceFocusIndex(file);
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

function removeWorkspaceFocusIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("common/national_focus/")) {
			const keys = workspaceFocusIndex[relative];
			if (keys) {
				for (const key of keys) {
					if (workspaceFocusKeyToFile.get(key) === relative) {
						workspaceFocusKeyToFile.delete(key);
					}
				}
			}
			delete workspaceFocusIndex[relative];
		}
	}
}

function addWorkspaceFocusIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("common/national_focus/")) {
			void fillFocusItems(
				relative,
				workspaceFocusIndex,
				workspaceFocusKeyToFile,
				{ hoi4: false },
			);
		}
	}
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
