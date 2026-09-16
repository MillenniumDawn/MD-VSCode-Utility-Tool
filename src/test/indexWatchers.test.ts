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

// Changing `parentModPaths` rebuilds the parent half and only that; a folder change rebuilds the
// workspace half and only that. Driven through register(), because that is where the configuration
// event is wired up.
describe("util/indexWatchers parentModPaths change", function () {
	let resets: number;
	let rebuilds: number;
	let parentResets: number;
	let parentRebuilds: number;
	let configurationHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
	let handlers: ReturnType<typeof createIndexWatchers>["handlers"];

	beforeEach(function () {
		resets = 0;
		rebuilds = 0;
		parentResets = 0;
		parentRebuilds = 0;
		configurationHandler = undefined;
		stubVscode({
			onDidChangeConfiguration: (handler: (e: vscode.ConfigurationChangeEvent) => void) => {
				configurationHandler = handler;
				return { dispose: () => undefined };
			},
		});
		const watchers = createIndexWatchers({
			enabled: true,
			extension: ".txt",
			hasStarted: () => true,
			gate: createBuildGate(),
			reindexFile: () => undefined,
			removeFile: () => undefined,
			rebuildWorkspace: {
				reset: () => {
					resets++;
				},
				build: async () => {
					rebuilds++;
				},
				message: "Building workspace index...",
				telemetryEvent: "testIndex.workspace",
				failureMessage: "Building workspace index failed.",
			},
			rebuildParent: {
				reset: () => {
					parentResets++;
				},
				build: async () => {
					parentRebuilds++;
				},
			},
		});
		handlers = watchers.handlers;
		watchers.register();
	});

	afterEach(function () {
		restoreVscodeStubs();
		__resetIndexProgressForTests();
	});

	function configurationChanged(section: string): vscode.ConfigurationChangeEvent {
		return { affectsConfiguration: (s: string) => s === section };
	}

	it("rebuilds the parent half, and leaves the workspace half alone, when the parent mod paths change", async function () {
		assert.ok(configurationHandler, "register() should subscribe to configuration changes");
		configurationHandler!(configurationChanged("mdHoi4Utilities.parentModPaths"));
		await waitForAsyncTasks();

		assert.strictEqual(parentResets, 1);
		assert.strictEqual(parentRebuilds, 1);
		assert.strictEqual(resets, 0);
		assert.strictEqual(rebuilds, 0);
	});

	it("leaves the parent half alone when a workspace folder changes", async function () {
		handlers.onChangeWorkspaceFolders({ added: [], removed: [] });
		await waitForAsyncTasks();

		assert.strictEqual(resets, 1);
		assert.strictEqual(rebuilds, 1);
		assert.strictEqual(parentResets, 0);
		assert.strictEqual(parentRebuilds, 0);
	});

	it("ignores every other setting", async function () {
		configurationHandler!(configurationChanged("mdHoi4Utilities.modFile"));
		await waitForAsyncTasks();

		assert.strictEqual(resets, 0);
		assert.strictEqual(rebuilds, 0);
		assert.strictEqual(parentRebuilds, 0);
	});
});
