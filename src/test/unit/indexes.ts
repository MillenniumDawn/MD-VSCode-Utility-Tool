import { mock } from "node:test";
import { posix } from "path";
import type * as vscode from "vscode";
import { contextContainer } from "../../context";
import { refreshFeatureFlags } from "../../util/featureflags";
import * as fileloader from "../../util/fileloader";
import { __resetIndexProgressForTests } from "../../util/indexBuild";
import { captureCacheScope } from "../../util/indexCache";
import { clearParentModCache } from "../../util/parentmods";
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
	useDisk(): void;
	/** Where a cache file of this name sits in the cache directory the current settings pick. */
	cacheFile(name: string): string;
}

function editorFor(world: IndexWorld) {
	const disposable = () => ({ dispose: () => undefined });
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
					const data = world.disk.get(uri.path);
					if (!data) {
						throw new Error(`no such cache file: ${uri.path}`);
					}
					return data;
				},
				writeFile: async (uri: FakeUri, content: Uint8Array) => {
					world.disk.set(uri.path, content);
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

	beforeEach(() => {
		Object.assign(world, {
			settings: { ...settings },
			list: () => [],
			read: () => Buffer.alloc(0),
			listings: 0,
			reads: 0,
			cancelled: false,
			disk: new Map(),
			useDisk: () => {
				contextContainer.current = {
					globalStorageUri: new FakeUri("/storage"),
				} as unknown as vscode.ExtensionContext;
			},
			cacheFile: (name) => {
				const dir = captureCacheScope();
				if (!dir) {
					throw new Error("the test has no disk: call useDisk first");
				}
				return posix.join(dir.path, name);
			},
		} satisfies IndexWorld);

		handOver(editorFor(world) as never);
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

	afterEach(() => {
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
