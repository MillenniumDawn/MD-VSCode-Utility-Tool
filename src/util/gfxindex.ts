import * as vscode from "vscode";
import * as path from "path";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { debounceByInput, forceError, UserError } from "./common";
import { error } from "./debug";
import { gfxIndex } from "./featureflags";
import { readFileFromModOrHOI4 } from "./fileloader";
import {
	IndexFile,
	IndexListing,
	listIndexFiles,
	toIndexFiles,
} from "./indexListing";
import { localize } from "./i18n";
import { uniq } from "lodash";
import { sendEvent } from "./telemetry";
import { attachTaskWithErrorLogging } from "./promiseUtils";
import {
	createIndexBuilder,
	indexParseQueue,
	IndexProgress,
	withIndexProgress,
} from "./indexBuild";
import { Logger } from "./logger";
import {
	loadCacheManifest,
	loadCacheData,
	saveCacheManifest,
	saveCacheData,
	computeStaleFiles,
	IndexTimer,
} from "./indexCache";

interface GfxIndexItem {
	file: string;
}

const globalGfxIndex: Record<string, GfxIndexItem | undefined> = {};
let workspaceGfxIndex: Record<string, GfxIndexItem | undefined> = {};

// Reverse map for O(1) removal: file path -> sprite names from that file
const workspaceGfxFileToKeys = new Map<string, string[]>();

export function registerGfxIndex(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	if (gfxIndex) {
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
	const options = { mod: false, recursively: true };
	await buildGfxIndexWithCache(
		"gfxIndex.global",
		(token) =>
			listIndexFiles({
				roots: [gfxRoot],
				filter: isGfxFile,
				options: { ...options, token },
			}),
		globalGfxIndex,
		null,
		options,
		estimatedSize,
		progress,
	);
}

async function buildWorkspaceGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	const options = { hoi4: false, recursively: true };
	await buildGfxIndexWithCache(
		"gfxIndex.workspace",
		(token) =>
			listIndexFiles({
				roots: [gfxRoot],
				filter: isGfxFile,
				options: { ...options, token },
			}),
		workspaceGfxIndex,
		workspaceGfxFileToKeys,
		options,
		estimatedSize,
		progress,
	);
}

async function buildGfxIndexWithCache(
	cacheName: string,
	listFiles: (token: vscode.CancellationToken) => Promise<IndexListing>,
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	const timer = new IndexTimer(cacheName);
	try {
		await buildGfxIndexWithTimer(
			timer,
			cacheName,
			listFiles,
			targetIndex,
			fileToKeysMap,
			options,
			estimatedSize,
			progress,
		);
	} finally {
		// A build that threw must not leave a phase behind in the live-build report.
		timer.dispose();
	}
}

async function buildGfxIndexWithTimer(
	timer: IndexTimer,
	cacheName: string,
	listFiles: (token: vscode.CancellationToken) => Promise<IndexListing>,
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	// The listing runs here rather than in the caller so that the timer covers it. On a desktop
	// install it is now the directory walk and the mtimes together, which is where a slow cold build
	// spends its time, and it used to happen before the timer existed.
	timer.begin("list");
	const {
		filePaths: gfxFiles,
		uris,
		mtimes: currentMtimes,
	} = await listFiles(progress.token);

	timer.begin("cache");
	const manifest = await loadCacheManifest(cacheName, GFX_CACHE_VERSION);
	let filesToParse = gfxFiles;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, currentMtimes);
		const cachedData = await loadCacheData(cacheName);

		// Whatever is still fresh gets reused, however much of the listing changed. See the same
		// spot in sharedFocusIndex for why counting the changed files only ever added work.
		if (cachedData) {
			try {
				const cached: GfxCacheData = JSON.parse(cachedData);
				const skipFiles = new Set([...staleness.stale, ...staleness.removed]);
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
				filesToParse = [...staleness.stale, ...staleness.added];
			} catch {
				Logger.warn(`${cacheName}: cache data corrupted, full rebuild`);
				filesToParse = gfxFiles;
			}
		}
	}

	timer.begin("parse");
	let parsed = 0;
	const toParse = toIndexFiles(filesToParse, uris);
	progress.report(0, toParse.length);
	await indexParseQueue.map(
		toParse,
		async (f) => {
			await fillGfxItems(f, targetIndex, fileToKeysMap, options, estimatedSize);
			timer.progress(++parsed, toParse.length);
			progress.report(parsed, toParse.length);
		},
		{ token: progress.token },
	);
	timer.end(gfxFiles.length, filesToParse.length);

	const serializedFileToKeys: Record<string, string[]> = {};
	if (fileToKeysMap) {
		fileToKeysMap.forEach((keys, file) => {
			serializedFileToKeys[file] = keys;
		});
	}
	const cacheData: GfxCacheData = {
		index: targetIndex,
		fileToKeys: serializedFileToKeys,
	};
	// fire-and-forget: write data before manifest for atomicity
	void Promise.all([
		saveCacheData(cacheName, JSON.stringify(cacheData)),
		saveCacheManifest(cacheName, gfxFiles, currentMtimes, GFX_CACHE_VERSION),
	]).catch((e) => Logger.error(`Cache save failed for ${cacheName}: ${e}`));
}

