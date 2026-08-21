import * as assert from "assert";
import * as vscode from "vscode";
import { CancelledError } from "../util/common";
import { listIndexFiles, toIndexFiles } from "../util/indexListing";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

type FileloaderModule = {
	listFileEntriesFromModOrHOI4: (
		relativePath: string,
		options?: {
			mod?: boolean;
			hoi4?: boolean;
			recursively?: boolean;
			token?: unknown;
		},
	) => Promise<{ relativePath: string; uri: unknown; mtime: number | undefined }[]>;
	getFilePathFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean },
	) => Promise<unknown>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

function uriOf(name: string): vscode.Uri {
	return { toString: () => "file:///" + name } as unknown as vscode.Uri;
}

function entry(relativePath: string, mtime = 7) {
	return { relativePath, uri: uriOf(relativePath), mtime };
}

/** What a listing returns for a file it could not date: the web build, or a remote install path. */
function undatedEntry(relativePath: string) {
	return {
		relativePath,
		uri: uriOf(relativePath),
		mtime: undefined as number | undefined,
	};
}

describe("util/indexListing listIndexFiles", function () {
	let originalListEntries: FileloaderModule["listFileEntriesFromModOrHOI4"];
	let originalGetFilePath: FileloaderModule["getFilePathFromModOrHOI4"];

	function stubEntries(
		impl: FileloaderModule["listFileEntriesFromModOrHOI4"],
	): void {
		(
			fileloader as typeof fileloader & {
				listFileEntriesFromModOrHOI4: FileloaderModule["listFileEntriesFromModOrHOI4"];
			}
		).listFileEntriesFromModOrHOI4 = impl;
	}

	beforeEach(function () {
		stubVscode({ configuration: {} });
		originalListEntries = fileloader.listFileEntriesFromModOrHOI4;
		originalGetFilePath = fileloader.getFilePathFromModOrHOI4;
	});

	afterEach(function () {
		stubEntries(originalListEntries);
		(
			fileloader as typeof fileloader & {
				getFilePathFromModOrHOI4: FileloaderModule["getFilePathFromModOrHOI4"];
			}
		).getFilePathFromModOrHOI4 = originalGetFilePath;
		restoreVscodeStubs();
	});

	it("prefixes every name with the root it came from", async function () {
		stubEntries(async () => [entry("a.txt"), entry("sub/b.txt")]);

		const listing = await listIndexFiles({ roots: ["common"], options: {} });

		assert.deepStrictEqual(listing.filePaths, ["common/a.txt", "common/sub/b.txt"]);
		assert.strictEqual(
			listing.uris.get("common/sub/b.txt")!.toString(),
			"file:///sub/b.txt",
		);
		assert.strictEqual(listing.mtimes.get("common/a.txt"), 7);
	});

	it("filters on the bare name, before the prefix goes on", async function () {
		const seen: string[] = [];
		stubEntries(async () => [entry("keep.txt"), entry("drop.gfx")]);

		const listing = await listIndexFiles({
			roots: ["common"],
			filter: (name) => {
				seen.push(name);
				return name.endsWith(".txt");
			},
			options: {},
		});

		// A filter that saw "common/keep.txt" would break every caller's extension test.
		assert.deepStrictEqual(seen, ["keep.txt", "drop.gfx"]);
		assert.deepStrictEqual(listing.filePaths, ["common/keep.txt"]);
	});

	it("keeps the roots in the order they were given", async function () {
		stubEntries(async (root) => [entry(`${root}-file.txt`)]);

		const listing = await listIndexFiles({
			roots: ["common", "events"],
			options: {},
		});

		assert.deepStrictEqual(listing.filePaths, [
			"common/common-file.txt",
			"events/events-file.txt",
		]);
	});

	it("passes the options straight through, missing keys and all", async function () {
		const seen: unknown[] = [];
		stubEntries(async (_root, options) => {
			seen.push(options);
			return [];
		});

		await listIndexFiles({
			roots: ["interface"],
			options: { mod: false, recursively: true },
		});

		// gfxIndex's global half has no `hoi4` key at all, and adding one would move it to a different
		// getFilePathFromModOrHOI4 memo slot than every other caller for the same file.
		assert.deepStrictEqual(seen, [{ mod: false, recursively: true }]);
	});

	it("fails the listing when a root cannot be listed", async function () {
		stubEntries(async () => {
			throw new Error("listing failed intentionally");
		});

		await assert.rejects(
			() => listIndexFiles({ roots: ["common"], options: {} }),
			/listing failed intentionally/,
		);
	});

	it("treats an unlistable root as empty when asked to tolerate that", async function () {
		stubEntries(async (root) => {
			if (root === "events") {
				throw new Error("no such folder");
			}
			return [entry("a.txt")];
		});

		const listing = await listIndexFiles({
			roots: ["common", "events"],
			options: {},
			tolerateRootErrors: true,
		});

		assert.deepStrictEqual(listing.filePaths, ["common/a.txt"]);
	});

	it("still propagates a cancellation through tolerateRootErrors", async function () {
		stubEntries(async () => {
			throw new CancelledError();
		});

		// Swallowing this would leave the build to write an empty listing to its cache manifest, and
		// every file it never reached would come back as deleted.
		await assert.rejects(
			() =>
				listIndexFiles({
					roots: ["common"],
					options: {},
					tolerateRootErrors: true,
				}),
			CancelledError,
		);
	});

	it("never resolves a path when every entry came back dated", async function () {
		let resolveCalls = 0;
		(
			fileloader as typeof fileloader & {
				getFilePathFromModOrHOI4: FileloaderModule["getFilePathFromModOrHOI4"];
			}
		).getFilePathFromModOrHOI4 = async () => {
			resolveCalls++;
			return undefined;
		};
		stubEntries(async () => [entry("a.txt"), entry("b.txt")]);

		await listIndexFiles({ roots: ["common"], options: {} });

		// This is the whole point of the stage: on a desktop install the second pass does not happen.
		assert.strictEqual(resolveCalls, 0);
	});

	it("falls back to resolving and stat'ing the entries a listing could not date", async function () {
		const resolved: string[] = [];
		(
			fileloader as typeof fileloader & {
				getFilePathFromModOrHOI4: FileloaderModule["getFilePathFromModOrHOI4"];
			}
		).getFilePathFromModOrHOI4 = async (relativePath) => {
			resolved.push(relativePath);
			return relativePath === "common/gone.txt"
				? undefined
				: ({ toString: () => relativePath } as unknown);
		};
		stubVscode({
			stat: async () => ({
				type: vscode.FileType.File,
				mtime: 4242,
				ctime: 0,
				size: 0,
			}),
		});
		stubEntries(async () => [
			entry("dated.txt", 7),
			undatedEntry("undated.txt"),
			undatedEntry("gone.txt"),
		]);

		const listing = await listIndexFiles({ roots: ["common"], options: {} });

		assert.deepStrictEqual(resolved.sort(), [
			"common/gone.txt",
			"common/undated.txt",
		]);
		assert.strictEqual(listing.mtimes.get("common/dated.txt"), 7);
		assert.strictEqual(listing.mtimes.get("common/undated.txt"), 4242);
		// Still absent, not zero: computeStaleFiles reads an absent mtime as a file that is gone.
		assert.strictEqual(listing.mtimes.has("common/gone.txt"), false);
		// It is still listed, though, so the manifest records it the way it always did.
		assert.ok(listing.filePaths.includes("common/gone.txt"));
	});
});

describe("util/indexListing toIndexFiles", function () {
	it("pairs each path with the URI its listing found", function () {
		const uris = new Map([["a.txt", uriOf("a.txt")]]);

		assert.deepStrictEqual(
			toIndexFiles(["a.txt", "b.txt"], uris).map((f) => [
				f.path,
				f.uri?.toString(),
			]),
			[
				["a.txt", "file:///a.txt"],
				["b.txt", undefined],
			],
		);
	});
});
