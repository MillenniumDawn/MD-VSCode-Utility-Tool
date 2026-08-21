import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
import { Logger } from "../util/logger";
import {
	findFileByFocusKey,
	registerSharedFocusIndex,
	__resetSharedFocusIndexForTests,
	__testHandlers,
} from "../util/sharedFocusIndex";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

describe("util/sharedFocusIndex", () => {
	it("findFileByFocusKey returns undefined for unknown key", async () => {
		assert.strictEqual(
			await findFileByFocusKey("nonexistent_key_123"),
			undefined,
		);
	});

	it("registerSharedFocusIndex returns a disposable", () => {
		const disposable = registerSharedFocusIndex();
		assert.ok(disposable);
		assert.strictEqual(typeof disposable.dispose, "function");
		disposable.dispose();
	});
});

type FileloaderModule = {
	listFilesFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean; recursively?: boolean },
	) => Promise<string[]>;
	readFileFromModOrHOI4: (
		relativePath: string,
		options?: { mod?: boolean; hoi4?: boolean },
	) => Promise<[Buffer, unknown]>;
};

const fileloader = require("../util/fileloader") as FileloaderModule;

const SHARED_FOCUS_FILE_CONTENT = Buffer.from(
	"shared_focus = { id = my_shared_focus }",
);

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

function focusFileUri(relativePath: string): vscode.Uri {
	const fullPath = "/ws/" + relativePath;
	return {
		path: fullPath,
		scheme: "file",
		toString: () => "file://" + fullPath,
	} as unknown as vscode.Uri;
}

