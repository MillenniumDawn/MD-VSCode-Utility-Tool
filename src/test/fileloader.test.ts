import * as assert from "assert";
import * as vscode from "vscode";
import {
	expiryToken,
	DlcZip,
	getFilePathFromModOrHOI4,
	listFilesFromModOrHOI4,
	listFileEntriesFromModOrHOI4,
	clearDlcZipCache,
	parseHoi4FileCached,
	parseAndResolveHoi4FileCached,
} from "../util/fileloader";
import { CancelledError } from "../util/common";
import { Node, SymbolNode } from "../hoiformat/hoiparser";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

// EXPIRY_STAT_TTL in fileloader.ts is 500ms; tests advance the stubbed clock past that.
const TTL = 500;

// The on-disk expiry-token branch stats the file (via getLastModifiedAsync). We replace the
// stub's fs.stat so we can count calls and vary the reported mtime, and we drive Date.now so the
// memo's TTL boundary is deterministic. Opened/dirty documents must never reach the stat, so the
// stat call count is also our proof that they bypass the memo.
describe("util/fileloader expiryToken", function () {
	let statCalls = 0;
	let mtime = 0;

	beforeEach(function () {
		statCalls = 0;
		mtime = 111;
		stubVscode({
			stat: async () => {
				statCalls++;
				return { type: vscode.FileType.File, mtime, ctime: 0, size: 0 };
			},
		});
	});

	afterEach(function () {
		restoreVscodeStubs();
	});

	function onDiskUri(str: string): vscode.Uri {
		return {
			fragment: "",
			path: "/f.txt",
			scheme: "file",
			toString: () => str,
		} as unknown as vscode.Uri;
	}
	function openedUri(str: string): vscode.Uri {
		return {
			fragment: ":opened",
			path: "/f.txt",
			scheme: "file",
			toString: () => str,
		} as unknown as vscode.Uri;
	}

	it("returns an empty string for an undefined path", async function () {
		assert.strictEqual(await expiryToken(undefined), "");
	});

	it("memoizes the on-disk stat within the TTL and recomputes after it", async function () {
		stubVscode({ now: () => 1000 });
		const uri = onDiskUri("file:///disk-a.txt");

		const t1 = await expiryToken(uri);
		const t2 = await expiryToken(uri);

		assert.strictEqual(t1, "file:///disk-a.txt@111");
		assert.strictEqual(t2, t1);
		assert.strictEqual(statCalls, 1); // second call served from the memo

		stubVscode({ now: () => 1000 + TTL + 1 });
		mtime = 222;
		const t3 = await expiryToken(uri);

		assert.strictEqual(t3, "file:///disk-a.txt@222");
		assert.strictEqual(statCalls, 2); // past the TTL it re-stats
	});

	it("always returns a fresh token for opened/dirty documents and never stats them", async function () {
		let clock = 5000;
		stubVscode({ now: () => clock });
		const uri = openedUri("file:///doc.txt#opened");

		const a = await expiryToken(uri);
		clock = 5001;
		const b = await expiryToken(uri);

		assert.strictEqual(a, "file:///doc.txt#opened@5000");
		assert.strictEqual(b, "file:///doc.txt#opened@5001");
		assert.notStrictEqual(a, b); // the dirty-doc branch is never memoized
		assert.strictEqual(statCalls, 0); // and never touches the stat memo
	});
});