async function fillGfxItems(
	gfxFile: IndexFile,
	gfxIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<void> {
	const filePath = gfxFile.path;
	try {
		if (estimatedSize) {
			// The path's length, not the file's, which is what this has always counted.
			estimatedSize[0] += filePath.length;
		}
		const [fileBuffer, uri] = await readFileFromModOrHOI4(
			filePath,
			options,
			gfxFile.uri,
		);
		const spriteTypes = getSpriteTypes(
			parseHoi4File(
				fileBuffer.toString(),
				localize("infile", "In file {0}:\n", uri.toString()),
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
	} catch (e) {
		error(new UserError(forceError(e).toString()));
	}
}

function onChangeWorkspaceFolders(_: vscode.WorkspaceFoldersChangeEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	workspaceGfxIndex = {};
	workspaceGfxFileToKeys.clear();
	const folderChangeSize: [number] = [0];
	const task = withIndexProgress(
		localize("gfxindex.workspace.building", "Building workspace GFX index..."),
		(progress) => buildWorkspaceGfxIndex(folderChangeSize, progress),
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			sendEvent("gfxIndex.workspace", {
				size: folderChangeSize[0].toString(),
			});
		},
		"Building workspace GFX index failed.",
		Logger.error,
	);
}

function onChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	const file = e.document.uri;
	if (file.path.endsWith(".gfx")) {
		onChangeTextDocumentImpl(file);
	}
}

const onChangeTextDocumentImpl = debounceByInput(
	(file: vscode.Uri) => {
		buildGate.runAfterBuild(() => {
			removeWorkspaceGfxIndex(file);
			addWorkspaceGfxIndex(file);
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
	if (file.path.endsWith(".gfx") && document.isDirty) {
		buildGate.runAfterBuild(() => {
			removeWorkspaceGfxIndex(file);
			addWorkspaceGfxIndex(file);
		});
	}
}

function onCreateFiles(e: vscode.FileCreateEvent) {
	if (!builder.hasStarted()) {
		return;
	}

	buildGate.runAfterBuild(() => {
		for (const file of e.files) {
			if (file.path.endsWith(".gfx")) {
				addWorkspaceGfxIndex(file);
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
			if (file.path.endsWith(".gfx")) {
				removeWorkspaceGfxIndex(file);
			}
		}
	});
}

function onRenameFiles(e: vscode.FileRenameEvent) {
	onDeleteFiles({ files: e.files.map((f) => f.oldUri) });
	onCreateFiles({ files: e.files.map((f) => f.newUri) });
}

function removeWorkspaceGfxIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("interface/")) {
			const keys = workspaceGfxFileToKeys.get(relative);
			if (keys) {
				for (const key of keys) {
					delete workspaceGfxIndex[key];
				}
				workspaceGfxFileToKeys.delete(relative);
			}
		}
	}
}

function addWorkspaceGfxIndex(file: vscode.Uri) {
	const wsFolder = vscode.workspace.getWorkspaceFolder(file);
	if (wsFolder) {
		const relative = path
			.relative(wsFolder.uri.path, file.path)
			.replace(/\\+/g, "/");
		if (relative && relative.startsWith("interface/")) {
			// No URI: a re-index reaches one file, so resolving it the usual way costs nothing.
			void fillGfxItems(
				{ path: relative },
				workspaceGfxIndex,
				workspaceGfxFileToKeys,
				{ hoi4: false },
			);
		}
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
export const __testHandlers = {
	onCreateFiles,
	onDeleteFiles,
	onCloseTextDocument,
};
