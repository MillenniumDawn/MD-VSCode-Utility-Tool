import * as assert from "assert";
import {
	createIndexBuilder,
	withIndexProgress,
	__resetIndexProgressForTests,
} from "../util/indexBuild";
import { CancelledError } from "../util/common";
import { describeLiveIndexBuilds, IndexTimer } from "../util/indexCache";
import { Logger } from "../util/logger";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/indexBuild createIndexBuilder", function () {
	let logs: string[];
	let originalInfo: (message: string) => void;
	let originalError: (message: string) => void;

	beforeEach(function () {
		stubVscode({});
		logs = [];
		originalInfo = Logger.info;
		originalError = Logger.error;
		Logger.info = (message: string) => {
			logs.push(message);
		};
		Logger.error = (message: string) => {
			logs.push(message);
		};
	});

	afterEach(function () {
		Logger.info = originalInfo;
		Logger.error = originalError;
		restoreVscodeStubs();
		// The deadline test parks on a promise that never settles, so its build never leaves the
		// progress session. Left alone it would stay open and a later test would join it.
		__resetIndexProgressForTests();
	});

	it("builds once and hands every later caller the same build", async function () {
		let builds = 0;
		const builder = createIndexBuilder({
			name: "test",
			message: "building",
			build: async () => {
				builds++;
				return "done";
			},
		});

		assert.strictEqual(builder.hasStarted(), false);
		const [a, b] = await Promise.all([
			builder.ensureBuilt(),
			builder.ensureBuilt(),
		]);

		assert.strictEqual(a, "done");
		assert.strictEqual(b, "done");
		assert.strictEqual(builds, 1);
		assert.strictEqual(builder.hasStarted(), true);
	});

	// The bug behind "the extension is stuck indexing": a build that failed stayed memoized for the
	// rest of the session, so every later lookup silently read a half-built index and never retried.
	it("retries after a failed build instead of memoizing the failure", async function () {
		let builds = 0;
		const builder = createIndexBuilder({
			name: "test",
			message: "building",
			build: async () => {
				builds++;
				if (builds === 1) {
					throw new Error("listing failed");
				}
				return "done";
			},
		});

		await assert.rejects(builder.ensureBuilt(), /listing failed/);
		await waitForAsyncTasks();
		assert.strictEqual(builder.hasStarted(), false);

		assert.strictEqual(await builder.ensureBuilt(), "done");
		assert.strictEqual(builds, 2);
	});

	it("logs the failure with the index name", async function () {
		const builder = createIndexBuilder({
			name: "myIndex",
			message: "building",
			build: async () => {
				throw new Error("listing failed");
			},
		});

		await builder.ensureBuilt().catch(() => undefined);
		await waitForAsyncTasks();

		assert.ok(
			logs.some(
				(l) => l === "[Index] myIndex: build failed: Error: listing failed",
			),
		);
	});

	// Nothing cancels the work yet, so the point of the deadline is only that callers stop waiting.
	it("stops waiting on a build that overruns the deadline", async function () {
		const never = deferred<string>();
		const builder = createIndexBuilder({
			name: "slow",
			message: "building",
			build: () => never.promise,
			timeout: 20,
		});

		await assert.rejects(builder.ensureBuilt(), /timed out/);

		// The work was still running, so the memo must not have been cleared -- clearing it would
		// start a second build behind the first.
		assert.strictEqual(builder.hasStarted(), true);

		// And when it does finish, later callers get the result rather than the timeout.
		never.resolve("late");
		await waitForAsyncTasks();
		assert.strictEqual(await builder.ensureBuilt(), "late");
	});

	// The point of making the work cancellable: a cancelled build must leave nothing behind, or the
	// next lookup would serve whatever half-built index the cancel interrupted.
	it("starts a fresh build after a cancelled one rather than reusing it", async function () {
		let builds = 0;
		const builder = createIndexBuilder({
			name: "cancelled",
			message: "building",
			build: async () => {
				builds++;
				if (builds === 1) {
					throw new CancelledError();
				}
				return "done";
			},
		});

		await assert.rejects(
			builder.ensureBuilt(),
			(cause: unknown) => cause instanceof CancelledError,
		);
		await waitForAsyncTasks();
		assert.strictEqual(builder.hasStarted(), false);

		assert.strictEqual(await builder.ensureBuilt(), "done");
		assert.strictEqual(builds, 2);
	});

	it("hands the build the cancellation token from its progress notification", async function () {
		stubVscode({
			withProgress: (_options: unknown, task: any) =>
				task({ report: () => undefined }, { isCancellationRequested: true }),
		});

		let sawCancellation: boolean | undefined;
		const builder = createIndexBuilder({
			name: "tokened",
			message: "building",
			build: async (progress) => {
				sawCancellation = progress.token.isCancellationRequested;
				return "done";
			},
		});

		await builder.ensureBuilt();
		assert.strictEqual(sawCancellation, true);
	});

	it("reports a build that is still running, and stops once it ends", function () {
		const timer = new IndexTimer("test.workspace");
		try {
			assert.deepStrictEqual(describeLiveIndexBuilds(), []);

			timer.begin("parse");
			timer.progress(3, 10);
			const live = describeLiveIndexBuilds();
			assert.strictEqual(live.length, 1);
			assert.ok(
				live[0]!.startsWith("test.workspace phase=parse 3/10 for "),
				live[0],
			);

			timer.end(10, 10);
			assert.deepStrictEqual(describeLiveIndexBuilds(), []);
		} finally {
			timer.dispose();
		}
	});
});

