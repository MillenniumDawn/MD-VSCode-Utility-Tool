import * as assert from "assert";
import * as vscode from "vscode";
import * as featureflags from "../util/featureflags";
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
});