describe("util/sharedFocusIndex lazy build", function () {
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let listFilesCallCount: number;

	beforeEach(function () {
		__resetSharedFocusIndexForTests();
		stubVscode({
			getConfiguration: () => ({ sharedFocusIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		featureflags.refreshFeatureFlags();

		listFilesCallCount = 0;
		originalListFiles = fileloader.listFilesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;

		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async () => {
			listFilesCallCount++;
			return ["shared.txt"];
		};
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [
			SHARED_FOCUS_FILE_CONTENT,
			{} as unknown,
		];
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = originalListFiles;
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = originalReadFile;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetSharedFocusIndexForTests();
	});

	it("does no build work when registered", async function () {
		const disposable = registerSharedFocusIndex();
		await waitForAsyncTasks();

		assert.strictEqual(listFilesCallCount, 0);
		disposable.dispose();
	});

	it("does no build work when the feature flag is off", async function () {
		stubVscode({ getConfiguration: () => ({ sharedFocusIndex: false }) });
		featureflags.refreshFeatureFlags();

		const result = await findFileByFocusKey("my_shared_focus");

		assert.strictEqual(result, undefined);
		assert.strictEqual(listFilesCallCount, 0);
	});

	it("builds the index exactly once for concurrent first lookups, then serves later lookups from it", async function () {
		const [first, second] = await Promise.all([
			findFileByFocusKey("my_shared_focus"),
			findFileByFocusKey("my_shared_focus"),
		]);

		// One list call for the global build, one for the workspace build; a duplicate build would double these.
		assert.strictEqual(listFilesCallCount, 2);
		assert.strictEqual(first, "common/national_focus/shared.txt");
		assert.strictEqual(second, "common/national_focus/shared.txt");

		const third = await findFileByFocusKey("my_shared_focus");
		assert.strictEqual(third, "common/national_focus/shared.txt");
		assert.strictEqual(listFilesCallCount, 2);
	});

	describe("incremental events vs. an in-flight build", function () {
		// The global (vanilla) build shares the same stubbed listFilesFromModOrHOI4/readFileFromModOrHOI4
		// as the workspace (mod) build. Route "shared.txt" into the workspace build only, so
		// findFileByFocusKey's fallback to the global index can't mask a workspace-only mutation.
		beforeEach(function () {
			(
				fileloader as typeof fileloader & {
					listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
				}
			).listFilesFromModOrHOI4 = async (_relativePath, options) => {
				listFilesCallCount++;
				return options?.hoi4 ? [] : ["shared.txt"];
			};
		});

		it("ignores incremental events that arrive before any build has started", async function () {
			__testHandlers.onDeleteFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});
			__testHandlers.onCreateFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});
			await waitForAsyncTasks();

			// No build was ever started, so the events must not have touched fileloader at all.
			assert.strictEqual(listFilesCallCount, 0);

			const result = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(result, "common/national_focus/shared.txt");
		});

		it("defers an event that arrives while the build is pending, and applies it once the build settles", async function () {
			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			const lookup = findFileByFocusKey("my_shared_focus");
			await waitForAsyncTasks();

			// Fired while the build is still awaiting readFileFromModOrHOI4, before it has written
			// anything into the index.
			__testHandlers.onDeleteFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});

			read.resolve([SHARED_FOCUS_FILE_CONTENT, {} as unknown]);
			await lookup;
			await waitForAsyncTasks();

			// If the delete had run immediately (the bug), it would have been a no-op against the
			// still-empty index, and the build's later write would have clobbered it. Deferred, the
			// delete runs after the build's write and actually removes the entry.
			const result = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(result, undefined);
		});

		it("applies an event immediately once the build has already settled", async function () {
			const primed = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(primed, "common/national_focus/shared.txt");

			__testHandlers.onDeleteFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});

			const result = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(result, undefined);
		});

		it("preserves event ordering for events queued during a pending build", async function () {
			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			const lookup = findFileByFocusKey("my_shared_focus");
			await waitForAsyncTasks();

			// Queued delete-then-create for the same path, as onRenameFiles would for a same-path
			// rename; if order were lost, the create could be clobbered by the earlier delete.
			__testHandlers.onDeleteFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});
			__testHandlers.onCreateFiles({
				files: [focusFileUri("common/national_focus/shared.txt")],
			});

			read.resolve([SHARED_FOCUS_FILE_CONTENT, {} as unknown]);
			await lookup;
			await waitForAsyncTasks();

			const result = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(result, "common/national_focus/shared.txt");
		});

		it("defers an onCloseTextDocument mutation the same way while a build is pending", async function () {
			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			const lookup = findFileByFocusKey("my_shared_focus");
			await waitForAsyncTasks();

			__testHandlers.onCloseTextDocument({
				uri: focusFileUri("common/national_focus/shared.txt"),
				isDirty: true,
			} as unknown as vscode.TextDocument);

			read.resolve([SHARED_FOCUS_FILE_CONTENT, {} as unknown]);
			await lookup;
			await waitForAsyncTasks();

			const result = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(result, "common/national_focus/shared.txt");
		});
	});

	// Issue #126: an edit used to clear the file's keys and only then start the re-parse. A focus
	// tree preview refreshing in that window -- which the same edit triggers, on the same debounce --
	// resolved none of the file's shared focuses, so the joint branch vanished from the tree.
	describe("re-indexing an edited file", function () {
		beforeEach(function () {
			(
				fileloader as typeof fileloader & {
					listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
				}
			).listFilesFromModOrHOI4 = async (_relativePath, options) => {
				listFilesCallCount++;
				return options?.hoi4 ? [] : ["shared.txt"];
			};
		});

		it("keeps the file's focuses resolvable while its re-parse is still running", async function () {
			const primed = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(primed, "common/national_focus/shared.txt");

			const read = deferred<[Buffer, unknown]>();
			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = () => read.promise;

			__testHandlers.onCloseTextDocument({
				uri: focusFileUri("common/national_focus/shared.txt"),
				isDirty: true,
			} as unknown as vscode.TextDocument);
			await waitForAsyncTasks();

			// The re-parse is still awaiting the read here.
			const duringReindex = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(duringReindex, "common/national_focus/shared.txt");

			read.resolve([SHARED_FOCUS_FILE_CONTENT, {} as unknown]);
			await waitForAsyncTasks();

			const afterReindex = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(afterReindex, "common/national_focus/shared.txt");
		});

		it("swaps in the new ids and drops the old ones once the re-parse finishes", async function () {
			const primed = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(primed, "common/national_focus/shared.txt");

			(
				fileloader as typeof fileloader & {
					readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
				}
			).readFileFromModOrHOI4 = async () => [
				Buffer.from("shared_focus = { id = renamed_shared_focus }"),
				{} as unknown,
			];

			__testHandlers.onCloseTextDocument({
				uri: focusFileUri("common/national_focus/shared.txt"),
				isDirty: true,
			} as unknown as vscode.TextDocument);
			await waitForAsyncTasks();

			assert.strictEqual(
				await findFileByFocusKey("renamed_shared_focus"),
				"common/national_focus/shared.txt",
			);
			assert.strictEqual(await findFileByFocusKey("my_shared_focus"), undefined);
		});

		it("keeps the previously indexed ids when the file can't be read", async function () {
			const primed = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(primed, "common/national_focus/shared.txt");

			// An unreadable file is a warning, not an error: it costs that one file and the build
			// (or the re-index) carries on, so both channels are captured here.
			const logs: string[] = [];
			const originalLoggerError = Logger.error;
			const originalLoggerWarn = Logger.warn;
			Logger.error = (message: string) => {
				logs.push(message);
			};
			Logger.warn = (message: string) => {
				logs.push(message);
			};

			try {
				(
					fileloader as typeof fileloader & {
						readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
					}
				).readFileFromModOrHOI4 = async () => {
					throw new Error("file gone mid-edit");
				};

				__testHandlers.onCloseTextDocument({
					uri: focusFileUri("common/national_focus/shared.txt"),
					isDirty: true,
				} as unknown as vscode.TextDocument);
				await waitForAsyncTasks();

				assert.strictEqual(
					await findFileByFocusKey("my_shared_focus"),
					"common/national_focus/shared.txt",
				);
				assert.ok(logs.some((l) => l.includes("file gone mid-edit")));
			} finally {
				Logger.error = originalLoggerError;
				Logger.warn = originalLoggerWarn;
			}
		});

		it("keeps the previously indexed ids when the file doesn't parse midway through an edit", async function () {
			const primed = await findFileByFocusKey("my_shared_focus");
			assert.strictEqual(primed, "common/national_focus/shared.txt");

			const hoiparser =
				require("../hoiformat/hoiparser") as typeof import("../hoiformat/hoiparser");
			const originalParseHoi4File = hoiparser.parseHoi4File;
			const originalLoggerError = Logger.error;
			Logger.error = () => undefined;

			try {
				(
					hoiparser as typeof hoiparser & {
						parseHoi4File: typeof hoiparser.parseHoi4File;
					}
				).parseHoi4File = () => {
					throw new Error("half-typed focus block");
				};

				__testHandlers.onCloseTextDocument({
					uri: focusFileUri("common/national_focus/shared.txt"),
					isDirty: true,
				} as unknown as vscode.TextDocument);
				await waitForAsyncTasks();

				assert.strictEqual(
					await findFileByFocusKey("my_shared_focus"),
					"common/national_focus/shared.txt",
				);
			} finally {
				(
					hoiparser as typeof hoiparser & {
						parseHoi4File: typeof hoiparser.parseHoi4File;
					}
				).parseHoi4File = originalParseHoi4File;
				Logger.error = originalLoggerError;
			}
		});
	});
});