// getFilePathFromModOrHOI4 resolves a relative path against the workspace/HOI4/DLCs with several
// fs.stats per call; a render hits the same paths hundreds of times. A 500ms memo collapses those.
// A workspace folder whose files all exist means one stat resolves the path, so the stat count is
// our proof the resolution ran once within the TTL and again after it. Mirrors the getLastModifiedMemo test above.
describe("util/fileloader getFilePathFromModOrHOI4", function () {
	let statCalls = 0;

	beforeEach(function () {
		statCalls = 0;
		stubVscode({
			stat: async () => {
				statCalls++;
				return { type: vscode.FileType.File, mtime: 0, ctime: 0, size: 0 };
			},
			workspaceFolders: [
				{
					uri: {
						fsPath: "/ws",
						path: "/ws",
						scheme: "file",
						toString: () => "file:///ws",
					},
				},
			],
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache(); // drop the path memo so it doesn't leak into other tests
	});

	it("resolves once within the TTL and re-resolves after it expires", async function () {
		stubVscode({ now: () => 2000 });
		const first = await getFilePathFromModOrHOI4("common/foo.txt");
		const second = await getFilePathFromModOrHOI4("common/foo.txt");

		assert.strictEqual(first!.toString(), "file:///ws/common/foo.txt");
		assert.strictEqual(second!.toString(), first!.toString());
		assert.strictEqual(statCalls, 1); // second resolution served from the memo

		stubVscode({ now: () => 2000 + TTL + 1 });
		const third = await getFilePathFromModOrHOI4("common/foo.txt");

		assert.strictEqual(third!.toString(), first!.toString());
		assert.strictEqual(statCalls, 2); // past the TTL it re-resolves
	});

	it("returns undefined without touching disk when cache key options are malformed", async function () {
		const malformed = await getFilePathFromModOrHOI4("common/foo.txt", {
			mod: "bad" as unknown as boolean,
		});

		assert.strictEqual(malformed, undefined);
		assert.strictEqual(statCalls, 0);
	});
});

describe("util/fileloader listFilesFromModOrHOI4 cache key parsing", function () {
	let statCalls = 0;

	beforeEach(function () {
		statCalls = 0;
		stubVscode({
			stat: async () => {
				statCalls++;
				return {
					type: vscode.FileType.Directory,
					mtime: 0,
					ctime: 0,
					size: 0,
				};
			},
		});
	});

	afterEach(function () {
		restoreVscodeStubs();
	});

	it("returns [] without touching disk for malformed list cache options", async function () {
		const files = await listFilesFromModOrHOI4("interface", {
			mod: "bad" as unknown as boolean,
			recursively: true,
		});

		assert.deepStrictEqual(files, []);
		assert.strictEqual(statCalls, 0);
	});
});

// The DLC-zip wrapper indexes a zip's central directory once and answers lookups/listings from
// those maps. These tests pin the normalization it must preserve from the old getEntry/getEntries
// code: exact-name lookup, leading slash/backslash stripping, and skipping directory entries.
describe("util/fileloader DlcZip", function () {
	const AdmZip = require("adm-zip");

	function makeZip(): DlcZip {
		const zip = new AdmZip();
		zip.addFile("gfx/interface/foo.dds", Buffer.from("foo"));
		zip.addFile("gfx/interface/bar.dds", Buffer.from("bar"));
		zip.addFile("/gfx/interface/slashfront.dds", Buffer.from("s")); // leading slash
		zip.addFile("\\gfx/interface/backfront.dds", Buffer.from("b")); // leading backslash
		zip.addFile("gfx/other.dds", Buffer.from("o"));
		zip.addFile("gfx/interface/", Buffer.alloc(0)); // directory entry
		return new DlcZip(() => zip);
	}

	it("looks up an entry by its exact name and returns null otherwise", function () {
		const dlcZip = makeZip();
		assert.strictEqual(
			dlcZip.getEntry("gfx/interface/foo.dds")!.isDirectory,
			false,
		);
		assert.strictEqual(dlcZip.getEntry("gfx/interface/missing.dds"), null);
	});

	it("reopens the archive per read and resolves an entry's data via getDataAsync", async function () {
		const fakeEntry = {
			getDataAsync: (cb: (data: Buffer) => void) => cb(Buffer.from("payload")),
		};
		let opens = 0;
		const dlcZip = new DlcZip(() => {
			opens++;
			return {
				getEntry: (name: string) => (name === "a/b.dds" ? fakeEntry : null),
			} as any;
		});

		assert.strictEqual(
			(await dlcZip.readEntryData("a/b.dds"))!.toString(),
			"payload",
		);
		assert.strictEqual(await dlcZip.readEntryData("a/missing.dds"), null);
		assert.strictEqual(opens, 2); // reopened per read, retaining no buffer
	});

	it("reports a directory entry via isDirectory (the listing guard relies on it)", function () {
		const dir = makeZip().getEntry("gfx/interface/");
		assert.ok(dir);
		assert.strictEqual(dir!.isDirectory, true);
	});

	it("lists file basenames in a directory, stripping leading slash/backslash and skipping directories", function () {
		assert.deepStrictEqual(makeZip().listDir("gfx/interface/").sort(), [
			"backfront.dds",
			"bar.dds",
			"foo.dds",
			"slashfront.dds",
		]);
	});

	it("resolves the query path so a trailing slash lists the same directory", function () {
		const dlcZip = makeZip();
		const expected = ["backfront.dds", "bar.dds", "foo.dds", "slashfront.dds"];
		assert.deepStrictEqual(dlcZip.listDir("gfx/interface").sort(), expected);
		assert.deepStrictEqual(dlcZip.listDir("gfx/interface/").sort(), expected);
	});
});

// The parse cache stores the tokenized Node tree so unchanged files aren't re-parsed every render.
// A workspace file (fs.stat says File, no matching open document) is on-disk, so it caches; we stub
// fs.readFile to count reads and return content, and fix Date.now so the cache serves within its
// nonExpireLife window.
describe("util/fileloader parseHoi4FileCached", function () {
	let readCalls = 0;
	let content = "";

	beforeEach(function () {
		readCalls = 0;
		content = 'a = 1\nb = "two"';
		stubVscode({
			now: () => 4000,
			stat: async () => ({
				type: vscode.FileType.File,
				mtime: 111,
				ctime: 0,
				size: 0,
			}),
			readFile: async () => {
				readCalls++;
				return Buffer.from(content);
			},
			workspaceFolders: [
				{
					uri: {
						fsPath: "/ws",
						path: "/ws",
						scheme: "file",
						toString: () => "file:///ws",
					},
				},
			],
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache(); // drop the parse/content/path caches so entries don't leak between tests
	});

	function child(node: Node, name: string): Node {
		const found = (node.value as Node[]).find((n) => n.name === name);
		assert.ok(found, `expected a child named ${name}`);
		return found!;
	}

	it("parses an unchanged file once across repeated calls (shared cached tree)", async function () {
		const first = await parseHoi4FileCached("common/pc-a.txt");
		const second = await parseHoi4FileCached("common/pc-a.txt");

		assert.strictEqual(second, first); // same Node instance => parsed once, not re-tokenized
		assert.strictEqual(readCalls, 1); // and the buffer was read once
		assert.strictEqual(child(first, "a").value, 1);
	});

	it("keys the options variant separately from the default parse", async function () {
		const withTokens = await parseHoi4FileCached("common/pc-b.txt");
		const withoutTokens = await parseHoi4FileCached("common/pc-b.txt", {
			keepTokens: false,
		});

		assert.notStrictEqual(withoutTokens, withTokens); // distinct cache entries
		assert.notStrictEqual(child(withTokens, "a").nameToken, null); // default keeps position tokens
		assert.strictEqual(child(withoutTokens, "a").nameToken, null); // keepTokens:false dropped them
	});

	it("resolves script variables without corrupting the plain cache entry", async function () {
		content = "@A = 5\nx = @A";

		const plain = await parseHoi4FileCached("common/pc-c.txt");
		const resolved = await parseAndResolveHoi4FileCached("common/pc-c.txt");

		assert.notStrictEqual(resolved, plain); // resolved variant is its own entry
		assert.strictEqual(child(resolved, "x").value, 5); // @A substituted in the resolved tree
		assert.strictEqual((child(plain, "x").value as SymbolNode).name, "@A"); // plain tree still holds the symbol

		const plainAgain = await parseHoi4FileCached("common/pc-c.txt");
		assert.strictEqual(plainAgain, plain); // same cached instance, untouched by the resolve pass
		assert.strictEqual((child(plainAgain, "x").value as SymbolNode).name, "@A");
	});
});

// Mirrors the folder layout of a current Steam install: the four integrated DLCs live under
// integrated_dlc/, everything else under dlc/, and dlc023_man_the_guns exists in *both* roots --
// as an empty leftover folder under dlc/ and with its actual content under integrated_dlc/. That
// duplicate is the case worth pinning: base dlc is walked first, so a scan that stops at the first
// matching folder name (rather than the first matching file) would resolve Man the Guns content to
// the empty folder and lose it.
describe("util/fileloader DLC roots", function () {
	const File = vscode.FileType.File;
	const Directory = vscode.FileType.Directory;

	const baseRoot: Record<string, [string, vscode.FileType][]> = {
		dlc: [
			["dlc028_la_resistance", Directory],
			["dlc023_man_the_guns", Directory],
		],
		"dlc/dlc028_la_resistance": [["interface", Directory]],
		"dlc/dlc028_la_resistance/interface": [["lar.gfx", File]],
		"dlc/dlc023_man_the_guns": [], // present but empty, exactly as on disk
	};

	const bothRoots: Record<string, [string, vscode.FileType][]> = {
		...baseRoot,
		integrated_dlc: [
			["dlc018_together_for_victory", Directory],
			["dlc020_death_or_dishonor", Directory],
			["dlc022_waking_the_tiger", Directory],
			["dlc023_man_the_guns", Directory],
		],
		"integrated_dlc/dlc018_together_for_victory": [["interface", Directory]],
		"integrated_dlc/dlc018_together_for_victory/interface": [["tfv.gfx", File]],
		"integrated_dlc/dlc020_death_or_dishonor": [["interface", Directory]],
		"integrated_dlc/dlc020_death_or_dishonor/interface": [["dod.gfx", File]],
		"integrated_dlc/dlc022_waking_the_tiger": [["interface", Directory]],
		"integrated_dlc/dlc022_waking_the_tiger/interface": [["wtt.gfx", File]],
		"integrated_dlc/dlc023_man_the_guns": [["interface", Directory]],
		"integrated_dlc/dlc023_man_the_guns/interface": [["mtg.gfx", File]],
	};

	let dirs: Record<string, [string, vscode.FileType][]> = {};
	let files: string[] = [];

	function rel(uri: any): string {
		return String(uri?.fsPath ?? uri?.path ?? "")
			.replace(/^hoi4installpath:/, "")
			.replace(/\/+/g, "/")
			.replace(/^\/|\/$/g, "");
	}

	function setLayout(
		layout: Record<string, [string, vscode.FileType][]>,
	): void {
		dirs = layout;
		files = Object.entries(layout).flatMap(([dir, entries]) =>
			entries
				.filter(([, type]) => type === File)
				.map(([name]) => dir + "/" + name),
		);
	}

	beforeEach(function () {
		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: true },
			workspaceFolders: [],
			stat: async (uri: any) => {
				const p = rel(uri);
				if (p in dirs) {
					return { type: Directory, mtime: 1, ctime: 0, size: 0 };
				}
				if (files.includes(p)) {
					return { type: File, mtime: 1, ctime: 0, size: 0 };
				}
				throw new Error("not found: " + p);
			},
			readDirectory: async (uri: any) => dirs[rel(uri)] ?? [],
		});
		setLayout(bothRoots);
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache(); // drop the DLC path, listing and resolution caches between layouts
	});

	it("resolves a file that exists only under integrated_dlc", async function () {
		const found = await getFilePathFromModOrHOI4("interface/wtt.gfx");
		assert.strictEqual(
			rel(found),
			"integrated_dlc/dlc022_waking_the_tiger/interface/wtt.gfx",
		);
	});

	it("still resolves a file under the base dlc folder", async function () {
		const found = await getFilePathFromModOrHOI4("interface/lar.gfx");
		assert.strictEqual(
			rel(found),
			"dlc/dlc028_la_resistance/interface/lar.gfx",
		);
	});

	it("resolves Man the Guns from integrated_dlc although base dlc holds an empty folder of the same name", async function () {
		const found = await getFilePathFromModOrHOI4("interface/mtg.gfx");
		assert.strictEqual(
			rel(found),
			"integrated_dlc/dlc023_man_the_guns/interface/mtg.gfx",
		);
	});

	it("lists files from both dlc roots, base dlc first, without duplicating the shared folder name", async function () {
		assert.deepStrictEqual(await listFilesFromModOrHOI4("interface"), [
			"lar.gfx",
			"tfv.gfx",
			"dod.gfx",
			"wtt.gfx",
			"mtg.gfx",
		]);
	});

	it("behaves as before on an install without integrated_dlc", async function () {
		setLayout(baseRoot);

		assert.strictEqual(
			rel(await getFilePathFromModOrHOI4("interface/lar.gfx")),
			"dlc/dlc028_la_resistance/interface/lar.gfx",
		);
		assert.strictEqual(
			await getFilePathFromModOrHOI4("interface/wtt.gfx"),
			undefined,
		);
		assert.strictEqual(
			await getFilePathFromModOrHOI4("interface/mtg.gfx"),
			undefined,
		); // the empty dlc/ folder is not a match
		assert.deepStrictEqual(await listFilesFromModOrHOI4("interface"), [
			"lar.gfx",
		]);
	});

	it("resolves nothing when neither dlc root exists", async function () {
		setLayout({});

		assert.strictEqual(
			await getFilePathFromModOrHOI4("interface/lar.gfx"),
			undefined,
		);
		assert.deepStrictEqual(await listFilesFromModOrHOI4("interface"), []);
	});
});

describe("util/fileloader listFilesFromModOrHOI4 error branches", function () {
	function uriPath(
		uri: vscode.Uri | { fsPath?: string; path?: string },
	): string {
		return String(uri.fsPath ?? uri.path ?? "");
	}

	function captureConsoleError(): {
		consoleErrors: string[];
		restore: () => void;
	} {
		const consoleErrors: string[] = [];
		const originalConsoleError = console.error;
		console.error = (...args: any[]) => {
			consoleErrors.push(args.map(String).join(" "));
		};
		return {
			consoleErrors,
			restore: () => {
				console.error = originalConsoleError;
			},
		};
	}

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache();
	});

	it("logs and continues when a workspace listing fails", async function () {
		const { consoleErrors, restore } = captureConsoleError();

		try {
			stubVscode({
				workspaceFolders: [
					{
						uri: {
							fsPath: "/ws",
							path: "/ws",
							scheme: "file",
							toString: () => "file:///ws",
						},
					},
				],
				configuration: { loadDlcContents: false },
				stat: async (uri: any) => {
					const p = uriPath(uri);
					if (p.includes("/interface") || p.endsWith(":/")) {
						return {
							type: vscode.FileType.Directory,
							mtime: 0,
							ctime: 0,
							size: 0,
						};
					}
					return {
						type: vscode.FileType.File,
						mtime: 0,
						ctime: 0,
						size: 0,
					};
				},
				readDirectory: async (uri: any) => {
					const p = uriPath(uri);
					if (p.includes("/ws/interface")) {
						throw new Error("workspace listing failed");
					}
					return [];
				},
			});

			const files = await listFilesFromModOrHOI4("interface", {
				mod: true,
				hoi4: false,
				recursively: true,
			});

			assert.deepStrictEqual(files, []);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("workspace listing failed"),
				).length,
				1,
			);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("Failed to list workspace files in"),
				).length,
				1,
			);
		} finally {
			restore();
		}
	});

	it("logs and continues when an HOI4 listing fails", async function () {
		const { consoleErrors, restore } = captureConsoleError();

		try {
			stubVscode({
				workspaceFolders: [],
				configuration: { loadDlcContents: false },
				stat: async (uri: any) => {
					const p = uriPath(uri);
					if (p.endsWith(":/") || p.includes("/interface")) {
						return {
							type: vscode.FileType.Directory,
							mtime: 0,
							ctime: 0,
							size: 0,
						};
					}
					return {
						type: vscode.FileType.File,
						mtime: 0,
						ctime: 0,
						size: 0,
					};
				},
				readDirectory: async (uri: any) => {
					if (uriPath(uri).includes("/interface")) {
						throw new Error("HOI4 listing failed");
					}
					return [];
				},
			});

			const files = await listFilesFromModOrHOI4("interface", {
				mod: false,
				hoi4: true,
				recursively: true,
			});

			assert.deepStrictEqual(files, []);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("HOI4 listing failed"),
				).length,
				1,
			);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("Failed to list HOI4 files in"),
				).length,
				1,
			);
		} finally {
			restore();
		}
	});

	it("logs and continues when a DLC listing fails", async function () {
		const { consoleErrors, restore } = captureConsoleError();

		try {
			stubVscode({
				workspaceFolders: [],
				configuration: { loadDlcContents: true },
				stat: async (uri: any) => {
					const p = uriPath(uri);
					if (
						p === "hoi4installpath:/" ||
						p === "hoi4installpath:/dlc" ||
						p === "hoi4installpath://dlc" ||
						p === "hoi4installpath:/dlc/dlc023_man_the_guns" ||
						p === "hoi4installpath://dlc/dlc023_man_the_guns" ||
						p === "hoi4installpath:/dlc/dlc023_man_the_guns/interface" ||
						p === "hoi4installpath://dlc/dlc023_man_the_guns/interface" ||
						p.endsWith(":/")
					) {
						return {
							type: vscode.FileType.Directory,
							mtime: 0,
							ctime: 0,
							size: 0,
						};
					}
					if (p === "hoi4installpath:/interface") {
						return {
							type: vscode.FileType.File,
							mtime: 0,
							ctime: 0,
							size: 0,
						};
					}
					return {
						type: vscode.FileType.File,
						mtime: 0,
						ctime: 0,
						size: 0,
					};
				},
				readDirectory: async (uri: any) => {
					const p = uriPath(uri);
					if (p === "hoi4installpath:/dlc" || p === "hoi4installpath://dlc") {
						return [["dlc023_man_the_guns", vscode.FileType.Directory]];
					}
					if (
						p === "hoi4installpath:/dlc/dlc023_man_the_guns/interface" ||
						p === "hoi4installpath://dlc/dlc023_man_the_guns/interface"
					) {
						throw new Error("DLC listing failed");
					}
					if (
						p === "hoi4installpath:/dlc/dlc023_man_the_guns" ||
						p === "hoi4installpath://dlc/dlc023_man_the_guns"
					) {
						return [["interface", vscode.FileType.Directory]];
					}
					return [];
				},
			});

			const files = await listFilesFromModOrHOI4("interface", {
				mod: false,
				hoi4: true,
				recursively: true,
			});

			assert.deepStrictEqual(files, []);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("DLC listing failed"),
				).length,
				1,
			);
			assert.strictEqual(
				consoleErrors.filter((message) =>
					message.includes("Failed to list DLC files in"),
				).length,
				1,
			);
		} finally {
			restore();
		}
	});
});

