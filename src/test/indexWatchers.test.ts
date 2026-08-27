import * as assert from "assert";
import * as vscode from "vscode";
import { __resetIndexProgressForTests } from "../util/indexBuild";
import { createIndexWatchers } from "../util/indexWatchers";
import { createBuildGate } from "../util/promiseUtils";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

function deferred(): {
	promise: Promise<void>;
	resolve: () => void;
} {
	let resolve!: () => void;
	const promise = new Promise<void>((res) => {
		resolve = () => res();
	});
	return { promise, resolve };
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function fileUri(relative: string): vscode.Uri {
	return vscode.Uri.file(`/workspace/${relative}`);
}

describe("util/indexWatchers folder-change rebuild", function () {
	let resets: number;
	let rebuilds: number;
	let removed: string[];
	let rebuild: ReturnType<typeof deferred>;
	let started: boolean;
	let gate: ReturnType<typeof createBuildGate>;
	let handlers: ReturnType<typeof createIndexWatchers>["handlers"];

	beforeEach(function () {
		stubVscode({});
		resets = 0;
		rebuilds = 0;
		removed = [];
		rebuild = deferred();
		started = true;
		gate = createBuildGate();
		handlers = createIndexWatchers({
			enabled: true,
			extension: ".txt",
			hasStarted: () => started,
			gate,
			reindexFile: () => undefined,
			removeFile: (file) => {
				removed.push(file.path);
			},
			rebuildWorkspace: {
				reset: () => {
					resets++;
				},
				build: async () => {
					rebuilds++;
					await rebuild.promise;
				},
				message: "Building workspace index...",
				telemetryEvent: "testIndex.workspace",
				failureMessage: "Building workspace index failed.",
			},
		}).handlers;
	});

	afterEach(function () {
		restoreVscodeStubs();
		__resetIndexProgressForTests();
	});

	it("ignores a folder change that arrives before any build has started", async function () {
		started = false;
		handlers.onChangeWorkspaceFolders({
			added: [],
			removed: [],
		});
		await waitForAsyncTasks();

		assert.strictEqual(resets, 0);
		assert.strictEqual(rebuilds, 0);
	});

	it("does not reset until a pending initial build has settled", async function () {
		const initial = deferred();
		gate.start(initial.promise);

		handlers.onChangeWorkspaceFolders({
			added: [],
			removed: [],
		});
		await waitForAsyncTasks();
		assert.strictEqual(resets, 0);
		assert.strictEqual(rebuilds, 0);

		initial.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(resets, 1);
		assert.strictEqual(rebuilds, 1);
	});

	it("defers an incremental event that arrives during the folder-change rebuild", async function () {
		gate.start(Promise.resolve());
		await waitForAsyncTasks();

		handlers.onChangeWorkspaceFolders({
			added: [],
			removed: [],
		});
		await waitForAsyncTasks();
		assert.strictEqual(resets, 1);
		assert.strictEqual(rebuilds, 1);

		handlers.onDeleteFiles({
			files: [fileUri("common/national_focus/shared.txt")],
		});
		await waitForAsyncTasks();
		assert.deepStrictEqual(removed, []);

		rebuild.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(removed.length, 1);
	});

	it("applies an incremental event immediately once the folder-change rebuild has settled", async function () {
		gate.start(Promise.resolve());
		await waitForAsyncTasks();

		handlers.onChangeWorkspaceFolders({
			added: [],
			removed: [],
		});
		rebuild.resolve();
		await waitForAsyncTasks();

		handlers.onDeleteFiles({
			files: [fileUri("common/national_focus/shared.txt")],
		});
		assert.strictEqual(removed.length, 1);
	});

	it("defers an event queued on the initial build until the folder-change rebuild settles", async function () {
		const initial = deferred();
		gate.start(initial.promise);

		handlers.onDeleteFiles({
			files: [fileUri("common/national_focus/shared.txt")],
		});
		handlers.onChangeWorkspaceFolders({
			added: [],
			removed: [],
		});

		initial.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(resets, 1);
		assert.deepStrictEqual(removed, []);

		rebuild.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(removed.length, 1);
	});
});
