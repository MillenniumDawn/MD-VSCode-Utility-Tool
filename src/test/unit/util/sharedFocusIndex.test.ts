import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import * as hoiparser from "../../../hoiformat/hoiparser";
import * as fileloader from "../../../util/fileloader";
import { Logger } from "../../../util/logger";
import {
	findFileByFocusKey,
	__resetSharedFocusIndexForTests,
	__testHandlers,
} from "../../../util/sharedFocusIndex";
import { Deferred, deferred, settle } from "../async";
import { listed, useIndexWorld, workspaceFile } from "../indexes";

// The lazy build and the event handlers every index shares are in indexWatchers.test.ts.

const SHARED_FOCUS_FILE = "common/national_focus/shared.txt";
const sharedFocus = Buffer.from("shared_focus = { id = my_shared_focus }");

function closeDirty(): void {
	__testHandlers.onCloseTextDocument({ uri: workspaceFile(SHARED_FOCUS_FILE), isDirty: true } as unknown as vscode.TextDocument);
}

function logsInto(logs: string[], ...levels: ("error" | "warn")[]): void {
	for (const level of levels) {
		mock.method(Logger, level, (message: string) => {
			logs.push(message);
		});
	}
}

describe("util/sharedFocusIndex", () => {
	const world = useIndexWorld(__resetSharedFocusIndexForTests, { sharedFocusIndex: true });

	it("answers undefined for a focus nothing defines", async () => {
		assert.strictEqual(await findFileByFocusKey("nonexistent_key_123"), undefined);
	});

	// The web build and a remote install path both list without mtimes. The build has to fall back
	// to resolving and stat'ing each file, which is what it used to do for every file it listed.
	it("still dates its files the old way when the listing cannot", async () => {
		const resolved: string[] = [];
		mock.method(fileloader, "getFilePathFromModOrHOI4", async (relativePath: string) => {
			resolved.push(relativePath);
			return undefined;
		});
		world.list = () => listed(["shared.txt"]).map((entry) => ({ ...entry, mtime: undefined }));
		world.read = () => sharedFocus;

		assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);
		assert.deepStrictEqual(resolved, [SHARED_FOCUS_FILE, SHARED_FOCUS_FILE]);
	});

	describe("with one file in the workspace", () => {
		beforeEach(() => {
			world.list = (_root, half) => (half === "workspace" ? listed(["shared.txt"]) : []);
			world.read = () => sharedFocus;
		});

		// The build reads the old content and every read after it the new, so the ids in the index say
		// whether an event's re-read landed after the build's write or was overwritten by it.
		describe("incremental events vs. an in-flight build", () => {
			let read: Deferred<Buffer>;
			let lookup: Promise<string | undefined>;

			beforeEach(async () => {
				read = deferred<Buffer>();
				world.read = () => read.promise;
				lookup = findFileByFocusKey("my_shared_focus");
				await settle();
				world.read = () => Buffer.from("shared_focus = { id = renamed_shared_focus }");
			});

			async function settleBuild(): Promise<void> {
				read.resolve(sharedFocus);
				await lookup;
				await settle();
			}

			// Queued delete-then-create for the same path, as onRenameFiles would for a same-path
			// rename; if order were lost, the create could be clobbered by the earlier delete.
			it("preserves event ordering for events queued during a pending build", async () => {
				__testHandlers.onDeleteFiles({ files: [workspaceFile(SHARED_FOCUS_FILE)] });
				__testHandlers.onCreateFiles({ files: [workspaceFile(SHARED_FOCUS_FILE)] });
				await settleBuild();

				assert.strictEqual(await findFileByFocusKey("renamed_shared_focus"), SHARED_FOCUS_FILE);
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), undefined);
			});

			it("defers an onCloseTextDocument mutation the same way while a build is pending", async () => {
				closeDirty();
				await settleBuild();

				assert.strictEqual(await findFileByFocusKey("renamed_shared_focus"), SHARED_FOCUS_FILE);
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), undefined);
			});
		});

		// Issue #126: an edit used to clear the file's keys and only then start the re-parse. A focus
		// tree preview refreshing in that window -- which the same edit triggers, on the same
		// debounce -- resolved none of the file's shared focuses, so the joint branch vanished.
		describe("re-indexing an edited file", () => {
			beforeEach(async () => {
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);
			});

			it("keeps the file's focuses resolvable while its re-parse is still running", async () => {
				const read = deferred<Buffer>();
				world.read = () => read.promise;
				const readsBefore = world.reads;
				closeDirty();
				await settle();

				// The re-parse is still awaiting the read here.
				assert.strictEqual(world.reads, readsBefore + 1);
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);

				read.resolve(sharedFocus);
				await settle();
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);
			});

			it("swaps in the new ids and drops the old ones once the re-parse finishes", async () => {
				world.read = () => Buffer.from("shared_focus = { id = renamed_shared_focus }");
				closeDirty();
				await settle();

				assert.strictEqual(await findFileByFocusKey("renamed_shared_focus"), SHARED_FOCUS_FILE);
				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), undefined);
			});

			// An unreadable file is a warning, not an error: it costs that one file and the build (or
			// the re-index) carries on, so both channels are captured here.
			it("keeps the previously indexed ids when the file can't be read", async () => {
				const logs: string[] = [];
				logsInto(logs, "error", "warn");
				world.read = () => {
					throw new Error("file gone mid-edit");
				};
				closeDirty();
				await settle();

				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);
				assert.ok(logs.some((line) => line.includes("file gone mid-edit")));
			});

			it("keeps the previously indexed ids when the file doesn't parse midway through an edit", async () => {
				const logs: string[] = [];
				logsInto(logs, "error");
				mock.method(hoiparser, "parseHoi4File", () => {
					throw new Error("half-typed focus block");
				});
				closeDirty();
				await settle();

				assert.strictEqual(await findFileByFocusKey("my_shared_focus"), SHARED_FOCUS_FILE);
				assert.ok(logs.some((line) => line.includes("half-typed focus block")));
			});
		});
	});

	describe("parse failure logging", () => {
		let logs: string[];

		beforeEach(() => {
			logs = [];
			logsInto(logs, "error");
			world.list = (_root, half) => (half === "workspace" ? listed(["bad.txt"]) : []);
			world.read = () => Buffer.from("shared_focus = { id = bad }");
		});

		function parseThrows(thrown: unknown): void {
			mock.method(hoiparser, "parseHoi4File", () => {
				throw thrown;
			});
		}

		// The one line a failed file logs, after a lookup that builds the index.
		async function loggedLine(): Promise<string> {
			await findFileByFocusKey("bad");
			assert.strictEqual(logs.length, 1);
			return logs[0]!;
		}

		it("logs stack for an Error that has a stack", async () => {
			const err = new Error("boom");
			assert.ok(err.stack, "test pre-condition: Error must have a stack");
			parseThrows(err);

			const line = await loggedLine();
			for (const part of ["common/national_focus/bad.txt", "boom", err.stack!, "[Mod]"]) {
				assert.ok(line.includes(part), part);
			}
		});

		it("falls back to message when an Error has no stack", async () => {
			const err = new Error("no-stack");
			(err as unknown as Record<string, unknown>).stack = undefined;
			parseThrows(err);

			const line = await loggedLine();
			assert.ok(line.includes("common/national_focus/bad.txt"));
			assert.ok(line.includes("no-stack"));
			assert.ok(!line.includes("undefined"));
		});

		it("does not poison the index: a failed file leaves no entry", async () => {
			parseThrows("bad file");
			assert.strictEqual(await findFileByFocusKey("bad"), undefined);
			assert.strictEqual(logs.length, 1);
		});

		it("uses [Vanilla] prefix for the global build", async () => {
			world.list = (_root, half) => (half === "global" ? listed(["vanilla_bad.txt"]) : []);
			parseThrows(new Error("vanilla boom"));

			const line = await loggedLine();
			assert.ok(line.includes("[Vanilla]"));
			assert.ok(line.includes("common/national_focus/vanilla_bad.txt"));
		});
	});

	describe("disk cache", () => {
		// The two files the workspace listing reports, and what the manifest last recorded for them.
		const FRESH = "common/national_focus/fresh.txt";
		const STALE = "common/national_focus/stale.txt";

		// Eight files the manifest still names that the listing no longer reports. Together with the
		// one stale file that is stale + removed + added = 9 against a listing of 2, which is what the
		// old "fewer changes than files" guard rejected -- it would have re-parsed both from scratch.
		const REMOVED = Array.from({ length: 8 }, (_, i) => `common/national_focus/gone${i}.txt`);

		const MANIFEST = JSON.stringify({
			version: 2,
			entries: [FRESH, STALE, ...REMOVED].map((filePath) => ({ filePath, mtime: 1 })),
		});

		// One record per line, then the record count.
		const CACHED_RECORDS = [JSON.stringify([FRESH, ["cached_fresh"]]), JSON.stringify([STALE, ["cached_stale"]])];

		let parsedFiles: string[];

		// Only the workspace half has a cache on disk; the global half finds none.
		function cacheOnDisk(data: string): void {
			world.disk.set(world.cacheFile("sharedFocusIndex.workspace.manifest.json"), Buffer.from(MANIFEST));
			world.disk.set(world.cacheFile("sharedFocusIndex.workspace.data.jsonl"), Buffer.from(data));
		}

		beforeEach(() => {
			world.useDisk();
			cacheOnDisk([...CACHED_RECORDS, "2", ""].join("\n"));
			parsedFiles = [];
			world.list = (_root, half) => (half === "workspace" ? [...listed(["fresh.txt"], 1), ...listed(["stale.txt"], 2)] : []);
			// A distinct focus id per file, so an id in the index says which file produced it and
			// whether it came off the disk cache or out of the parser.
			world.read = (relativePath) => {
				parsedFiles.push(relativePath);
				return Buffer.from(`shared_focus = { id = parsed_${relativePath.replace(/^.*\/|\.txt$/g, "")} }`);
			};
		});

		it("reuses the cached entry for a file that has not changed, however much else has", async () => {
			assert.strictEqual(await findFileByFocusKey("cached_fresh"), FRESH);
			// Never read, so never parsed: the whole point of the cache.
			assert.deepStrictEqual(parsedFiles, [STALE]);
		});

		it("re-parses a file whose mtime moved and drops what the cache said about it", async () => {
			assert.strictEqual(await findFileByFocusKey("parsed_stale"), STALE);
			assert.strictEqual(await findFileByFocusKey("cached_stale"), undefined);
		});

		it("falls back to a full rebuild when the cached data is corrupted", async () => {
			cacheOnDisk("{ this is not json");

			assert.strictEqual(await findFileByFocusKey("parsed_fresh"), FRESH);
			assert.strictEqual(await findFileByFocusKey("parsed_stale"), STALE);
			assert.deepStrictEqual(parsedFiles.sort(), [FRESH, STALE]);
		});

		// Every line parses, but the count never made it to disk: the fresh file's record could just
		// as well have been the one lost, so none of it is trusted.
		it("falls back to a full rebuild when the cached data was cut short", async () => {
			cacheOnDisk(CACHED_RECORDS.join("\n") + "\n");

			assert.strictEqual(await findFileByFocusKey("parsed_fresh"), FRESH);
			assert.strictEqual(await findFileByFocusKey("cached_fresh"), undefined);
			assert.deepStrictEqual(parsedFiles.sort(), [FRESH, STALE]);
		});
	});
});