describe("util/indexBuild withIndexProgress", function () {
	interface ProgressCall {
		options: { title?: string; cancellable?: boolean; location?: unknown };
		messages: (string | undefined)[];
		settled: boolean;
	}

	let calls: ProgressCall[];
	let clock: number;

	beforeEach(function () {
		calls = [];
		// Reports are throttled on the wall clock, so drive it: every read moves a full interval on,
		// which keeps each report in these tests a render rather than a suppressed one.
		clock = 0;
		stubVscode({
			now: () => (clock += 1000),
			withProgress: (options: any, task: any) => {
				const call: ProgressCall = { options, messages: [], settled: false };
				calls.push(call);
				const result = task(
					{
						report: (value: { message?: string }) => {
							call.messages.push(value.message);
						},
					},
					{ isCancellationRequested: false },
				);
				void result.then(
					() => {
						call.settled = true;
					},
					() => {
						call.settled = true;
					},
				);
				return result;
			},
		});
	});

	afterEach(function () {
		restoreVscodeStubs();
		__resetIndexProgressForTests();
	});

	// Six builds start together on the first preview of a session. One notification for all of them
	// is the whole point -- the status bar messages this replaced stacked.
	it("shares one notification between overlapping builds and closes it once", async function () {
		const first = deferred<void>();
		const second = deferred<void>();

		const a = withIndexProgress("Building A...", async (progress) => {
			progress.report(1, 10);
			await first.promise;
		});
		const b = withIndexProgress("Building B...", async (progress) => {
			progress.report(2, 20);
			await second.promise;
		});

		await waitForAsyncTasks();
		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0]!.options.cancellable, true);
		assert.strictEqual(calls[0]!.settled, false);

		// Both builds' counts, under one message.
		assert.ok(
			calls[0]!.messages.includes("2 indexes — 3 / 30 files"),
			calls[0]!.messages.join(" | "),
		);

		first.resolve();
		await a;
		await waitForAsyncTasks();
		// One build left, so it gets named rather than counted -- and the toast is still open.
		assert.strictEqual(calls[0]!.settled, false);
		assert.strictEqual(
			calls[0]!.messages[calls[0]!.messages.length - 1],
			"Building B... — 2 / 20 files",
		);

		second.resolve();
		await b;
		await waitForAsyncTasks();
		assert.strictEqual(calls[0]!.settled, true);
		assert.strictEqual(calls.length, 1);
	});

	it("opens a fresh notification once the previous one has closed", async function () {
		await withIndexProgress("Building A...", async () => undefined);
		await withIndexProgress("Building B...", async () => undefined);

		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0]!.settled, true);
		assert.strictEqual(calls[1]!.settled, true);
	});

	// Reporting per parsed file would put thousands of messages across to the renderer, on the very
	// channel this change exists to keep clear.
	it("collapses a burst of reports instead of sending one per file", async function () {
		stubVscode({
			now: () => 5_000,
			withProgress: (options: any, task: any) => {
				const call: ProgressCall = { options, messages: [], settled: false };
				calls.push(call);
				return task(
					{
						report: (value: { message?: string }) => {
							call.messages.push(value.message);
						},
					},
					{ isCancellationRequested: false },
				);
			},
		});

		await withIndexProgress("Building A...", async (progress) => {
			for (let i = 1; i <= 100; i++) {
				progress.report(i, 100);
			}
		});

		// Just the one render for joining: with the clock held still, all 100 reports fall inside a
		// single interval and collapse into it. (The first test covers the counts getting through
		// once time moves.)
		assert.deepStrictEqual(calls[0]!.messages, [undefined]);
	});

	it("closes the notification when a build fails", async function () {
		await assert.rejects(
			withIndexProgress("Building A...", async () => {
				throw new Error("build failed");
			}),
			/build failed/,
		);
		await waitForAsyncTasks();

		assert.strictEqual(calls.length, 1);
		assert.strictEqual(calls[0]!.settled, true);
	});
});