// The entry-returning listing the index builds use. Two things are worth pinning: that on a root
// which really is on disk it comes back with real mtimes and real file: URIs from one pass, and that
// on a root which is not -- the web build, a remote workspace, or an install path that is not set --
// it degrades to the vscode.workspace.fs listing rather than reporting an empty folder.
describe("util/fileloader listFileEntriesFromModOrHOI4", function () {
	const nodeFs = require("fs/promises") as typeof import("fs/promises");
	const nodePath = require("path") as typeof import("path");
	const nodeOs = require("os") as typeof import("os");

	let root: string;
	let workspaceDir: string;
	let gameDir: string;

	// Where a URI the code under test built lands on the real disk. hoi4installpath: URIs never reach
	// a FileSystemProvider in a unit test -- none is registered -- so this does the rewrite the real
	// provider would do, against a temp folder standing in for the install.
	function realPathOf(uri: unknown): string {
		const raw = String(
			(uri as { fsPath?: string; path?: string }).fsPath ??
				(uri as { path?: string }).path ??
				"",
		);
		if (raw.startsWith("hoi4installpath:")) {
			return nodePath.join(
				gameDir,
				raw.slice("hoi4installpath:".length).replace(/^\/+/, ""),
			);
		}
		// The stub's Uri.parse hands back the whole URI string as an fsPath, so a round trip through
		// toString() (which is how modfile keys its cache) arrives here still carrying the scheme.
		return raw.startsWith("file://") ? raw.slice("file://".length) : raw;
	}

	async function write(fullPath: string, content = "x"): Promise<void> {
		await nodeFs.mkdir(nodePath.dirname(fullPath), { recursive: true });
		await nodeFs.writeFile(fullPath, content);
	}

	beforeEach(async function () {
		root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "hoi4entries-"));
		workspaceDir = nodePath.join(root, "ws");
		gameDir = nodePath.join(root, "game");
		await write(nodePath.join(workspaceDir, "interface", "shared.gfx"));
		await write(nodePath.join(workspaceDir, "interface", "sub", "modonly.gfx"));
		await write(nodePath.join(gameDir, "interface", "shared.gfx"));
		await write(nodePath.join(gameDir, "interface", "vanilla.gfx"));

		stubVscode({
			configuration: { modFile: "", installPath: "", loadDlcContents: false },
			workspaceFolders: [{ uri: vscode.Uri.file(workspaceDir) }],
			stat: async (uri: unknown) => {
				const stat = await nodeFs.stat(realPathOf(uri));
				return {
					type: stat.isDirectory()
						? vscode.FileType.Directory
						: vscode.FileType.File,
					mtime: stat.mtime.getTime(),
					ctime: stat.birthtime.getTime(),
					size: stat.size,
				};
			},
			readDirectory: async (uri: unknown) => {
				const dirents = await nodeFs.readdir(realPathOf(uri), {
					withFileTypes: true,
				});
				return dirents.map(
					(dirent) =>
						[
							dirent.name,
							dirent.isDirectory()
								? vscode.FileType.Directory
								: vscode.FileType.File,
						] as [string, number],
				);
			},
		});
	});

	afterEach(async function () {
		restoreVscodeStubs();
		await clearDlcZipCache();
		await nodeFs.rm(root, { recursive: true, force: true });
	});

	it("walks a workspace folder natively, with real mtimes and file: URIs", async function () {
		const when = new Date(Date.UTC(2022, 6, 8, 9, 10, 11));
		await nodeFs.utimes(
			nodePath.join(workspaceDir, "interface", "shared.gfx"),
			when,
			when,
		);

		const entries = await listFileEntriesFromModOrHOI4("interface", {
			mod: true,
			hoi4: false,
			recursively: true,
		});

		assert.deepStrictEqual(
			entries.map((e) => e.relativePath).sort(),
			["shared.gfx", "sub/modonly.gfx"],
		);
		const shared = entries.find((e) => e.relativePath === "shared.gfx")!;
		assert.strictEqual(shared.mtime, when.getTime());
		assert.strictEqual(shared.uri.scheme, "file");
		// The real path, so whoever reads it next goes straight to disk.
		assert.strictEqual(
			nodePath.resolve(realPathOf(shared.uri)),
			nodePath.resolve(workspaceDir, "interface", "shared.gfx"),
		);
	});

	it("keeps the mod's copy of a name and drops the game's", async function () {
		const entries = await listFileEntriesFromModOrHOI4("interface", {
			recursively: true,
		});

		assert.deepStrictEqual(
			entries.map((e) => e.relativePath).sort(),
			["shared.gfx", "sub/modonly.gfx", "vanilla.gfx"],
		);
		const shared = entries.filter((e) => e.relativePath === "shared.gfx");
		assert.strictEqual(shared.length, 1);
		assert.ok(
			realPathOf(shared[0]!.uri).includes("ws"),
			`expected the workspace copy, got ${realPathOf(shared[0]!.uri)}`,
		);
	});

	it("falls back to workspace.fs, undated, for a root that is not on this disk", async function () {
		// The install path is not set, so nothing resolves hoi4installpath: to a real folder and the
		// walk cannot run. The listing still has to answer -- through the provider, as it always did.
		const entries = await listFileEntriesFromModOrHOI4("interface", {
			mod: false,
			hoi4: true,
			recursively: true,
		});

		assert.deepStrictEqual(
			entries.map((e) => e.relativePath).sort(),
			["shared.gfx", "vanilla.gfx"],
		);
		assert.ok(entries.every((e) => e.mtime === undefined));
	});

	it("lists only the top level when not asked to recurse", async function () {
		const entries = await listFileEntriesFromModOrHOI4("interface", {
			mod: true,
			hoi4: false,
		});

		assert.deepStrictEqual(entries.map((e) => e.relativePath), ["shared.gfx"]);
	});

	it("returns nothing for a folder neither side has", async function () {
		assert.deepStrictEqual(
			await listFileEntriesFromModOrHOI4("common/national_focus", {
				recursively: true,
			}),
			[],
		);
	});

	it("rejects a cancelled listing instead of returning part of one", async function () {
		await assert.rejects(
			() =>
				listFileEntriesFromModOrHOI4("interface", {
					recursively: true,
					token: {
						isCancellationRequested: true,
					} as unknown as vscode.CancellationToken,
				}),
			CancelledError,
		);
	});
});
