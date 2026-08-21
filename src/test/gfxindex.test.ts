import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import {
	getGfxContainerFile,
	registerGfxIndex,
	__resetGfxIndexForTests,
	__testHandlers,
} from "../util/gfxindex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

type ListedEntry = {
	relativePath: string;
	uri: unknown;
	mtime: number | undefined;
};

type FileloaderModule = {
	listFileEntriesFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			recursively?: boolean;
			token?: unknown;
		},
	) => Promise<ListedEntry[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean },
	) => Promise<[Buffer, unknown]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

// A dated entry is what a listing on a real disk produces; leaving the mtime out would send
// listIndexFiles down its resolve-and-stat fallback and out to the unstubbed file system.
function toEntries(names: string[]): ListedEntry[] {
	return names.map((relativePath) => ({
		relativePath,
		uri: undefined,
		mtime: 1,
	}));
}


const GFX_FILE_CONTENT = Buffer.from(`spriteTypes = {
	spriteType = {
		name = "GFX_my_sprite"
		texturefile = "does-not-exist.dds"
	}
}`);

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
	let resolve: (v: T) => void = () => undefined;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

function gfxFileUri(relativePath: string): vscode.Uri {
	const fullPath = "/ws/" + relativePath;
	return {
		path: fullPath,
		scheme: "file",
		toString: () => "file://" + fullPath,
	} as unknown as vscode.Uri;
}

describe("util/gfxindex lazy build", function () {
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let listFilesCallCount: number;

	beforeEach(function () {
		__resetGfxIndexForTests();
		stubVscode({
			getConfiguration: () => ({ gfxIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		featureflags.refreshFeatureFlags();

		listFilesCallCount = 0;
		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;

		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = async () => {
			listFilesCallCount++;
			return toEntries(["sprite.gfx"]);
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [GFX_FILE_CONTENT, {} as unknown];
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = originalListFiles;
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = originalReadFile;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetGfxIndexForTests();
	});

	it("does no build work when registered", async function () {
		const disposable = registerGfxIndex();
		await waitForAsyncTasks();

		assert.strictEqual(listFilesCallCount, 0);
		disposable.dispose();
	});

	it("does no build work when the feature flag is off", async function () {
		stubVscode({ getConfiguration: () => ({ gfxIndex: false }) });
		featureflags.refreshFeatureFlags();

		const result = await getGfxContainerFile("GFX_my_sprite");

		assert.strictEqual(result, undefined);
		assert.strictEqual(listFilesCallCount, 0);
	});

	it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async function () {
		const [first, second] = await Promise.all([
			getGfxContainerFile("GFX_my_sprite"),
			getGfxContainerFile("GFX_my_sprite"),
		]);

		// One list call for the global build, one for the workspace build; a duplicate build would double these.
		assert.strictEqual(listFilesCallCount, 2);
		assert.strictEqual(first, "interface/sprite.gfx");
		assert.strictEqual(second, "interface/sprite.gfx");

		const third = await getGfxContainerFile("GFX_my_sprite");
		assert.strictEqual(third, "interface/sprite.gfx");
		assert.strictEqual(listFilesCallCount, 2);
	});

	describe("incremental events vs. an in-flight build", function () {
		// The global build passes { mod: false, ... }, the workspace build omits `mod`; route
		// "sprite.gfx" into the workspace build only, so getGfxContainerFile's fallback to the
		// global index can't mask a workspace-only mutation.
		beforeEach(function () {
			(
				fileloader as typeof fileloader & {
					listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
				}
			).listFileEntriesFromModOrHOI4 = async (_relativePath, options) => {
				listFilesCallCount++;
				return toEntries(options?.mod === false ? [] : ["sprite.gfx"]);
			};
		});

		it("ignores incremental events that arrive before any build has started", async function () {
			__testHandlers.onDeleteFiles({
				files: [gfxFileUri("interface/sprite.gfx")],
			});
			await waitForAsyncTasks();

			assert.strictEqual(listFilesCallCount, 0);

			const result = await getGfxContainerFile("GFX_my_sprite");
			assert.strictEqual(result, "interface/sprite.gfx");
		});

		it("defers an event that arrives while the build is pending, and applies it once the build settles", async function () {
			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			const lookup = getGfxContainerFile("GFX_my_sprite");
			await waitForAsyncTasks();

			// Fired while the build is still awaiting readFileFromModOrHOI4, before it has written
			// anything into the index.
			__testHandlers.onDeleteFiles({
				files: [gfxFileUri("interface/sprite.gfx")],
			});

			read.resolve([GFX_FILE_CONTENT, {} as unknown]);
			await lookup;
			await waitForAsyncTasks();

			const result = await getGfxContainerFile("GFX_my_sprite");
			assert.strictEqual(result, undefined);
		});

		it("applies an event immediately once the build has already settled", async function () {
			const primed = await getGfxContainerFile("GFX_my_sprite");
			assert.strictEqual(primed, "interface/sprite.gfx");

			__testHandlers.onDeleteFiles({
				files: [gfxFileUri("interface/sprite.gfx")],
			});

			const result = await getGfxContainerFile("GFX_my_sprite");
			assert.strictEqual(result, undefined);
		});
	});
});
