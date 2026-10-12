import * as assert from "assert";
import {
	appendEntriesWithErrorLogging,
	attachTaskWithErrorLogging,
	createBuildGate,
} from "../../../util/promiseUtils";
import { deferred, settle } from "../async";

describe("util/promiseUtils", () => {
	describe("attachTaskWithErrorLogging", () => {
		// [what happens, the task, whether onSuccess throws, what is reported]
		const tasks: [string, () => Promise<unknown>, boolean, string[]][] = [
			["reports nothing for a task that succeeds", async () => "ok", false, []],
			["reports a task that fails, with its context", async () => Promise.reject(new Error("disk full")), false, ["Index build: Error: disk full"]],
			["reports a value thrown that is not an error", async () => Promise.reject("disk full"), false, ["Index build: Error: disk full"]],
			["reports a failure in what runs after the task", async () => "ok", true, ["Index build: Error: after"]],
		];

		for (const [title, task, successThrows, expected] of tasks) {
			it(title, async () => {
				const reported: string[] = [];
				let succeeded = false;
				attachTaskWithErrorLogging(task(), "Index build", (message) => reported.push(message), () => {
					succeeded = true;
					if (successThrows) {
						throw new Error("after");
					}
				});
				await settle();
				assert.deepStrictEqual(reported, expected);
				assert.strictEqual(succeeded, expected.length === 0 || successThrows);
			});
		}
	});

	describe("appendEntriesWithErrorLogging", () => {
		it("adds the entries listed to what is already there", async () => {
			const target = ["a.txt"];
			await appendEntriesWithErrorLogging(target, async () => ["b.txt", "c.txt"], "Listing", () => assert.fail("reported"));
			assert.deepStrictEqual(target, ["a.txt", "b.txt", "c.txt"]);
		});

		it("reports a listing that fails and keeps what is already there", async () => {
			const target = ["a.txt"];
			const reported: string[] = [];
			await appendEntriesWithErrorLogging(target, async () => Promise.reject(new Error("no such folder")), "Listing", (m) => reported.push(m));
			assert.deepStrictEqual([target, reported], [["a.txt"], ["Listing: Error: no such folder"]]);
		});
	});

	describe("createBuildGate", () => {
		function gate() {
			const log: string[] = [];
			const g = createBuildGate();
			return { g, log, after: (name: string) => g.runAfterBuild(() => log.push(name)) };
		}

		it("drops work asked for when no build was ever started, or after a reset", async () => {
			const { g, log, after } = gate();
			after("before any build");
			g.start(Promise.resolve());
			g.reset();
			after("after reset");
			await settle();
			assert.deepStrictEqual(log, []);
		});

		for (const outcome of ["resolve", "reject"] as const) {
			it(`holds work until the build ${outcome}s, then runs it at once`, async () => {
				const { g, log, after } = gate();
				const build = deferred();
				g.start(build.promise);
				after("held");
				await settle();
				assert.deepStrictEqual(log, []);

				build[outcome](undefined);
				await settle();
				after("at once");
				assert.deepStrictEqual(log, ["held", "at once"]);
			});
		}

		for (const outcome of ["resolve", "reject"] as const) {
			it(`keeps work held when the build it waits for is replaced and then ${outcome}s`, async () => {
				const { g, log, after } = gate();
				const first = deferred();
				const second = deferred();
				g.start(first.promise);
				after("held");
				g.start(second.promise);

				first[outcome](undefined);
				await settle();
				after("also held");
				assert.deepStrictEqual(log, []);

				second.resolve();
				await settle();
				assert.deepStrictEqual(log, ["held", "also held"]);
			});
		}

		for (const outcome of ["resolve", "reject"] as const) {
			it(`starts a follow-on only once the build ${outcome}s, holding the gate meanwhile`, async () => {
				const { g, log, after } = gate();
				const build = deferred();
				const next = deferred<string>();
				g.start(build.promise);
				const following = g.followOn(() => {
					log.push("follow-on started");
					return next.promise;
				});
				after("held");
				await settle();
				assert.deepStrictEqual(log, []);

				build[outcome](undefined);
				await settle();
				assert.deepStrictEqual(log, ["follow-on started"]);

				next.resolve("built");
				assert.strictEqual(await following, "built");
				await settle();
				assert.deepStrictEqual(log, ["follow-on started", "held"]);
			});
		}

		it("starts a follow-on at once when no build is running", async () => {
			const { g, log, after } = gate();
			const started: string[] = [];
			g.followOn(async () => started.push("first"));
			assert.deepStrictEqual(started, ["first"]);
			await settle();
			g.followOn(async () => started.push("second"));
			assert.deepStrictEqual(started, ["first", "second"]);
			await settle();
			after("after both");
			assert.deepStrictEqual(log, ["after both"]);
		});
	});
});
