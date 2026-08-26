import * as assert from "assert";
import {
	appendEntriesWithErrorLogging,
	attachTaskWithErrorLogging,
	createBuildGate,
} from "../util/promiseUtils";

function deferred(): {
	promise: Promise<void>;
	resolve: () => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: () => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = () => res();
		reject = rej;
	});
	return { promise, resolve, reject };
}

function waitForAsyncTasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

describe("util/promiseUtils", () => {
	it("logs rejected task failures with context", async () => {
		const logs: string[] = [];

		attachTaskWithErrorLogging(
			Promise.reject(new Error("task failed")),
			() => {
				throw new Error("success callback must not run");
			},
			"build failed",
			(message) => logs.push(message),
		);

		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual(logs.length, 1);
		assert.strictEqual(logs[0], "build failed: Error: task failed");
	});

	it("runs onSuccess and skips logger on successful tasks", async () => {
		const logs: string[] = [];
		let ran = false;

		attachTaskWithErrorLogging(
			Promise.resolve("ok"),
			() => {
				ran = true;
			},
			"should not log",
			(message) => logs.push(message),
		);

		await new Promise((resolve) => setImmediate(resolve));

		assert.strictEqual(ran, true);
		assert.deepStrictEqual(logs, []);
	});

	it("logs and swallows append failures while keeping existing entries", async () => {
		const target: string[] = ["good"];
		const logs: string[] = [];

		await appendEntriesWithErrorLogging(
			target,
			async () => {
				throw new Error("read failed");
			},
			"could not read",
			(message) => logs.push(message),
		);

		assert.deepStrictEqual(target, ["good"]);
		assert.strictEqual(logs.length, 1);
		assert.strictEqual(logs[0], "could not read: Error: read failed");
	});

	it("appends entries when listEntries succeeds", async () => {
		const target: string[] = ["good"];
		const logs: string[] = [];

		await appendEntriesWithErrorLogging(
			target,
			async () => ["one", "two"],
			"should not fail",
			(message) => logs.push(message),
		);

		assert.deepStrictEqual(target, ["good", "one", "two"]);
		assert.deepStrictEqual(logs, []);
	});
});

describe("util/promiseUtils createBuildGate", () => {
	it("does nothing when runAfterBuild is called before start", () => {
		const gate = createBuildGate();
		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});
		assert.strictEqual(ran, false);
	});

	it("defers a handler until the current build settles", async () => {
		const gate = createBuildGate();
		const build = deferred();
		gate.start(build.promise);

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});
		assert.strictEqual(ran, false);

		build.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, true);
	});

	it("runs a handler immediately once the current build has already settled", async () => {
		const gate = createBuildGate();
		gate.start(Promise.resolve());
		await waitForAsyncTasks();

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});
		assert.strictEqual(ran, true);
	});

	it("runs a deferred handler when the current build rejects", async () => {
		const gate = createBuildGate();
		const build = deferred();
		gate.start(build.promise);

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});

		build.reject(new Error("build failed"));
		await waitForAsyncTasks();
		assert.strictEqual(ran, true);
	});

	it("does not treat a replaced task as settled when the old one finishes", async () => {
		const gate = createBuildGate();
		const first = deferred();
		const second = deferred();
		gate.start(first.promise);
		gate.start(second.promise);

		first.resolve();
		await waitForAsyncTasks();

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});
		assert.strictEqual(ran, false);

		second.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, true);
	});

	it("re-waits when a handler was queued on a task that got replaced", async () => {
		const gate = createBuildGate();
		const first = deferred();
		const second = deferred();
		gate.start(first.promise);

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});
		gate.start(second.promise);

		first.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, false);

		second.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, true);
	});

	it("followOn waits for the current build before running the next one", async () => {
		const gate = createBuildGate();
		const first = deferred();
		gate.start(first.promise);

		let started = false;
		const second = deferred();
		gate.followOn(() => {
			started = true;
			return second.promise;
		});
		assert.strictEqual(started, false);

		first.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(started, true);
	});

	it("followOn occupies the gate immediately so later handlers wait for the follow-on", async () => {
		const gate = createBuildGate();
		const first = deferred();
		gate.start(first.promise);

		const second = deferred();
		gate.followOn(() => second.promise);

		let ran = false;
		gate.runAfterBuild(() => {
			ran = true;
		});

		first.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, false);

		second.resolve();
		await waitForAsyncTasks();
		assert.strictEqual(ran, true);
	});
});
