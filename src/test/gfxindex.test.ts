import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import {
	getGfxContainerFile,
	getGfxIndexVersion,
	getIndexedGfxNames,
	registerGfxIndex,
	__resetGfxIndexForTests,
	__testHandlers,
} from "../util/gfxindex";
import { clearParentModCache } from "../util/parentmods";
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
			workspace?: boolean;
			parent?: boolean;
			recursively?: boolean;
			token?: unknown;
		},
	) => Promise<ListedEntry[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			workspace?: boolean;
			parent?: boolean;
		},
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

	// Reading the names is how the technology preview finds out which countries ship their own icons:
	// it has to look at the whole namespace, not resolve a name it already knows.
	it("hands back the indexed sprite names, and nothing at all when the flag is off", async function () {
		assert.deepStrictEqual(await getIndexedGfxNames(), ["GFX_my_sprite"]);
		assert.strictEqual(listFilesCallCount, 2);

		stubVscode({ getConfiguration: () => ({ gfxIndex: false }) });
		featureflags.refreshFeatureFlags();

		assert.deepStrictEqual(await getIndexedGfxNames(), []);
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

	// The acceptance test for the Cancel button: stopping a build must leave nothing usable behind,
	// so the next lookup does the whole thing again instead of reading a half-filled index.
	it("rebuilds from scratch after a cancelled build rather than serving a partial index", async function () {
		stubVscode({
			getConfiguration: () => ({ gfxIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
			withProgress: (_options: unknown, task: any) =>
				task({ report: () => undefined }, { isCancellationRequested: true }),
		});
		featureflags.refreshFeatureFlags();

		// A lookup never throws at its caller, so a cancelled build simply finds nothing.
		assert.strictEqual(await getGfxContainerFile("GFX_my_sprite"), undefined);
		await waitForAsyncTasks();
		assert.strictEqual(listFilesCallCount, 2);

		// Back to a progress notification nobody cancels: the next lookup must list again.
		stubVscode({
			getConfiguration: () => ({ gfxIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
			withProgress: (_options: unknown, task: any) =>
				task({ report: () => undefined }, { isCancellationRequested: false }),
		});
		featureflags.refreshFeatureFlags();

		assert.strictEqual(
			await getGfxContainerFile("GFX_my_sprite"),
			"interface/sprite.gfx",
		);
		assert.strictEqual(listFilesCallCount, 4);
	});

	// The sprite namespace has no file to stat, so a cache built from it -- the technology preview's
	// country list -- watches this counter instead. It has to move for every mutation, or that cache
	// serves what it read before the edit forever.
	describe("version counter", function () {
		it("moves when the index is built and stands still for a lookup", async function () {
			const before = getGfxIndexVersion();

			assert.deepStrictEqual(await getIndexedGfxNames(), ["GFX_my_sprite"]);
			const afterBuild = getGfxIndexVersion();
			assert.ok(
				afterBuild > before,
				`expected the build to move the version, got ${before} -> ${afterBuild}`,
			);

			await getIndexedGfxNames();
			assert.strictEqual(getGfxIndexVersion(), afterBuild);
		});

		it("moves when a file's sprites are removed", async function () {
			await getIndexedGfxNames();
			const afterBuild = getGfxIndexVersion();

			__testHandlers.onDeleteFiles({
				files: [gfxFileUri("interface/sprite.gfx")],
			});
			await waitForAsyncTasks();

			// Both halves indexed the same file here, so the global copy of the name survives; what this
			// pins is that the workspace removal is announced at all.
			assert.ok(
				getGfxIndexVersion() > afterBuild,
				"expected a delete to move the version",
			);
		});

		it("moves when an edited file is re-indexed", async function () {
			await getIndexedGfxNames();
			const afterBuild = getGfxIndexVersion();

			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = async () => [
				Buffer.from(`spriteTypes = {
	spriteType = {
		name = "GFX_my_other_sprite"
		texturefile = "does-not-exist.dds"
	}
}`),
				{} as unknown,
			];

			__testHandlers.onCreateFiles({
				files: [gfxFileUri("interface/sprite.gfx")],
			});
			await waitForAsyncTasks();
			await waitForAsyncTasks();

			assert.ok(
				getGfxIndexVersion() > afterBuild,
				"expected a re-index to move the version",
			);
			assert.ok((await getIndexedGfxNames()).includes("GFX_my_other_sprite"));
		});
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

describe("owner-guarded removal with duplicate GFX names", function () {
	it("keeps the winner when the losing file is deleted", async function () {
		const origList = fileloader.listFileEntriesFromModOrHOI4;
		const origRead = fileloader.readFileFromModOrHOI4;
		const aContent = Buffer.from('spriteTypes = { spriteType = { name = "GFX_dup" texturefile = "a.dds" } }');
		const bContent = Buffer.from('spriteTypes = { spriteType = { name = "GFX_dup" texturefile = "b.dds" } }');
		const files = ["a.gfx", "b.gfx"];
		(fileloader as any).listFileEntriesFromModOrHOI4 = async (_p: string, opts: any) => {
			if (opts?.mod === false) {
				return toEntries([]);
			}
			return toEntries(files);
		};
		(fileloader as any).readFileFromModOrHOI4 = async (rel: string) => {
			if (rel.endsWith("a.gfx")) {
				return [aContent, {} as unknown];
			}
			return [bContent, {} as unknown];
		};
		try {
			__resetGfxIndexForTests();
			const first = await getGfxContainerFile("GFX_dup");
			assert.strictEqual(first, "interface/b.gfx");
			__testHandlers.onDeleteFiles({ files: [gfxFileUri("interface/a.gfx")] });
			await waitForAsyncTasks();
			const afterLosingDelete = await getGfxContainerFile("GFX_dup");
			assert.strictEqual(afterLosingDelete, "interface/b.gfx");
			__testHandlers.onDeleteFiles({ files: [gfxFileUri("interface/b.gfx")] });
			await waitForAsyncTasks();
			const afterWinnerDelete = await getGfxContainerFile("GFX_dup");
			assert.strictEqual(afterWinnerDelete, undefined);
		} finally {
			(fileloader as any).listFileEntriesFromModOrHOI4 = origList;
			(fileloader as any).readFileFromModOrHOI4 = origRead;
			__resetGfxIndexForTests();
		}
	});
});

// The parent mods are a half of their own. Inside one half the last file parsed wins, so a
// sprite the workspace redefines in a differently named .gfx than the parent's would resolve to
// whichever of the two the four-wide parse queue finished last. Across halves the order is fixed:
// workspace, parent, vanilla.
describe("parent mods", function () {
	function sprites(...names: string[]): Buffer {
		const types = names
			.map((name) => `spriteType = { name = "${name}" texturefile = "x.dds" }`)
			.join(" ");
		return Buffer.from(`spriteTypes = { ${types} }`);
	}

	const workspaceFiles: Record<string, Buffer> = {
		"interface/sub.gfx": sprites("GFX_shared", "GFX_sub_only"),
		"interface/override.gfx": sprites("GFX_override"),
	};
	const parentFiles: Record<string, Buffer> = {
		"interface/parent.gfx": sprites("GFX_shared", "GFX_parent_only"),
		"interface/override.gfx": sprites("GFX_override"),
	};

	let listedOptions: {
		mod?: boolean;
		workspace?: boolean;
		parent?: boolean;
	}[];
	let releaseParentReads: () => void;

	/** Which halves listed, by the options each one passes, in a fixed order. */
	function listedHalves(): string[] {
		return listedOptions
			.map((o) =>
				o.mod === false
					? "global"
					: o.workspace === false
						? "parent"
						: o.parent === false
							? "workspace"
							: "unexpected",
			)
			.sort();
	}

	beforeEach(function () {
		listedOptions = [];
		const parentReads = deferred<void>();
		releaseParentReads = () => parentReads.resolve(undefined);
		stubVscode({
			getConfiguration: () => ({
				gfxIndex: true,
				parentModPaths: ["D:/mods/parent"],
			}),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		(fileloader as any).listFileEntriesFromModOrHOI4 = async (
			_relativePath: string,
			options: { mod?: boolean; workspace?: boolean; parent?: boolean },
		) => {
			listedOptions.push({
				mod: options?.mod,
				workspace: options?.workspace,
				parent: options?.parent,
			});
			if (options?.mod === false) {
				return toEntries([]);
			}
			if (options?.workspace === false) {
				return toEntries(
					Object.keys(parentFiles).map((f) => f.replace("interface/", "")),
				);
			}
			return toEntries(
				Object.keys(workspaceFiles).map((f) => f.replace("interface/", "")),
			);
		};
		(fileloader as any).readFileFromModOrHOI4 = async (
			relativePath: string,
			options: { workspace?: boolean; parent?: boolean },
		) => {
			if (options?.workspace === false) {
				// The parent half parses last, on purpose: the order must not matter.
				await parentReads.promise;
				return [parentFiles[relativePath], {}];
			}
			const content = workspaceFiles[relativePath];
			if (content === undefined) {
				throw new Error(`no workspace file ${relativePath}`);
			}
			return [content, {}];
		};
	});

	afterEach(function () {
		restoreVscodeStubs();
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		__resetGfxIndexForTests();
	});

	it("lists the parents as a half of their own, and keeps them out of the workspace half", async function () {
		releaseParentReads();
		await getIndexedGfxNames();

		assert.deepStrictEqual(listedHalves(), ["global", "parent", "workspace"]);
	});

	it("resolves a sprite both define to the workspace's file, even when the parent parsed last", async function () {
		const lookup = getGfxContainerFile("GFX_shared");
		await waitForAsyncTasks();
		releaseParentReads();

		assert.strictEqual(await lookup, "interface/sub.gfx");
		assert.strictEqual(
			await getGfxContainerFile("GFX_parent_only"),
			"interface/parent.gfx",
		);
		assert.ok((await getIndexedGfxNames()).includes("GFX_parent_only"));
	});

	it("keeps the parent's copy when the workspace override of a file is deleted", async function () {
		releaseParentReads();
		assert.strictEqual(
			await getGfxContainerFile("GFX_override"),
			"interface/override.gfx",
		);

		__testHandlers.onDeleteFiles({
			files: [gfxFileUri("interface/override.gfx")],
		});
		await waitForAsyncTasks();

		assert.strictEqual(
			await getGfxContainerFile("GFX_override"),
			"interface/override.gfx",
		);

		// And a workspace-only file's sprites do go when it does.
		__testHandlers.onDeleteFiles({ files: [gfxFileUri("interface/sub.gfx")] });
		await waitForAsyncTasks();
		assert.strictEqual(await getGfxContainerFile("GFX_sub_only"), undefined);
		assert.strictEqual(
			await getGfxContainerFile("GFX_shared"),
			"interface/parent.gfx",
		);
	});

	it("rebuilds the parent half alone when the parent list changes", async function () {
		releaseParentReads();
		await getIndexedGfxNames();
		listedOptions = [];

		__testHandlers.onChangeParentMods({ folders: true, unresolved: false });
		await waitForAsyncTasks();
		await waitForAsyncTasks();

		assert.deepStrictEqual(listedHalves(), ["parent"]);
	});

	it("rebuilds nothing when only the unresolved dependency names change", async function () {
		releaseParentReads();
		await getIndexedGfxNames();
		listedOptions = [];

		__testHandlers.onChangeParentMods({ folders: false, unresolved: true });
		await waitForAsyncTasks();
		await waitForAsyncTasks();

		assert.deepStrictEqual(listedHalves(), []);
	});
});

});
