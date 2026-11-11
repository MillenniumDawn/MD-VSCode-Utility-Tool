import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../util/featureflags";
import * as fileloader from "../../../util/fileloader";
import { createThreeHalfIndex, ThreeHalfIndex, ThreeHalfIndexSpec } from "../../../util/indexFactory";
import { reportIndexParseFailure } from "../../../util/indexHalf";
import * as indexCache from "../../../util/indexCache";
import { captureCacheScope, indexSourceIdentity } from "../../../util/indexCache";
import { getEffectiveInstallPathUri, setInstallPathUri } from "../../../util/installpath";
import { host } from "../../../util/host";
import { Logger } from "../../../util/logger";
import { refreshModDependencies } from "../../../util/moddependencies";
import { clearParentModCache, publishParentMods } from "../../../util/parentmods";
import { deferred, settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

// The skeleton the four indexes share, driven through a spec that records what it is asked to do.
// Each index's own tests cover its data; these cover what every index gets from the factory.

interface FakeHalf {
	source: string;
	// The parent mod a parent half was read from.
	from?: string;
	// Each file the half holds, with the text it was read as.
	files: Map<string, string>;
}

type FakeSpec = ThreeHalfIndexSpec<FakeHalf, [string, string]>;

const ROOT = "common/fake";

describe("util/indexFactory createThreeHalfIndex", () => {
	let index: ThreeHalfIndex<FakeHalf> | undefined;
	let calls: string[] = [];
	const world = useIndexWorld(() => index?.resetForTests(), {});

	function create(overrides: Partial<FakeSpec> = {}): ThreeHalfIndex<FakeHalf> {
		index = createThreeHalfIndex<FakeHalf, [string, string]>({
			name: "fakeIndex",
			message: "Building the fake index",
			rebuildMessage: "Rebuilding the fake index",
			rebuildFailureMessage: "The fake index rebuild failed",
			enabled: () => true,
			roots: [ROOT],
			extension: ".txt",
			cacheVersion: 1,
			newHalf: (source) => ({ source, files: new Map() }),
			hydrate: (half, [path, text], skipFiles) => {
				if (!skipFiles.has(path)) {
					half.files.set(path, text);
				}
			},
			parseFile: async (half, file, options) => {
				calls.push(`parse ${file.path}`);
				try {
					const [content] = await fileloader.readFileFromModOrHOI4(file.path, options);
					half.from ??= options.parentModUris?.[0]?.path;
					half.files.set(file.path, content.toString());
					return true;
				} catch (cause) {
					reportIndexParseFailure(file.path, options, cause);
					return false;
				}
			},
			serialize: (half) => [...half.files],
			removeFile: (workspace, relative) => {
				calls.push(`remove ${relative}`);
				workspace.files.delete(relative);
			},
			mergeFile: (workspace, parsed, relative) => {
				calls.push(`merge ${relative}`);
				workspace.files.set(relative, parsed.files.get(relative)!);
			},
			changed: () => {
				calls.push("changed");
			},
			...overrides,
		});
		calls = [];
		return index;
	}

	function files(half: FakeHalf): string[] {
		return [...half.files.keys()];
	}

	function useParents(...paths: string[]): void {
		world.settings = { parentModPaths: paths };
		refreshFeatureFlags();
		clearParentModCache();
	}

	beforeEach(() => {
		world.list = (_root, half) => listed([`${half}.txt`]);
		world.read = (relativePath) => Buffer.from(relativePath);
	});

	it("looks up the working mod first, then each parent in the order given, then vanilla", async () => {
		useParents("/mods/first", "/mods/second");
		const built = create();
		await built.ensureBuilt();

		assert.deepStrictEqual(
			built.inPrecedence().map((half) => half.from ?? half.source),
			["workspace", "/mods/first", "/mods/second", "global"],
		);
		assert.deepStrictEqual(built.inPrecedence().map(files), [
			[`${ROOT}/workspace.txt`],
			[`${ROOT}/parent.txt`],
			[`${ROOT}/parent.txt`],
			[`${ROOT}/global.txt`],
		]);
	});

	describe("game source settings", () => {
		function change(built: ThreeHalfIndex<FakeHalf>, key: string, value: unknown): void {
			world.settings = { ...world.settings, [key]: value };
			built.handlers.onChangeConfiguration({
				affectsConfiguration: (setting: string) => setting === `mdHoi4Utilities.${key}`,
			} as vscode.ConfigurationChangeEvent);
		}

		beforeEach(() => {
			world.settings = { installPath: "/games/A", loadDlcContents: true };
			world.read = () => Buffer.from(`${world.settings.installPath}:${world.settings.loadDlcContents}`);
		});

		for (const [key, value] of [["installPath", "/games/B"], ["loadDlcContents", false]] as const) {
			it(`rebuilds only vanilla and separates warm caches after ${key} changes with identical mtimes`, async () => {
				world.useDisk();
				useParents("/mods/first");
				world.settings = { ...world.settings, installPath: "/games/A", loadDlcContents: true };
				const built = create();
				await built.ensureBuilt();
				await world.drainCacheWrites();
				const previous = built.halves();
				const oldCache = world.cacheFile("fakeIndex.global.manifest.json");
				world.listings = 0;
				change(built, key, value);
				await built.ensureBuilt();
				await world.drainCacheWrites();
				assert.strictEqual(world.listings, 1);
				assert.strictEqual(built.halves().workspace, previous.workspace);
				assert.strictEqual(built.halves().parents[0], previous.parents[0]);
				const expected = `${world.settings.installPath}:${world.settings.loadDlcContents}`;
				assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), expected);
				assert.notStrictEqual(world.cacheFile("fakeIndex.global.manifest.json"), oldCache);
				built.resetForTests();
				calls.length = 0;
				await built.ensureBuilt();
				assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), expected);
				// Vanilla restores the new setting's cache, even though the path and mtime match A's.
				assert.ok(!calls.includes(`parse ${ROOT}/global.txt`));
			});
		}

		it("normalizes quoted installation paths before choosing the source and cache identity", () => {
			world.useDisk();
			const identity = indexSourceIdentity();
			const scope = captureCacheScope()!.toString();
			world.settings = { ...world.settings, installPath: '  "/games/A"  ' };
			assert.strictEqual(indexSourceIdentity(), identity);
			assert.strictEqual(captureCacheScope()!.toString(), scope);
		});

		it("ignores unrelated configuration changes", async () => {
			const built = create();
			await built.ensureBuilt();
			const previous = built.halves().global;
			const listings = world.listings;
			change(built, "previewWheel", "zoom");
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global, previous);
			assert.strictEqual(world.listings, listings);
		});

		it("wires source changes through the registered configuration event", async () => {
			let listener: ((event: vscode.ConfigurationChangeEvent) => unknown) | undefined;
			mock.method(host().workspace, "onDidChangeConfiguration", (handler: typeof listener) => {
				listener = handler;
				return { dispose: () => { listener = undefined; } };
			});
			const built = create();
			const registration = built.register();
			await built.ensureBuilt();
			assert.ok(listener);
			world.settings = { ...world.settings, installPath: "/games/B" };
			listener({ affectsConfiguration: (key) => key === "mdHoi4Utilities.installPath" });
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "/games/B:true");
			registration.dispose();
			assert.strictEqual(listener, undefined);
		});

		it("rebuilds and separates caches for a remote folder-picker override without a configuration event", async () => {
			world.useDisk();
			world.read = () => Buffer.from(getEffectiveInstallPathUri()!.toString());
			const built = create();
			const registration = built.register();
			try {
				await built.ensureBuilt();
				await world.drainCacheWrites();
				const previous = built.halves();
				const oldScope = captureCacheScope()!.toString();
				const picked = {
					scheme: "vscode-vfs", path: "/game/B", fsPath: "/game/B",
					toString: () => "vscode-vfs://remote/game/B",
				} as vscode.Uri;
				setInstallPathUri(picked);
				await built.ensureBuilt();
				assert.strictEqual(world.settings.installPath, "/games/A");
				assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), picked.toString());
				assert.notStrictEqual(captureCacheScope()!.toString(), oldScope);
				assert.strictEqual(built.halves().workspace, previous.workspace);
				assert.deepStrictEqual(built.halves().parents, previous.parents);
				change(built, "loadDlcContents", false);
				await built.ensureBuilt();
				assert.strictEqual(getEffectiveInstallPathUri(), picked, "DLC changes must retain the picker override");
				assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), picked.toString());
			} finally {
				registration.dispose();
			}
		});

		it("does no indexing for a source change before the first lookup", async () => {
			const built = create();
			change(built, "installPath", "/games/B");
			await settle();
			assert.strictEqual(world.listings, 0);
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "/games/B:true");
		});

		it("discards an obsolete in-flight initial half and does not cache its mixed source", async () => {
			world.useDisk();
			const oldData = deferred<Buffer>();
			const entered = deferred();
			world.read = (_path, half) => {
				if (half === "global" && world.settings.installPath === "/games/A") {
					entered.resolve();
					return oldData.promise;
				}
				return Buffer.from("NEW");
			};
			const built = create();
			const oldCache = world.cacheFile("fakeIndex.global.data.jsonl");
			const lookup = built.ensureBuilt();
			await entered.promise;
			change(built, "installPath", "/games/B");
			oldData.resolve(Buffer.from("OLD"));
			await lookup;
			await world.drainCacheWrites();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "NEW");
			assert.strictEqual(world.disk.has(oldCache), false);
		});

		it("prevents an old global half from overwriting or caching after a failed initial build is retried", async () => {
			world.useDisk();
			mock.method(Logger, "error", () => undefined);
			const entered = deferred();
			const release = deferred();
			let globals = 0;
			let workspaces = 0;
			const built = create({
				parseFile: async (half, file) => {
					if (half.source === "global") {
						if (++globals === 1) {
							entered.resolve();
							await release.promise;
							half.files.set(file.path, "OLD");
						} else {
							half.files.set(file.path, "NEW");
						}
					} else if (++workspaces === 1) {
						await entered.promise;
						throw new Error("workspace failed");
					}
					return true;
				},
			});
			await assert.rejects(built.ensureBuilt(), /workspace failed/);
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "NEW");
			release.resolve();
			for (let i = 0; i < 4; i++) { await settle(); }
			await world.drainCacheWrites();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "NEW");
			const cached = Buffer.from(world.disk.get(world.cacheFile("fakeIndex.global.data.jsonl"))!).toString();
			assert.ok(cached.includes("NEW"));
			assert.ok(!cached.includes("OLD"));
			assert.strictEqual(globals, 2, "the superseded attempt must stop instead of starting another build");
		});

		it("finishes an already-started cache pair in its original namespace after a source change", async () => {
			world.useDisk();
			const oldManifest = world.cacheFile("fakeIndex.global.manifest.json");
			const oldScope = captureCacheScope()!.toString();
			const entered = deferred();
			const release = deferred();
			const saveRecords = indexCache.saveCacheRecords;
			mock.method(indexCache, "saveCacheRecords", async (...args: Parameters<typeof saveRecords>) => {
				await saveRecords(...args);
				if (args[0] === "fakeIndex.global" && args[2]?.toString() === oldScope) {
					entered.resolve();
					await release.promise;
				}
			});
			const built = create();
			await built.ensureBuilt();
			await entered.promise;
			change(built, "installPath", "/games/B");
			await built.ensureBuilt();
			release.resolve();
			await settle();
			await world.drainCacheWrites();
			assert.ok(world.disk.has(oldManifest), "captured records must retain their matching manifest");
			change(built, "installPath", "/games/A");
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "/games/A:true");
		});

		it("waits for the newest source when settings change again during a rebuild", async () => {
			const built = create();
			await built.ensureBuilt();
			const oldData = deferred<Buffer>();
			const entered = deferred();
			world.read = (_path, half) => {
				if (half === "global" && world.settings.installPath === "/games/B") {
					entered.resolve();
					return oldData.promise;
				}
				return Buffer.from("LATEST");
			};
			change(built, "installPath", "/games/B");
			await entered.promise;
			const lookup = built.ensureBuilt();
			change(built, "installPath", "/games/A");
			oldData.resolve(Buffer.from("OBSOLETE"));
			await lookup;
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "LATEST");
		});

		it("retries a failed corrective build on the next lookup", async () => {
			mock.method(Logger, "error", () => undefined);
			let reject = false;
			const built = create({
				parseFile: async (half, file) => {
					if (half.source === "global" && reject) { throw new Error("transient"); }
					half.files.set(file.path, String(world.settings.installPath));
					return true;
				},
			});
			await built.ensureBuilt();
			reject = true;
			change(built, "installPath", "/games/B");
			await assert.rejects(built.ensureBuilt(), /transient/);
			reject = false;
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "/games/B");
		});
	});

	describe("external source notifications", () => {
		type Watch = { base: string; change: (file: vscode.Uri) => void; create: (file: vscode.Uri) => void; remove: (file: vscode.Uri) => void; disposed: boolean };
		let watches: Watch[];
		let registration: vscode.Disposable;
		let configuration: (event: vscode.ConfigurationChangeEvent) => void;
		let contents: string;

		beforeEach(() => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			useParents("/mods/parent");
			world.settings = { ...world.settings, installPath: "/games/A", loadDlcContents: true };
			contents = "OLD";
			world.read = () => Buffer.from(contents);
			watches = [];
			mock.method(host().workspace, "onDidChangeConfiguration", (listener: typeof configuration) => {
				configuration = listener;
				return { dispose() {} };
			});
			mock.method(host().workspace, "createFileSystemWatcher", (pattern: vscode.GlobPattern) => {
				const watch: Watch = { base: typeof pattern === "string" ? "workspace" : pattern.baseUri.path,
					change() {}, create() {}, remove() {}, disposed: false };
				watches.push(watch);
				return {
					onDidChange: (listener: Watch["change"]) => { watch.change = listener; return { dispose() {} }; },
					onDidCreate: (listener: Watch["create"]) => { watch.create = listener; return { dispose() {} }; },
					onDidDelete: (listener: Watch["remove"]) => { watch.remove = listener; return { dispose() {} }; },
					dispose: () => { watch.disposed = true; },
				} as unknown as vscode.FileSystemWatcher;
			});
		});
		afterEach(() => { registration?.dispose(); mock.timers.reset(); });

		for (const [source, base, relative] of [
			["parent", "/mods/parent", `${ROOT}/parent.txt`],
			["global", "/games/A", `${ROOT}/global.txt`],
			["global", "/games/A", "dlc/dlc001/content.zip"],
			["global", "/games/A", `integrated_dlc/dlc001/${ROOT}/global.txt`],
		] as const) {
			it(`refreshes only ${source} for unopened ${relative} changes, additions and removals`, async () => {
				world.useDisk();
				const built = create();
				registration = built.register();
				await built.ensureBuilt();
				await world.drainCacheWrites();
				const previous = built.halves();
				const watch = watches.find((entry) => entry.base === base)!;
				const file = host().Uri.file(`${base}/${relative}`);
				const half = () => source === "parent" ? built.halves().parents[0]! : built.halves().global;
				world.listings = 0;
				contents = "NEW";
				watch.change(file);
				watch.create(file);
				mock.timers.tick(999);
				await settle();
				assert.strictEqual(world.listings, 0);
				mock.timers.tick(1);
				await settle();
				await built.ensureBuilt();
				assert.strictEqual(world.listings, 1);
				assert.strictEqual(half().files.get(`${ROOT}/${source}.txt`), "NEW");
				assert.strictEqual(built.halves().workspace, previous.workspace);
				if (source === "parent") { assert.strictEqual(built.halves().global, previous.global); }
				else { assert.strictEqual(built.halves().parents[0], previous.parents[0]); }
				world.list = (_root, kind) => kind === source ? [] : listed([`${kind}.txt`]);
				watch.remove(file);
				mock.timers.tick(1000);
				await settle();
				await built.ensureBuilt();
				assert.deepStrictEqual(files(half()), []);
			});
		}

		it("ignores unrelated roots, outside paths, and disabled DLC changes", async () => {
			world.settings = { ...world.settings, loadDlcContents: false };
			const built = create();
			registration = built.register();
			await built.ensureBuilt();
			world.listings = 0;
			const game = watches.find((entry) => entry.base === "/games/A")!;
			for (const relative of ["unrelated/other.txt", `../AB/${ROOT}/global.txt`, "dlc/dlc001/content.zip"]) {
				game.change(host().Uri.file(`/games/A/${relative}`));
			}
			mock.timers.tick(3000);
			await settle();
			assert.strictEqual(world.listings, 0);
		});

		it("replaces watchers after installation and resolved parent changes and rejects old callbacks", async () => {
			const built = create();
			registration = built.register();
			await built.ensureBuilt();
			const oldGame = watches.find((entry) => entry.base === "/games/A")!;
			world.settings = { ...world.settings, installPath: "/games/B" };
			configuration({ affectsConfiguration: (key) => key === "mdHoi4Utilities.installPath" });
			await built.ensureBuilt();
			assert.ok(oldGame.disposed);
			assert.ok(watches.some((entry) => entry.base === "/games/B" && !entry.disposed));
			const oldParent = watches.find((entry) => entry.base === "/mods/parent" && !entry.disposed)!;
			world.settings = { ...world.settings, parentModPaths: ["/mods/new"] };
			clearParentModCache();
			publishParentMods();
			await settle();
			assert.ok(oldParent.disposed);
			assert.ok(watches.some((entry) => entry.base === "/mods/new" && !entry.disposed));
			world.listings = 0;
			oldGame.change(host().Uri.file(`/games/A/${ROOT}/global.txt`));
			oldParent.change(host().Uri.file(`/mods/parent/${ROOT}/parent.txt`));
			mock.timers.tick(1000);
			await settle();
			assert.strictEqual(world.listings, 0);
		});

		it("bounds continuous external writes and cancels pending work on disposal", async () => {
			const built = create();
			registration = built.register();
			await built.ensureBuilt();
			const parent = watches.find((entry) => entry.base === "/mods/parent")!;
			const file = host().Uri.file(`/mods/parent/${ROOT}/parent.txt`);
			world.listings = 0;
			for (let index = 0; index < 4; index++) { parent.change(file); mock.timers.tick(750); }
			await settle();
			assert.strictEqual(world.listings, 1);
			parent.change(file);
			registration.dispose();
			mock.timers.tick(1000);
			await settle();
			assert.strictEqual(world.listings, 1);
			assert.ok(watches.every((watch) => watch.disposed));
		});
	});

	describe("directory operations", () => {
		const oldFile = `${ROOT}/old/nested/child.txt`;
		const newFile = `${ROOT}/new/nested/child.txt`;

		beforeEach(() => {
			world.list = (_root, half) => half === "workspace" ? listed(["old/nested/child.txt"]) : listed([`${half}.txt`]);
		});

		it("removes descendants after directory deletion without statting a deleted path", async () => {
			world.useDisk();
			useParents("/mods/first");
			const built = create();
			await built.ensureBuilt();
			await world.drainCacheWrites();
			const previous = built.halves();
			let stats = 0;
			mock.method(host().workspace.fs, "stat", async () => { stats++; throw new Error("gone"); });
			world.list = (_root, half) => half === "workspace" ? [] : listed([`${half}.txt`]);
			built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/old`)] });
			await built.ensureBuilt();
			assert.deepStrictEqual(files(built.halves().workspace), []);
			assert.strictEqual(stats, 0);
			assert.strictEqual(built.halves().global, previous.global);
			assert.strictEqual(built.halves().parents[0], previous.parents[0]);
			await world.drainCacheWrites();
			built.resetForTests();
			await built.ensureBuilt();
			assert.deepStrictEqual(files(built.halves().workspace), []);
		});

		it("reindexes nested descendants after one folder rename event without old-path stat", async () => {
			const built = create();
			await built.ensureBuilt();
			mock.method(host().workspace.fs, "stat", async () => { throw new Error("old path gone"); });
			world.list = (_root, half) => half === "workspace" ? listed(["new/nested/child.txt"]) : [];
			built.handlers.onRenameFiles({ files: [{ oldUri: workspaceFile(`${ROOT}/old`), newUri: workspaceFile(`${ROOT}/new`) }] });
			await built.ensureBuilt();
			assert.deepStrictEqual(files(built.halves().workspace), [newFile]);
			assert.ok(!built.halves().workspace.files.has(oldFile));
		});

		it("finds descendants created in a folder whose name ends in the indexed extension", async () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			try {
				const built = create();
				await built.ensureBuilt();
				mock.method(host().workspace.fs, "stat", async () => ({ type: 2, ctime: 0, mtime: 1, size: 0 }));
				world.list = (_root, half) => half === "workspace" ? listed(["folder.txt/child.txt"]) : [];
				built.handlers.onCreateFiles({ files: [workspaceFile(`${ROOT}/folder.txt`)] });
				mock.timers.tick(1000);
				await settle();
				await built.ensureBuilt();
				assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/folder.txt/child.txt`]);
			} finally {
				mock.timers.reset();
			}
		});

		for (const directory of [ROOT, "common"]) {
			it(`refreshes after deleting the root or its ancestor: ${directory}`, async () => {
				const built = create();
				await built.ensureBuilt();
				world.list = () => [];
				built.handlers.onDeleteFiles({ files: [workspaceFile(directory)] });
				await built.ensureBuilt();
				assert.deepStrictEqual(files(built.halves().workspace), []);
			});
		}

		it("coalesces a batch of folder changes into one workspace listing and ignores sibling prefixes", async () => {
			const built = create();
			await built.ensureBuilt();
			world.listings = 0;
			world.list = (_root, half) => half === "workspace" ? listed(["new/nested/child.txt"]) : [];
			built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/old`)] });
			built.handlers.onCreateFiles({ files: [workspaceFile(`${ROOT}/new`)] });
			built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}-other/old`)] });
			await built.ensureBuilt();
			assert.strictEqual(world.listings, 1);
			assert.deepStrictEqual(files(built.halves().workspace), [newFile]);
		});

		it("does not let a delayed child re-read restore entries after its folder was deleted", async () => {
			const built = create();
			await built.ensureBuilt();
			const oldRead = deferred<Buffer>();
			world.read = () => oldRead.promise;
			built.handlers.onCloseTextDocument({ uri: workspaceFile(oldFile), isDirty: true } as vscode.TextDocument);
			await settle();
			world.list = () => [];
			built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/old`)] });
			await built.ensureBuilt();
			oldRead.resolve(Buffer.from("stale"));
			await settle();
			assert.deepStrictEqual(files(built.halves().workspace), []);
		});

		it("does not dispatch a created-file read after disposal while its stat was pending", async () => {
			const built = create();
			const registration = built.register();
			await built.ensureBuilt();
			const stat = deferred<vscode.FileStat>();
			const entered = deferred();
			mock.method(host().workspace.fs, "stat", async () => {
				entered.resolve();
				return stat.promise;
			});
			const reads = world.reads;
			built.handlers.onCreateFiles({ files: [workspaceFile(`${ROOT}/created.txt`)] });
			await entered.promise;
			registration.dispose();
			stat.resolve({ type: 1, ctime: 0, mtime: 1, size: 0 });
			await built.ensureBuilt();
			await settle();
			assert.strictEqual(world.reads, reads);
			assert.ok(!built.halves().workspace.files.has(`${ROOT}/created.txt`));
		});

		it("reparses surviving dirty edits during a warm directory refresh even when disk mtimes are unchanged", async () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			try {
				world.useDisk();
				const a = `${ROOT}/a.txt`;
				world.list = (_root, half) => half === "workspace" ? listed(["a.txt", "folder/b.txt"]) : [];
				world.read = () => Buffer.from("OLD_A");
				const built = create();
				await built.ensureBuilt();
				await world.drainCacheWrites();
				world.read = () => Buffer.from("NEW_A");
				built.handlers.onChangeTextDocument({ document: { uri: workspaceFile(a) } } as vscode.TextDocumentChangeEvent);
				world.list = (_root, half) => half === "workspace" ? listed(["a.txt"]) : [];
				built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/folder`)] });
				await built.ensureBuilt();
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(built.halves().workspace.files.get(a), "NEW_A");
				assert.deepStrictEqual(files(built.halves().workspace), [a]);
			} finally {
				mock.timers.reset();
			}
		});

		it("keeps known single-file renames incremental", async () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			try {
				const built = create();
				await built.ensureBuilt();
				world.listings = 0;
				built.handlers.onRenameFiles({ files: [{ oldUri: workspaceFile(oldFile), newUri: workspaceFile(newFile) }] });
				mock.timers.tick(1000);
				await settle();
				await built.ensureBuilt();
				assert.strictEqual(world.listings, 0);
				assert.deepStrictEqual(files(built.halves().workspace), [newFile]);
			} finally {
				mock.timers.reset();
			}
		});

		it("preserves an unrelated queued edit when an ordinary file is created", async () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			try {
				world.list = (_root, half) => half === "workspace" ? listed(["a.txt"]) : [];
				world.read = () => Buffer.from("OLD_A");
				const built = create();
				await built.ensureBuilt();
				const a = `${ROOT}/a.txt`;
				const b = `${ROOT}/b.txt`;
				world.read = (file) => Buffer.from(file === a ? "NEW_A" : "B");
				built.handlers.onChangeTextDocument({ document: { uri: workspaceFile(a) } } as vscode.TextDocumentChangeEvent);
				built.handlers.onCreateFiles({ files: [workspaceFile(b)] });
				await built.ensureBuilt();
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(built.halves().workspace.files.get(a), "NEW_A");
				assert.strictEqual(built.halves().workspace.files.get(b), "B");
			} finally {
				mock.timers.reset();
			}
		});

		it("invalidates an old debounced child edit before it can read cached deleted content", async () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			try {
				const built = create();
				await built.ensureBuilt();
				built.handlers.onChangeTextDocument({ document: { uri: workspaceFile(oldFile) } } as vscode.TextDocumentChangeEvent);
				world.list = () => [];
				built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/old`)] });
				await built.ensureBuilt();
				const reads = world.reads;
				mock.timers.tick(1000);
				await settle();
				assert.strictEqual(world.reads, reads);
				assert.deepStrictEqual(files(built.halves().workspace), []);
			} finally {
				mock.timers.reset();
			}
		});

		it("retries a failed directory refresh instead of accepting the previous half", async () => {
			const built = create();
			await built.ensureBuilt();
			mock.method(Logger, "error", () => undefined);
			world.list = () => { throw new Error("unavailable"); };
			built.handlers.onDeleteFiles({ files: [workspaceFile(`${ROOT}/old`)] });
			await assert.rejects(built.ensureBuilt(), /unavailable/);
			world.list = () => [];
			await built.ensureBuilt();
			assert.deepStrictEqual(files(built.halves().workspace), []);
		});
	});

	it("names the half a file came from when it fails to parse", async () => {
		useParents("/mods/first");
		const logs: string[] = [];
		mock.method(Logger, "error", (message: string) => {
			logs.push(message);
		});
		world.read = () => {
			throw new Error("unreadable");
		};
		await create().ensureBuilt();

		const labelOf = (name: string) => logs.find((line) => line.includes(`${ROOT}/${name}`)) ?? "";
		assert.ok(labelOf("global.txt").includes("[Vanilla]"), labelOf("global.txt"));
		assert.ok(labelOf("parent.txt").includes("[Parent mod]"), labelOf("parent.txt"));
		assert.ok(labelOf("workspace.txt").includes("[Mod]"), labelOf("workspace.txt"));
	});

	it("lists no parent half for a mod that extends nothing", async () => {
		const listedHalves: string[] = [];
		world.list = (_root, half) => {
			listedHalves.push(half);
			return [];
		};
		const built = create();
		await built.ensureBuilt();

		assert.deepStrictEqual(listedHalves.sort(), ["global", "workspace"]);
		assert.strictEqual(built.halves().parents.length, 0);
	});

	it("parses only the names the filter keeps", async () => {
		world.list = (_root, half) => (half === "workspace" ? listed(["kept.txt", "dropped.yml"]) : []);
		await create({ filter: (relativePath) => relativePath.endsWith(".txt") }).ensureBuilt();

		assert.deepStrictEqual(calls, [`parse ${ROOT}/kept.txt`]);
	});

	it("lists a root a source does not have as empty when the index tolerates it", async () => {
		mock.method(Logger, "warn", () => undefined);
		world.list = (root, half) => {
			if (root === "events") {
				throw new Error("no events folder");
			}
			return half === "workspace" ? listed(["kept.txt"]) : [];
		};
		const built = create({ roots: [ROOT, "events"], tolerateRootErrors: true });
		await built.ensureBuilt();

		assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/kept.txt`]);
	});

	describe("an edited workspace file", () => {
		beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
		afterEach(() => mock.timers.reset());
		const edited = `${ROOT}/workspace.txt`;
		let built: ThreeHalfIndex<FakeHalf>;

		beforeEach(async () => {
			built = create();
			await built.ensureBuilt();
			calls.length = 0;
		});

		function closeDirty(): void {
			built.handlers.onCloseTextDocument({ uri: workspaceFile(edited), isDirty: true } as unknown as vscode.TextDocument);
			mock.timers.tick(1000);
		}

		it("is parsed first and swapped in afterwards, and the change reported after the swap", async () => {
			world.read = () => Buffer.from("edited");
			closeDirty();
			await settle();

			assert.deepStrictEqual(calls, [`parse ${edited}`, `remove ${edited}`, `merge ${edited}`, "changed"]);
			assert.strictEqual(built.halves().workspace.files.get(edited), "edited");
		});

		it("discards a re-read from a failed build when the initial build retries", async () => {
			let fail = true;
			let eventReadStarted = false;
			const staleRead = deferred();
			world.list = (_root, half) => {
				if (half === "global" && fail) {
					throw new Error("initial listing failed");
				}
				return half === "workspace" ? listed(["workspace.txt"]) : [];
			};
			built = create({
				parseFile: async (half, file) => {
					if (file.uri) {
						eventReadStarted = true;
						await staleRead.promise;
						half.files.set(file.path, "stale event");
					} else {
						half.files.set(file.path, "retry contents");
					}
					return true;
				},
			});
			const first = assert.rejects(built.ensureBuilt(), /initial listing failed/);
			built.handlers.onCreateFiles({ files: [workspaceFile(edited)] });
			mock.timers.tick(1000);
			await first;
			await settle();
			assert.strictEqual(eventReadStarted, true);
			fail = false;
			await built.ensureBuilt();
			staleRead.resolve();
			await settle();
			assert.strictEqual(built.halves().workspace.files.get(edited), "retry contents");
		});

		it("resolves the workspace winner before parsing so a re-read bypasses cached content", async () => {
			const resolved: string[] = [];
			built = create({
				parseFile: async (half, file) => {
					if (file.uri) {
						resolved.push(file.uri.path);
					}
					half.files.set(file.path, "fresh");
					return true;
				},
			});
			await built.ensureBuilt();
			assert.deepStrictEqual(resolved, []);
			closeDirty();
			await settle();
			assert.deepStrictEqual(resolved, [workspaceFile(edited).path]);
		});

		it("reports a failed resolution without discarding the existing index", async () => {
			const errors: string[] = [];
			mock.method(Logger, "error", (message: string) => errors.push(message));
			mock.method(fileloader, "getFilePathFromModOrHOI4", async () => { throw new Error("unavailable filesystem"); });
			closeDirty();
			await settle();
			assert.strictEqual(built.halves().workspace.files.get(edited), edited);
			assert.strictEqual(errors.length, 1);
			assert.ok(errors[0].includes("unavailable filesystem"));
		});

		it("keeps what it was last indexed with when the re-read fails", async () => {
			mock.method(Logger, "error", () => undefined);
			world.read = () => {
				throw new Error("file gone mid-edit");
			};
			closeDirty();
			await settle();

			assert.deepStrictEqual(calls, [`parse ${edited}`]);
			assert.strictEqual(built.halves().workspace.files.get(edited), edited);
		});
	});

	it("serializes nothing when the build has no cache namespace", async () => {
		// Without a storage root the capture returns a null scope, which cannot be written to; the
		// build still parses, but it must not pay the copy the serialize makes of every live record.
		let serializeCalls = 0;
		const built = create({
			serialize: (half) => {
				serializeCalls++;
				return [...half.files];
			},
		});
		await built.ensureBuilt();

		assert.strictEqual(serializeCalls, 0);
		assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
	});

	// The disk cache writes fire and forget behind the build, so every test here counts the saves the
	// world caught and awaits them through drainCacheWrites before reading the cache or rebuilding.
	describe("disk cache writes", () => {
		let serializeCalls: number;

		beforeEach(() => {
			world.useDisk();
			serializeCalls = 0;
		});

		function countedSerialize(): ThreeHalfIndex<FakeHalf> {
			return create({
				serialize: (half) => {
					serializeCalls++;
					return [...half.files];
				},
			});
		}

		function parsedCalls(): string[] {
			return calls.filter((call) => call.startsWith("parse")).sort();
		}

		it("parses everything and writes the cache when there is none yet", async () => {
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
		});

		it("serializes nothing and writes nothing on an unchanged warm build", async () => {
			world.read = (relativePath) => Buffer.from(`${relativePath} v1`);
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			serializeCalls = 0;
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.strictEqual(serializeCalls, 0);
			assert.strictEqual(writes, 0);
			assert.deepStrictEqual(parsedCalls(), []);
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
			assert.strictEqual(built.halves().workspace.files.get(`${ROOT}/workspace.txt`), `${ROOT}/workspace.txt v1`);
		});

		it("serializes and writes when a file changed", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			world.list = (_root, half) => listed([`${half}.txt`], 2);
			world.read = (relativePath) => Buffer.from(`${relativePath} v2`);
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.deepStrictEqual(parsedCalls(), [`parse ${ROOT}/global.txt`, `parse ${ROOT}/workspace.txt`]);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.strictEqual(built.halves().workspace.files.get(`${ROOT}/workspace.txt`), `${ROOT}/workspace.txt v2`);
		});

		it("serializes and writes when a file was added", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			world.list = (_root, half) =>
				half === "workspace" ? listed(["workspace.txt", "added.txt"]) : listed(["global.txt"]);
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.deepStrictEqual(parsedCalls(), [`parse ${ROOT}/added.txt`]);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.deepStrictEqual(files(built.halves().workspace).sort(), [
				`${ROOT}/added.txt`,
				`${ROOT}/workspace.txt`,
			]);
		});

		it("writes when a file was removed, even though nothing needed parsing", async () => {
			world.list = (_root, half) =>
				half === "workspace" ? listed(["workspace.txt", "extra.txt"]) : listed(["global.txt"]);
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			world.list = (_root, half) => listed([`${half}.txt`]);
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.deepStrictEqual(parsedCalls(), []);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
			// The manifest on disk carries the removal, so the next build does not wait for extra.txt.
			const manifest = JSON.parse(
				Buffer.from(world.disk.get(world.cacheFile("fakeIndex.workspace.manifest.json"))!).toString(),
			) as { entries: { filePath: string }[] };
			assert.deepStrictEqual(manifest.entries.map((entry) => entry.filePath), [`${ROOT}/workspace.txt`]);
		});

		it("parses everything again and writes after the cache data vanished", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			world.disk.delete(world.cacheFile("fakeIndex.workspace.data.jsonl"));
			world.read = (relativePath) => Buffer.from(`${relativePath} v3`);
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			// The global half still restores from its cache; the workspace half lost its data file.
			assert.deepStrictEqual(parsedCalls(), [`parse ${ROOT}/workspace.txt`]);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.strictEqual(built.halves().workspace.files.get(`${ROOT}/workspace.txt`), `${ROOT}/workspace.txt v3`);
		});

		it("parses everything again and writes after the cache data was corrupted", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			mock.method(Logger, "warn", () => undefined);
			world.disk.set(
				world.cacheFile("fakeIndex.workspace.data.jsonl"),
				new TextEncoder().encode("not a cache"),
			);
			world.read = (relativePath) => Buffer.from(`${relativePath} v4`);
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.deepStrictEqual(parsedCalls(), [`parse ${ROOT}/workspace.txt`]);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.strictEqual(built.halves().workspace.files.get(`${ROOT}/workspace.txt`), `${ROOT}/workspace.txt v4`);
		});

		it("serializes and writes after the dependency generation changed", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();

			await refreshModDependencies();
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.deepStrictEqual(parsedCalls(), [`parse ${ROOT}/global.txt`, `parse ${ROOT}/workspace.txt`]);
			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
		});
	});

	it("rebuilds only the workspace half when the workspace folders change", async () => {
		const built = create();
		await built.ensureBuilt();
		const global = built.halves().global;
		world.listings = 0;
		world.list = (_root, half) => listed([half === "workspace" ? "added.txt" : `${half}.txt`]);

		built.handlers.onChangeWorkspaceFolders({ added: [], removed: [] } as unknown as vscode.WorkspaceFoldersChangeEvent);
		for (let i = 0; i < 20 && !built.halves().workspace.files.has(`${ROOT}/added.txt`); i++) {
			await settle();
		}

		assert.strictEqual(world.listings, 1);
		assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/added.txt`]);
		assert.strictEqual(built.halves().global, global);
	});
});
