import * as vscode from "vscode";
import * as path from "path";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { getSpriteTypes } from "../hoiformat/spritetype";
import { debounceByInput } from "./common";
import { gfxIndex } from "./featureflags";
import { IndexFile, listIndexFiles } from "./indexListing";
import { localize } from "./i18n";
import { uniq } from "lodash";
import { sendEvent } from "./telemetry";
import { attachTaskWithErrorLogging } from "./promiseUtils";
import {
	createIndexBuilder,
	IndexProgress,
	withIndexProgress,
} from "./indexBuild";
import {
	buildIndexHalf,
	readIndexFileContent,
	reportIndexParseFailure,
} from "./indexHalf";
import { Logger } from "./logger";

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
	// The global half keeps no file-to-keys map: nothing invalidates a vanilla file per-file, so
	// building one only ever wrote an empty object into the cache.
	await buildGfxIndexHalf(
		"gfxIndex.global",
		{ mod: false, recursively: true },
		globalGfxIndex,
		null,
		estimatedSize,
		progress,
	);
}

async function buildWorkspaceGfxIndex(
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildGfxIndexHalf(
		"gfxIndex.workspace",
		{ hoi4: false, recursively: true },
		workspaceGfxIndex,
		workspaceGfxFileToKeys,
		estimatedSize,
		progress,
	);
}

async function buildGfxIndexHalf(
	cacheName: string,
	options: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	targetIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	estimatedSize: [number],
	progress: IndexProgress,
): Promise<void> {
	await buildIndexHalf<GfxCacheData>(
		{
			cacheName,
			version: GFX_CACHE_VERSION,
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
			},
			parseFile: (file) =>
				fillGfxItems(file, targetIndex, fileToKeysMap, options, estimatedSize),
			serialize: () => ({
				index: targetIndex,
				fileToKeys: Object.fromEntries(fileToKeysMap ?? []),
			}),
		},
		progress,
	);
}

async function fillGfxItems(
	gfxFile: IndexFile,
	gfxIndex: Record<string, GfxIndexItem | undefined>,
	fileToKeysMap: Map<string, string[]> | null,
	options: { mod?: boolean; hoi4?: boolean },
	estimatedSize?: [number],
): Promise<void> {
	const filePath = gfxFile.path;
	if (estimatedSize) {
		// The path's length, not the file's, which is what this has always counted.
		estimatedSize[0] += filePath.length;
	}

	const fileBuffer = await readIndexFileContent("Gfx index", gfxFile, options);
	if (fileBuffer === undefined) {
		return;
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
	} catch (e) {
		// This used to go to the debug console wrapped in a UserError, so a malformed .gfx file
		// never showed up in the output channel where every other index reports.
		reportIndexParseFailure(filePath, options, e);
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
