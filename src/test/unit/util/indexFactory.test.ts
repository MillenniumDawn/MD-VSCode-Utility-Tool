import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { refreshFeatureFlags } from "../../../util/featureflags";
import * as fileloader from "../../../util/fileloader";
import { createThreeHalfIndex, ThreeHalfIndex, ThreeHalfIndexSpec } from "../../../util/indexFactory";
import { reportIndexParseFailure } from "../../../util/indexHalf";
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
