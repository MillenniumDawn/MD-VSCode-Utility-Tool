import * as assert from "assert";
import {
	appendEntriesWithErrorLogging,
	attachTaskWithErrorLogging,
} from "../util/promiseUtils";

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
