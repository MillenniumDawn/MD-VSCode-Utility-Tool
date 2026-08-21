import * as assert from "assert";
import { createIndexBuilder } from "../util/indexBuild";
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
