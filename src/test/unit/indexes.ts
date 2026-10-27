import { mock } from "node:test";
import { posix } from "path";
import type * as vscode from "vscode";
import { contextContainer } from "../../context";
import { refreshFeatureFlags } from "../../util/featureflags";
import * as fileloader from "../../util/fileloader";
import { __resetIndexProgressForTests } from "../../util/indexBuild";
import * as indexCache from "../../util/indexCache";
import { clearParentModCache } from "../../util/parentmods";
import { settle } from "./async";
import { handOver } from "./host";

// What the gfx, shared focus, localisation and idea swap index tests share: an editor with one
// workspace folder at /ws, a file loader the test answers, and a disk cache held in memory.

/** The three halves an index builds, told apart by the source options each one passes. */
export type Half = "global" | "parent" | "workspace";

// Strict, so a half that stops passing its options cannot read another half's files.
function halfOf(options: fileloader.FileSourceOptions | undefined): Half {
	if (options?.mod === false) {
		return "global";
	}
	if (options?.workspace === false) {
		return "parent";
	}
	if (options?.parent === false) {
		return "workspace";
	}
	throw new Error(`no half lists or reads with ${JSON.stringify(options)}`);
}

class FakeDisposable {
	constructor(readonly dispose: () => unknown) {}
	static from(...items: { dispose(): unknown }[]): FakeDisposable {
		return new FakeDisposable(() => items.forEach((item) => item.dispose()));
	}
}

class FakeUri {
	readonly scheme = "file";
	constructor(readonly path: string) {}
	get fsPath(): string {
		return this.path;
	}
	toString(): string {
		return `file://${this.path}`;
	}
}

// Every world gets a storage root of its own, and its editor's sinks only file paths under that
// root: the cache scope a build captures carries the root down into every cache file URI, so a
// write whose URI belongs to a world that already ended has nowhere to go and is dropped, instead
// of landing in whatever world holds the editor when the write settles.
let nextStorageRoot = 0;

// The disk cache saves are what the builds fire-and-forget, so a test or the afterEach that must
// see a settled disk waits on the saves the mocks in useIndexWorld catch at their call instead of
// guessing how many scheduling rounds a write takes. What a completion queues next is picked up by
// the next round, and the round after every completion caught nothing.
const realSaveCacheRecords = indexCache.saveCacheRecords;
const realSaveCacheManifest = indexCache.saveCacheManifest;

async function drainCacheSaves(pending: Promise<unknown>[]): Promise<number> {
	let saved = 0;
	for (;;) {
		await settle();
		const inFlight = pending.splice(0, pending.length);
		if (inFlight.length === 0) {
			return saved;
		}
		saved += inFlight.length;
		await Promise.all(inFlight);
	}
}

/** A workspace file, named the way the editor names it in an event. */
export function workspaceFile(relativePath: string): vscode.Uri {
	return new FakeUri(posix.join("/ws", relativePath)) as unknown as vscode.Uri;
}

/** Listed names, dated the way a listing on a real disk dates them. */
export function listed(names: string[], mtime = 1): fileloader.ModOrHoi4FileEntry[] {
	return names.map((relativePath) => ({ relativePath, uri: undefined as unknown as vscode.Uri, mtime }));
}

export interface IndexWorld {
	/** The extension's settings. A test that changes them calls refreshFeatureFlags. */
	settings: Record<string, unknown>;
	/** Answers each listing of one root for one half. */
	list(root: string, half: Half): fileloader.ModOrHoi4FileEntry[];
	/** Answers each read of an indexed file. Throwing is a file that cannot be read. */
	read(relativePath: string, half: Half): Buffer | Promise<Buffer>;
	/** How many listings the builds asked for. */
	listings: number;
	/** How many file reads the builds and the event handlers asked for. */
	reads: number;
	/** Whether Cancel on the progress notification has been pressed. */
	cancelled: boolean;
	/** The cache files, by full path, once the test has given the indexes a disk with useDisk. */
	disk: Map<string, Uint8Array>;
	/** The storage root this world's cache URIs answer to; no two worlds share one. */
	storageRoot: string;
	useDisk(): void;
	/** Resolves once every cache save the builds have asked for is on the disk; returns how many. */
	drainCacheWrites(): Promise<number>;
	/** Where a cache file of this name sits in the cache directory the current settings pick. */
	cacheFile(name: string): string;
}

