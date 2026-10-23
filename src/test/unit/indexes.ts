import { mock } from "node:test";
import { posix } from "path";
import type * as vscode from "vscode";
import { contextContainer } from "../../context";
import { refreshFeatureFlags } from "../../util/featureflags";
import * as fileloader from "../../util/fileloader";
import { __resetIndexProgressForTests } from "../../util/indexBuild";
import { clearParentModCache } from "../../util/parentmods";
import { handOver } from "./host";

// What the gfx, shared focus, localisation and idea swap index tests share: an editor with one
// workspace folder at /ws, a file loader the test answers, and a disk cache held in memory.

/** The three halves an index builds, told apart by the source options each one passes. */
export type Half = "global" | "parent" | "workspace";

function halfOf(options: fileloader.FileSourceOptions | undefined): Half {
	return options?.mod === false ? "global" : options?.workspace === false ? "parent" : "workspace";
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
	with(change: { path?: string }): FakeUri {
		return new FakeUri(change.path ?? this.path);
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
	/** Whether Cancel on the progress notification has been pressed. */
	cancelled: boolean;
	/** The cache files, by name, once the test has given the indexes a disk with useDisk. */
	disk: Map<string, Uint8Array>;
	useDisk(): void;
}

function editorFor(world: IndexWorld) {
	const disposable = () => ({ dispose: () => undefined });
	return {
		ProgressLocation: { Notification: 15 },
		FileType: { File: 1, Directory: 2 },
		Uri: {
			file: (path: string) => new FakeUri(path),
			parse: (text: string) => new FakeUri(text.replace(/^file:\/\//, "")),
			joinPath: (base: FakeUri, ...parts: string[]) => new FakeUri(posix.join(base.path, ...parts)),
		},
		Disposable: FakeDisposable,
		workspace: {
			getConfiguration: () => world.settings,
			workspaceFolders: [{ uri: new FakeUri("/ws") }],
			getWorkspaceFolder: () => ({ uri: new FakeUri("/ws") }),
			textDocuments: [],
			onDidChangeConfiguration: disposable,
			onDidChangeWorkspaceFolders: disposable,
			onDidChangeTextDocument: disposable,
			onDidCloseTextDocument: disposable,
			onDidCreateFiles: disposable,
			onDidDeleteFiles: disposable,
			onDidRenameFiles: disposable,
			fs: {
				stat: async () => ({ type: 1, mtime: 0, ctime: 0, size: 0 }),
				readDirectory: async () => [],
				createDirectory: async () => undefined,
				delete: async () => undefined,
				readFile: async (uri: FakeUri) => {
					const data = world.disk.get(posix.basename(uri.path));
					if (!data) {
						throw new Error(`no such cache file: ${uri.path}`);
					}
					return data;
				},
				writeFile: async (uri: FakeUri, content: Uint8Array) => {
					world.disk.set(posix.basename(uri.path), content);
				},
			},
		},
		window: {
			createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
			showErrorMessage: async () => undefined,
			showWarningMessage: async () => undefined,
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
			cancelled: false,
			disk: new Map(),
			useDisk: () => {
				contextContainer.current = {
					globalStorageUri: new FakeUri("/storage"),
				} as unknown as vscode.ExtensionContext;
			},
		} satisfies IndexWorld);

		handOver(editorFor(world) as never);
		mock.method(fileloader, "listFileEntriesFromModOrHOI4", async (root: string, options?: fileloader.FileSourceOptions) => {
			world.listings++;
			return world.list(root, halfOf(options));
		});
		mock.method(fileloader, "readFileFromModOrHOI4", async (relativePath: string, options?: fileloader.FileSourceOptions) => [
			await world.read(relativePath, halfOf(options)),
			new FakeUri(relativePath),
		]);
		refreshFeatureFlags();
		clearParentModCache();
		__resetIndexProgressForTests();
		reset();
	});

	afterEach(() => {
		reset();
		mock.restoreAll();
		contextContainer.current = null;
		clearParentModCache();
		__resetIndexProgressForTests();
	});

	return world;
}
