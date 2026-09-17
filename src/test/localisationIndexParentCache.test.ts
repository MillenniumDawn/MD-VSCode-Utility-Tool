import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import { contextContainer } from "../context";
import {
	getLocalisedText,
	__resetLocalisationIndexForTests,
} from "../util/localisationIndex";
import { clearParentModCache } from "../util/parentmods";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// Regression for the warm parent-localisation cache: the parent half used to cache without its
// per-file key map, so a warm build's hydrate had nothing to restore from. It restored no
// parent keys and parsed no fresh files, leaving the parent half empty after every reload.

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

function toEntries(names: string[]): ListedEntry[] {
	return names.map((relativePath) => ({
		relativePath,
		uri: undefined,
		mtime: 1,
	}));
}

const GLOBAL_FILE = "global_l_english.yml";
const GLOBAL_CONTENT = Buffer.from(
	'l_english:\n GLOBAL_ONLY:0 "global only"\n',
);
const PARENT_FILE = "parent_l_english.yml";
const PARENT_CONTENT = Buffer.from(
	'l_english:\n PARENT_ONLY:0 "parent only"\n',
);

const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/localisationIndex warm parent cache", function () {
	// The cache written by the first build, held in memory so the second build can read it back
	// exactly as it would from globalStorage on disk.
	let cacheStore: Map<string, Uint8Array>;
	let globalFileReads: number;
	let parentFileReads: number;
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let originalContext: unknown;

	beforeEach(function () {
		__resetLocalisationIndexForTests();
		cacheStore = new Map();
		globalFileReads = 0;
		parentFileReads = 0;

		originalContext = contextContainer.current;
		contextContainer.current = {
			globalStorageUri: vscode.Uri.file("storage"),
		} as unknown as vscode.ExtensionContext;

		stubVscode({
			getConfiguration: () => ({
				localisationIndex: true,
				parentModPaths: ["D:/mods/parent"],
			}),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
			writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
				cacheStore.set(uri.path, content);
			},
			readFile: async (uri: vscode.Uri) => {
				const data = cacheStore.get(uri.path);
				if (!data) {
					throw new Error(`no such cache file: ${uri.path}`);
				}
				return data;
			},
		});
		clearParentModCache();
		featureflags.refreshFeatureFlags();

		originalListFiles = fileloader.listFileEntriesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;

		// The global and parent halves list one file each; the workspace half lists nothing.
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = async (_relativePath, options) => {
			if (options?.hoi4) {
				return toEntries([GLOBAL_FILE]);
			}
			if (options?.mod) {
				return [];
			}
			if (options?.workspace === false) {
				return toEntries([PARENT_FILE]);
			}
			return [];
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async (relativePath: string) => {
			if (relativePath.endsWith(GLOBAL_FILE)) {
				globalFileReads++;
				return [GLOBAL_CONTENT, {} as unknown];
			}
			if (relativePath.endsWith(PARENT_FILE)) {
				parentFileReads++;
				return [PARENT_CONTENT, {} as unknown];
			}
			return [Buffer.from(""), {} as unknown];
		};
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
		contextContainer.current =
			originalContext as vscode.ExtensionContext | null;
		restoreVscodeStubs();
		clearParentModCache();
		featureflags.refreshFeatureFlags();
		__resetLocalisationIndexForTests();
	});

	// The cache writes are fire-and-forget behind the build promise, so the second build must
	// wait until the parent half's data file has actually landed in the store.
	async function waitForCacheData(cacheName: string): Promise<void> {
		for (let i = 0; i < 100; i++) {
			if (
				[...cacheStore.keys()].some((path) =>
					path.endsWith(`${cacheName}.data.json`),
				)
			) {
				return;
			}
			await waitForAsyncTasks();
		}
		throw new Error(`${cacheName} data cache was never written`);
	}

	function parentCacheData(): {
		index: Record<string, Record<string, string>>;
		fileMap: Record<string, Record<string, string[]>>;
	} {
		const dataPath = [...cacheStore.keys()].find((path) =>
			path.endsWith("localisationIndex.parent.0.data.json"),
		);
		assert.ok(
			dataPath,
			"localisationIndex.parent.0 data cache was never written",
		);
		return JSON.parse(Buffer.from(cacheStore.get(dataPath)!).toString());
	}

	it("cold build parses the parent file and saves its key with fileMap data", async function () {
		assert.strictEqual(
			await getLocalisedText("PARENT_ONLY", "en"),
			"parent only",
		);
		assert.strictEqual(parentFileReads, 1);
		await waitForCacheData("localisationIndex.parent.0");

		const cached = parentCacheData();
		assert.strictEqual(cached.index.l_english.PARENT_ONLY, "parent only");
		// The listing path carries the localisation root, so match on the keys the file owns
		// rather than on the listing's bare name.
		const cachedKeys = Object.values(cached.fileMap.l_english ?? {}).flat();
		assert.deepStrictEqual(cachedKeys, ["PARENT_ONLY"]);
	});

	it("warm build serves a global key from the cache without re-reading the global file", async function () {
		assert.strictEqual(
			await getLocalisedText("GLOBAL_ONLY", "en"),
			"global only",
		);
		assert.strictEqual(globalFileReads, 1);
		await waitForCacheData("localisationIndex.global");

		__resetLocalisationIndexForTests();
		clearParentModCache();
		featureflags.refreshFeatureFlags();

		assert.strictEqual(
			await getLocalisedText("GLOBAL_ONLY", "en"),
			"global only",
		);
		assert.strictEqual(globalFileReads, 1);
	});

	it("warm build serves the parent key from the cache without re-reading the parent file", async function () {
		assert.strictEqual(
			await getLocalisedText("PARENT_ONLY", "en"),
			"parent only",
		);
		await waitForCacheData("localisationIndex.parent.0");

		__resetLocalisationIndexForTests();
		clearParentModCache();
		featureflags.refreshFeatureFlags();

		assert.strictEqual(
			await getLocalisedText("PARENT_ONLY", "en"),
			"parent only",
		);
		// The whole point of the cache: the parent file was parsed by the cold build only.
		assert.strictEqual(parentFileReads, 1);
	});
});