function editorFor(world: IndexWorld) {
	const disposable = () => ({ dispose: () => undefined });
	// The editor keeps the disk and root it was handed with, so a continuation that reaches it after
	// the world moved on still answers for its own world and no other.
	const storageRoot = world.storageRoot;
	const disk = world.disk;
	const underThisRoot = (path: string) => path === storageRoot || path.startsWith(`${storageRoot}/`);
	return {
		ProgressLocation: { Notification: 15 },
		Uri: {
			file: (path: string) => new FakeUri(path),
			joinPath: (base: FakeUri, ...parts: string[]) => new FakeUri(posix.join(base.path, ...parts)),
		},
		Disposable: FakeDisposable,
		workspace: {
			getConfiguration: () => world.settings,
			workspaceFolders: [{ uri: new FakeUri("/ws") }],
			getWorkspaceFolder: () => ({ uri: new FakeUri("/ws") }),
			textDocuments: [],
			onDidChangeWorkspaceFolders: disposable,
			onDidChangeTextDocument: disposable,
			onDidCloseTextDocument: disposable,
			onDidCreateFiles: disposable,
			onDidDeleteFiles: disposable,
			onDidRenameFiles: disposable,
			fs: {
				readDirectory: async () => [],
				createDirectory: async () => undefined,
				readFile: async (uri: FakeUri) => {
					const data = underThisRoot(uri.path) ? disk.get(uri.path) : undefined;
					if (!data) {
						throw new Error(`no such cache file: ${uri.path}`);
					}
					return data;
				},
				writeFile: async (uri: FakeUri, content: Uint8Array) => {
					if (underThisRoot(uri.path)) {
						disk.set(uri.path, content);
					}
				},
			},
		},
		window: {
			createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
			withProgress: (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
				task({ report: () => undefined }, { isCancellationRequested: world.cancelled }),
		},
	};
}

/**
 * Hands every test in the enclosing `describe` a fresh world with these settings, and empties the
 * index with `reset` before and after each one along with the state every index build reads: the
 * flags, the parent mod list and the shared progress notification.
 */
export function useIndexWorld(reset: () => void, settings: Record<string, unknown>): IndexWorld {
	const world = {} as IndexWorld;
	let pendingSaves: Promise<unknown>[] = [];

	beforeEach(() => {
		const storageRoot = `/storage/${++nextStorageRoot}`;
		const disk = new Map<string, Uint8Array>();
		pendingSaves = [];

		Object.assign(world, {
			settings: { ...settings },
			list: () => [],
			read: () => Buffer.alloc(0),
			listings: 0,
			reads: 0,
			cancelled: false,
			disk,
			storageRoot,
			useDisk: () => {
				contextContainer.current = {
					globalStorageUri: new FakeUri(storageRoot),
				} as unknown as vscode.ExtensionContext;
			},
			drainCacheWrites: () => drainCacheSaves(pendingSaves),
			cacheFile: (name) => {
				const dir = indexCache.captureCacheScope();
				if (!dir) {
					throw new Error("the test has no disk: call useDisk first");
				}
				return posix.join(dir.path, name);
			},
		} satisfies IndexWorld);

		handOver(editorFor(world) as never);
		// The saves pass straight through to the real writers; catching each call to the real save is
		// what makes drainCacheWrites exact.
		const trackSave = <T>(save: () => Promise<T>): Promise<T> => {
			const saved = save();
			pendingSaves.push(saved);
			return saved;
		};
		mock.method(
			indexCache,
			"saveCacheRecords",
			(indexName: string, records: readonly unknown[], scope?: indexCache.CacheScope) =>
				trackSave(() => realSaveCacheRecords(indexName, records, scope)),
		);
		mock.method(
			indexCache,
			"saveCacheManifest",
			(indexName: string, filePaths: string[], mtimes: Map<string, number>, version: number, scope?: indexCache.CacheScope) =>
				trackSave(() => realSaveCacheManifest(indexName, filePaths, mtimes, version, scope)),
		);
		mock.method(fileloader, "listFileEntriesFromModOrHOI4", async (root: string, options?: fileloader.FileSourceOptions) => {
			world.listings++;
			return world.list(root, halfOf(options));
		});
		mock.method(fileloader, "readFileFromModOrHOI4", async (relativePath: string, options?: fileloader.FileSourceOptions) => {
			world.reads++;
			return [await world.read(relativePath, halfOf(options)), new FakeUri(relativePath)];
		});
		refreshFeatureFlags();
		clearParentModCache();
		__resetIndexProgressForTests();
		reset();
	});

	afterEach(async () => {
		// A save scheduled by this test reaches the disk before anything resets.
		await drainCacheSaves(pendingSaves);
		reset();
		mock.restoreAll();
		contextContainer.current = null;
		// Back to the defaults, so a flag one test turned off is not off for the next file.
		world.settings = {};
		refreshFeatureFlags();
		clearParentModCache();
		__resetIndexProgressForTests();
	});

	return world;
}

/** Hands over the editor the next test would get: a fresh disk under a storage root of its own. */
export function handOverLaterWorldEditorFor(previous: IndexWorld): Map<string, Uint8Array> {
	const disk = new Map<string, Uint8Array>();
	handOver(editorFor({ ...previous, disk, storageRoot: `/storage/${++nextStorageRoot}` }) as never);
	return disk;
}
