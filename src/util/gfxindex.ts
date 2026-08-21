import * as vscode from "vscode";
import * as path from "path";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { debounceByInput, forceError, mapLimit, UserError } from "./common";
import { error } from "./debug";
import { gfxIndex } from "./featureflags";
import {
	getFilePathFromModOrHOI4,
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4,
} from "./fileloader";
import { localize } from "./i18n";
import { uniq } from "lodash";
import { sendEvent } from "./telemetry";
import { attachTaskWithErrorLogging } from "./promiseUtils";
import { createIndexBuilder } from "./indexBuild";
import { Logger } from "./logger";
import {
	loadCacheManifest,
	loadCacheData,
	saveCacheManifest,
	saveCacheData,
	getFileMtimes,
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
	build: () => {
		estimatedSize = [0];
		return Promise.all([
			buildGlobalGfxIndex(estimatedSize),
			buildWorkspaceGfxIndex(estimatedSize),
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

async function buildGlobalGfxIndex(estimatedSize: [number]): Promise<void> {
	const options = { mod: false, recursively: true };
	const gfxFiles = (await listFilesFromModOrHOI4("interface", options))
		.filter((f) => f.toLocaleLowerCase().endsWith(".gfx"))
		.map((f) => "interface/" + f);
	await buildGfxIndexWithCache(
		"gfxIndex.global",
		gfxFiles,
		globalGfxIndex,
		null,
		options,
		estimatedSize,
	);
}

async function buildWorkspaceGfxIndex(estimatedSize: [number]): Promise<void> {
	const options = { hoi4: false, recursively: true };
	const gfxFiles = (await listFilesFromModOrHOI4("interface", options))
		.filter((f) => f.toLocaleLowerCase().endsWith(".gfx"))
		.map((f) => "interface/" + f);
	await buildGfxIndexWithCache(
		"gfxIndex.workspace",
		gfxFiles,
		workspaceGfxIndex,
		workspaceGfxFileToKeys,
		options,
		estimatedSize,
	);
}

async function buildGfxIndexWithCache(
	cacheName: string,
	gfxFiles: string[],
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	const timer = new IndexTimer(cacheName);
	try {
		await buildGfxIndexWithTimer(
			timer,
			cacheName,
			gfxFiles,
			targetIndex,
			fileToKeysMap,
			options,
			estimatedSize,
		);
	} finally {
		// A build that threw must not leave a phase behind in the live-build report.
		timer.dispose();
	}
}

async function buildGfxIndexWithTimer(
	timer: IndexTimer,
	cacheName: string,
	gfxFiles: string[],
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize: [number],
): Promise<void> {
	timer.begin("mtime");
	const resolveUri = (relativePath: string) =>
		getFilePathFromModOrHOI4(relativePath, options);
	const currentMtimes = await getFileMtimes(gfxFiles, resolveUri);

	timer.begin("cache");
	const manifest = await loadCacheManifest(cacheName, GFX_CACHE_VERSION);
	let filesToParse = gfxFiles;

	if (manifest) {
		const staleness = computeStaleFiles(manifest, currentMtimes);
		const cachedData = await loadCacheData(cacheName);

		if (
			cachedData &&
			staleness.stale.length +
				staleness.removed.length +
				staleness.added.length <
				gfxFiles.length
		) {
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
	await mapLimit(filesToParse, 8, async (f) => {
		await fillGfxItems(f, targetIndex, fileToKeysMap, options, estimatedSize);
		timer.progress(++parsed, filesToParse.length);
	});
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
	gfxFile: string,
	gfxIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<void> {
	try {
		if (estimatedSize) {
			estimatedSize[0] += gfxFile.length;
		}
		const [fileBuffer, uri] = await readFileFromModOrHOI4(gfxFile, options);
		const spriteTypes = getSpriteTypes(
			parseHoi4File(
				fileBuffer.toString(),
				localize("infile", "In file {0}:\n", uri.toString()),
				{ keepTokens: false },
			),
		);
		const spriteNames: string[] = [];
		for (const spriteType of spriteTypes) {
			gfxIndex[spriteType.name] = { file: gfxFile };
			if (fileToKeysMap) {
				spriteNames.push(spriteType.name);
			}
			if (estimatedSize) {
				estimatedSize[0] += spriteType.name.length + 8;
			}
		}
		if (fileToKeysMap && spriteNames.length > 0) {
			fileToKeysMap.set(gfxFile, spriteNames);
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
	const task = buildWorkspaceGfxIndex(folderChangeSize);
	vscode.window.setStatusBarMessage(
		"$(loading~spin) " +
			localize(
				"gfxindex.workspace.building",
				"Building workspace GFX index...",
			),
		task,
	);
	attachTaskWithErrorLogging(
		task,
		() => {
			vscode.window.showInformationMessage(
				localize(
					"gfxindex.workspace.builddone",
					"Building workspace GFX index done.",
				),
			);
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
			void fillGfxItems(relative, workspaceGfxIndex, workspaceGfxFileToKeys, {
				hoi4: false,
			});
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
