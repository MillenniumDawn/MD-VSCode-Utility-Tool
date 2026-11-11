import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { CancelledError } from "../../../util/common";
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
import { clearParentModCache } from "../../../util/parentmods";
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
			recordFilePath: ([file]) => file,
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

		it("settles the old global half before retrying a failed initial build against a new source", async () => {
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
			const first = built.ensureBuilt();
			let settled = false;
			const rejection = assert.rejects(first, /workspace failed/);
			void first.then(() => { settled = true; }, () => { settled = true; });
			await entered.promise;
			await settle();
			assert.strictEqual(settled, false);
			assert.strictEqual(built.ensureBuilt(), first);
			release.resolve();
			await rejection;
			world.settings = { ...world.settings, installPath: "/games/B" };
			await built.ensureBuilt();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "NEW");
			for (let i = 0; i < 4; i++) { await settle(); }
			await world.drainCacheWrites();
			assert.strictEqual(built.halves().global.files.get(`${ROOT}/global.txt`), "NEW");
			const cached = Buffer.from(world.disk.get(world.cacheFile("fakeIndex.global.data.jsonl"))!).toString();
			assert.ok(cached.includes("NEW"));
			assert.ok(!cached.includes("OLD"));
			assert.strictEqual(globals, 2, "the retry must build exactly one replacement global half");
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

	it("retries with empty halves after failure, waiting for sibling parents", async () => {
		const failure = new Error("listing failed");
		useParents("/mods/first", "/mods/second");
		const slowParent = deferred();
		const parentStarted = deferred();
		let fail = true;
		const built = create({
			parseFile: async (half, file, options) => {
				if (fail && half.source === "parent") {
					if (options.parentModUris?.[0]?.path === "/mods/first") {
						await parentStarted.promise;
						throw failure;
					}
					parentStarted.resolve();
					await slowParent.promise;
				}
				half.files.set(file.path, "indexed");
				return true;
			},
		});
		let settled = false;
		const first = built.ensureBuilt();
		const rejection = assert.rejects(first, (error) => error === failure);
		void first.then(() => { settled = true; }, () => { settled = true; });
		await parentStarted.promise;
		await settle();
		assert.strictEqual(settled, false);
		assert.strictEqual(built.ensureBuilt(), first);
		assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
		slowParent.resolve();
		await rejection;

		// The files populated before failure are deleted before the next lookup.
		fail = false;
		world.list = () => [];
		await built.ensureBuilt();
		assert.deepStrictEqual(built.inPrecedence().map(files), [[], [], [], []]);
	});

	it("waits for a running vanilla half after the workspace half fails", async () => {
		const slowGlobal = deferred();
		const globalStarted = deferred();
		const failure = new Error("workspace failed");
		const built = create({
			parseFile: async (half) => {
				if (half.source === "global") {
					globalStarted.resolve();
					await slowGlobal.promise;
					return true;
				}
				await globalStarted.promise;
				throw failure;
			},
		});
		const first = built.ensureBuilt();
		let settled = false;
		const rejection = assert.rejects(first, (error) => error === failure);
		void first.then(() => { settled = true; }, () => { settled = true; });
		await globalStarted.promise;
		await settle();
		assert.strictEqual(settled, false);
		assert.strictEqual(built.ensureBuilt(), first);
		slowGlobal.resolve();
		await rejection;
	});

	it("drops partial records when a cancelled build is retried after files were deleted", async () => {
		let cancelled = false;
		mock.method(host().window, "withProgress", (_options: unknown, task: (progress: unknown, token: unknown) => unknown) => task(
			{ report: () => undefined },
			{ get isCancellationRequested() { return cancelled; } },
		));
		world.list = (_root, half) => half === "workspace"
			? listed(Array.from({ length: 8 }, (_, i) => `${i}.txt`)) : [];
		const built = create({
			parseFile: async (half, file) => {
				half.files.set(file.path, "partial");
				cancelled = true;
				return true;
			},
		});
		await assert.rejects(built.ensureBuilt(), /cancel/i);
		assert.ok(built.halves().workspace.files.size > 0);
		cancelled = false;
		world.list = () => [];
		await built.ensureBuilt();
		assert.deepStrictEqual(built.inPrecedence().map(files), [[], []]);
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
		const edited = `${ROOT}/workspace.txt`;
		let built: ThreeHalfIndex<FakeHalf>;

		beforeEach(async () => {
			built = create();
			await built.ensureBuilt();
			calls.length = 0;
		});

		function closeDirty(): void {
			built.handlers.onCloseTextDocument({ uri: workspaceFile(edited), isDirty: true } as unknown as vscode.TextDocument);
		}

		it("is parsed first and swapped in afterwards, and the change reported after the swap", async () => {
			world.read = () => Buffer.from("edited");
			closeDirty();
			await settle();

			assert.deepStrictEqual(calls, [`parse ${edited}`, `remove ${edited}`, `merge ${edited}`, "changed"]);
			assert.strictEqual(built.halves().workspace.files.get(edited), "edited");
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

		for (const intermediate of [
			{ name: "gfxIndex", cacheVersion: 6, root: "interface", file: "failed.gfx" },
			{ name: "localisationIndex", cacheVersion: 4, root: "localisation", file: "failed_l_english.yml" },
		]) {
			it(`retries a failed read from a #708-only ${intermediate.name} cache at the same format version`, async () => {
				const path = `${intermediate.root}/${intermediate.file}`;
				const cache = `${intermediate.name}.workspace`;
				world.list = (_root, half) => half === "workspace" ? listed([intermediate.file]) : [];
				world.read = () => Buffer.from("restored access");
				world.disk.set(world.cacheFile(`${cache}.manifest.json`), Buffer.from(JSON.stringify({
					version: intermediate.cacheVersion, entries: [{ filePath: path, mtime: 1 }],
				})));
				// Empty records are valid for both real #708 formats; the failed file has no record.
				world.disk.set(world.cacheFile(`${cache}.data.jsonl`), Buffer.from("0\n"));
				const options = { name: intermediate.name, cacheVersion: intermediate.cacheVersion, roots: [intermediate.root] };
				const recovered = create(options);
				await recovered.ensureBuilt();
				await world.drainCacheWrites();
				assert.deepStrictEqual(parsedCalls(), [`parse ${path}`]);
				assert.strictEqual(recovered.halves().workspace.files.get(path), "restored access");
				const warm = create(options);
				await warm.ensureBuilt();
				await world.drainCacheWrites();
				assert.deepStrictEqual(parsedCalls(), []);
				assert.strictEqual(warm.halves().workspace.files.get(path), "restored access");
			});
		}

		for (const warm of [false, true]) {
			it(`retries an unreadable ${warm ? "changed" : "new"} file without touching its mtime`, async () => {
				mock.method(Logger, "error", () => undefined);
				const good = `${ROOT}/good.txt`;
				const failed = `${ROOT}/failed.txt`;
				let mtime = 1;
				world.list = (_root, half) => half === "workspace"
					? [...listed(["good.txt"]), ...listed(["failed.txt"], mtime)] : [];
				if (warm) {
					await create().ensureBuilt();
					await world.drainCacheWrites();
					mtime = 2;
				}
				world.read = (path) => {
					if (path === failed) {
						throw new Error("temporarily unreadable");
					}
					return Buffer.from("successful record");
				};
				await create().ensureBuilt();
				await world.drainCacheWrites();
				const manifest = JSON.parse(Buffer.from(world.disk.get(
					world.cacheFile("fakeIndex.workspace.manifest.json"),
				)!).toString()) as { entries: { filePath: string }[] };
				assert.deepStrictEqual(manifest.entries.map((entry) => entry.filePath), [good]);

				world.read = (path) => {
					assert.strictEqual(path, failed, "successful cached file must not be read again");
					return Buffer.from("restored access");
				};
				const retry = create();
				await retry.ensureBuilt();
				await world.drainCacheWrites();
				assert.deepStrictEqual(parsedCalls(), [`parse ${failed}`]);
				assert.deepStrictEqual(files(retry.halves().workspace).sort(), [failed, good]);
				assert.strictEqual(retry.halves().workspace.files.get(failed), "restored access");
				await create().ensureBuilt();
				await world.drainCacheWrites();
				assert.deepStrictEqual(parsedCalls(), []);
			});
		}

		it("leaves the successful cache intact when parsing is cancelled", async () => {
			world.list = (_root, half) => half === "workspace" ? listed(["workspace.txt"]) : [];
			await create().ensureBuilt();
			await world.drainCacheWrites();
			const before = new Map([...world.disk].map(([path, data]) => [path, Buffer.from(data)]));
			world.list = (_root, half) => half === "workspace" ? listed(["workspace.txt"], 2) : [];
			const cancelled = create({ parseFile: async () => { throw new CancelledError(); } });
			await assert.rejects(cancelled.ensureBuilt(), CancelledError);
			await world.drainCacheWrites();
			assert.deepStrictEqual(new Map([...world.disk].map(([path, data]) => [path, Buffer.from(data)])), before);
		});

		it("parses everything and writes the cache when there is none yet", async () => {
			const built = countedSerialize();
			await built.ensureBuilt();
			const writes = await world.drainCacheWrites();

			assert.ok(serializeCalls > 0);
			assert.ok(writes > 0);
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
		});

		it("ignores ghost records saved by older builds but absent from the current listing", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();
			const dataFile = world.cacheFile("fakeIndex.workspace.data.jsonl");
			const lines = Buffer.from(world.disk.get(dataFile)!).toString().trimEnd().split("\n");
			const count = Number(lines.pop());
			lines.push(JSON.stringify([`${ROOT}/deleted.txt`, "ghost"]), String(count + 1));
			world.disk.set(dataFile, Buffer.from(lines.join("\n") + "\n"));
			const built = countedSerialize();
			await built.ensureBuilt();
			assert.deepStrictEqual(files(built.halves().workspace), [`${ROOT}/workspace.txt`]);
			assert.deepStrictEqual(parsedCalls(), []);
		});

		it("does not hydrate old ghost definitions when their path has been recreated", async () => {
			await countedSerialize().ensureBuilt();
			await world.drainCacheWrites();
			const recreated = `${ROOT}/recreated.txt`;
			const dataFile = world.cacheFile("fakeIndex.workspace.data.jsonl");
			const lines = Buffer.from(world.disk.get(dataFile)!).toString().trimEnd().split("\n");
			const count = Number(lines.pop());
			lines.push(JSON.stringify([recreated, "GHOST"]), String(count + 1));
			world.disk.set(dataFile, Buffer.from(lines.join("\n") + "\n"));
			world.list = (_root, half) => half === "workspace"
				? listed(["workspace.txt", "recreated.txt"]) : listed(["global.txt"]);
			world.read = () => Buffer.from("CURRENT");
			const hydrated: string[] = [];
			const built = create({
				hydrate: (half, [path, text], skipFiles) => {
					if (!skipFiles.has(path)) {
						hydrated.push(text);
						half.files.set(path, text);
					}
				},
			});
			await built.ensureBuilt();
			assert.ok(!hydrated.includes("GHOST"));
			assert.strictEqual(built.halves().workspace.files.get(recreated), "CURRENT");
			assert.deepStrictEqual(parsedCalls(), [`parse ${recreated}`]);
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
