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
const FIRST_FILE = "first_l_english.yml";
const SECOND_FILE = "second_l_english.yml";
const FIRST_CONTENT = Buffer.from('l_english:\n DUPLICATE:0 "first"\n');
const SECOND_CONTENT = Buffer.from('l_english:\n DUPLICATE:0 "second"\n');
const WORKSPACE_FOLDER = {
	uri: { path: "/ws", scheme: "file", toString: () => "file:///ws" },
} as unknown as vscode.WorkspaceFolder;

function toEntries(names: string[]): ListedEntry[] {
	return names.map((relativePath) => ({
		relativePath,
		uri: undefined,
		mtime: 1,
	}));
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/localisationIndex duplicate cache invalidation", function () {
	let cacheStore: Map<string, Uint8Array>;
	let files: string[];
	let originalListFiles: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let originalContext: unknown;

	beforeEach(function () {
		__resetLocalisationIndexForTests();
		cacheStore = new Map();
		files = [FIRST_FILE, SECOND_FILE];
		originalContext = contextContainer.current;
		contextContainer.current = {
			globalStorageUri: vscode.Uri.file("storage"),
		} as unknown as vscode.ExtensionContext;

		stubVscode({
			getConfiguration: () => ({ localisationIndex: true, parentModPaths: [] }),
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
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = async (_relativePath, options) => {
			if (options?.mod) {
				return toEntries(files);
			}
			return [];
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async (relativePath: string) => {
			if (relativePath.endsWith(FIRST_FILE)) {
				return [FIRST_CONTENT, {} as unknown];
			}
			return [SECOND_CONTENT, {} as unknown];
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

	async function waitForWorkspaceCache(): Promise<void> {
		for (let i = 0; i < 100; i++) {
			const paths = [...cacheStore.keys()];
			if (
				paths.some((path) =>
					path.endsWith("localisationIndex.workspace.data.json"),
				) &&
				paths.some((path) =>
					path.endsWith("localisationIndex.workspace.manifest.json"),
				)
			) {
				return;
			}
			await waitForAsyncTasks();
		}
		throw new Error("localisationIndex.workspace cache was never written");
	}

	it("rebuilds all current files when a duplicate-key owner is removed", async function () {
		assert.strictEqual(await getLocalisedText("DUPLICATE", "en"), "second");
		await waitForWorkspaceCache();

		files = [FIRST_FILE];
		__resetLocalisationIndexForTests();
		clearParentModCache();
		featureflags.refreshFeatureFlags();

		assert.strictEqual(await getLocalisedText("DUPLICATE", "en"), "first");
	});
});