describe("util/sharedFocusIndex parse failure logging", function () {
	let originalListFiles: FileloaderModule["listFilesFromModOrHOI4"];
	let originalReadFile: FileloaderModule["readFileFromModOrHOI4"];
	let originalLoggerError: typeof Logger.error;
	let logs: string[];
	let originalParseHoi4File: typeof import("../hoiformat/hoiparser").parseHoi4File;

	beforeEach(function () {
		__resetSharedFocusIndexForTests();
		stubVscode({
			getConfiguration: () => ({ sharedFocusIndex: true }),
			getWorkspaceFolder: () => WORKSPACE_FOLDER,
		});
		featureflags.refreshFeatureFlags();

		logs = [];
		originalLoggerError = Logger.error;
		Logger.error = (message: string) => {
			logs.push(message);
		};

		originalListFiles = fileloader.listFilesFromModOrHOI4;
		originalReadFile = fileloader.readFileFromModOrHOI4;
		// Route the file into the workspace (mod) build so hoi4:true does not mask it.
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async (_relativePath, options) =>
			options?.hoi4 ? [] : ["bad.txt"];
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = async () => [
			Buffer.from("shared_focus = { id = bad }"),
			{} as unknown,
		];

		const hoiparser = require("../hoiformat/hoiparser") as typeof import("../hoiformat/hoiparser");
		originalParseHoi4File = hoiparser.parseHoi4File;
	});

	afterEach(function () {
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = originalListFiles;
		(
			fileloader as typeof fileloader & {
				readFileFromModOrHOI4: FileloaderModule["readFileFromModOrHOI4"];
			}
		).readFileFromModOrHOI4 = originalReadFile;
		const hoiparser = require("../hoiformat/hoiparser") as typeof import("../hoiformat/hoiparser");
		hoiparser.parseHoi4File = originalParseHoi4File;
		Logger.error = originalLoggerError;
		restoreVscodeStubs();
		featureflags.refreshFeatureFlags();
		__resetSharedFocusIndexForTests();
	});

	function stubParseToThrow(thrown: unknown) {
		const hoiparser = require("../hoiformat/hoiparser") as typeof import("../hoiformat/hoiparser");
		hoiparser.parseHoi4File = () => {
			throw thrown;
		};
	}

	it("logs stack for an Error that has a stack", async function () {
		const err = new Error("boom");
		assert.ok(err.stack, "test pre-condition: Error must have a stack");
		stubParseToThrow(err);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("common/national_focus/bad.txt"));
		assert.ok(logs[0].includes("boom"));
		assert.ok(logs[0].includes(err.stack!));
		assert.ok(logs[0].includes("[Mod]"));
	});

	it("falls back to message when an Error has no stack", async function () {
		const err = new Error("no-stack");
		(err as unknown as Record<string, unknown>).stack = undefined;
		stubParseToThrow(err);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("common/national_focus/bad.txt"));
		assert.ok(logs[0].includes("no-stack"));
		assert.ok(!logs[0].includes("undefined"));
	});

	it("falls back to message when an Error has an empty stack", async function () {
		const err = new Error("empty-stack");
		(err as unknown as Record<string, unknown>).stack = "";
		stubParseToThrow(err);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("empty-stack"));
	});

	it("logs String(e) for a thrown string", async function () {
		stubParseToThrow("plain old string");

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("common/national_focus/bad.txt"));
		assert.ok(logs[0].includes("plain old string"));
	});

	for (const thrown of [42, null, undefined, 0] as const) {
		it(`logs String(e) for thrown ${String(thrown)}`, async function () {
			stubParseToThrow(thrown);

			await findFileByFocusKey("bad");

			assert.strictEqual(logs.length, 1);
			assert.ok(logs[0].includes(String(thrown)));
		});
	}

	it("logs String(e) for a thrown object", async function () {
		const obj = { toString: () => "custom-obj" };
		stubParseToThrow(obj);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("custom-obj"));
	});

	it("logs String(e) for a thrown Symbol", async function () {
		const sym = Symbol("sym");
		stubParseToThrow(sym);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes(String(sym)));
	});

	it("falls back to Object.prototype.toString when String(e) throws", async function () {
		const evil = {
			toString() {
				throw new Error("inner");
			},
		};
		stubParseToThrow(evil);

		await findFileByFocusKey("bad");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("[object Object]"));
	});

	it("does not poison the index: a failed file leaves no entry", async function () {
		stubParseToThrow("bad file");

		const result = await findFileByFocusKey("bad");

		assert.strictEqual(result, undefined);
		assert.strictEqual(logs.length, 1);
	});

	it("uses [Vanilla] prefix for the global build", async function () {
		// Re-route to the global (hoi4) build instead of workspace.
		(
			fileloader as typeof fileloader & {
				listFilesFromModOrHOI4: FileloaderModule["listFilesFromModOrHOI4"];
			}
		).listFilesFromModOrHOI4 = async (_relativePath, options) =>
			options?.hoi4 ? ["vanilla_bad.txt"] : [];
		stubParseToThrow(new Error("vanilla boom"));

		await findFileByFocusKey("anything");

		assert.strictEqual(logs.length, 1);
		assert.ok(logs[0].includes("[Vanilla]"));
		assert.ok(logs[0].includes("common/national_focus/vanilla_bad.txt"));
	});
});
