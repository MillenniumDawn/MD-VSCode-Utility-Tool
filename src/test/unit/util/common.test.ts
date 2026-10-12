import * as assert from "assert";
import { mock } from "node:test";
import {
	CancelledError,
	TimeoutError,
	UserError,
	arrayToMap,
	clipNumber,
	createTimeSlicer,
	createWorkQueue,
	debounceByInput,
	forceError,
	hsvToRgb,
	jsonForScript,
	mapLimit,
	memoizeWithTtl,
	randomString,
	slice,
	throwIfCancelled,
	withTimeout,
} from "../../../util/common";
import { deferred, settle } from "../async";

// World map arrays keep their "bad" entries at negative indices, as own properties.
function withBadEntries<T>(items: T[], ...bad: T[]): T[] {
	const array = [...items];
	bad.forEach((entry, i) => {
		(array as unknown as Record<number, T>)[-1 - i] = entry;
	});
	return array;
}

// Runs `count` items through `run` and reports how many were inside `fn` at once, at most.
async function peakConcurrency(run: (fn: (item: number) => Promise<number>) => Promise<unknown>): Promise<number> {
	let active = 0;
	let peak = 0;
	await run(async (item) => {
		peak = Math.max(peak, ++active);
		await settle();
		active--;
		return item;
	});
	return peak;
}

describe("util/common", () => {
	afterEach(() => mock.timers.reset());

	describe("arrayToMap", () => {
		const focuses = [
			{ id: "a", x: 1 },
			{ id: "b", x: 2 },
			{ id: "a", x: 3 },
		];

		it("keys items by a field, the last one winning", () => {
			assert.deepStrictEqual(arrayToMap(focuses, "id"), { a: focuses[2], b: focuses[1] });
			assert.deepStrictEqual(arrayToMap(focuses, "x"), { 1: focuses[0], 2: focuses[1], 3: focuses[2] });
		});

		it("stores what the selector picks", () => {
			assert.deepStrictEqual(arrayToMap(focuses, "id", (focus) => focus.x), { a: 3, b: 2 });
		});

		it("refuses a key that is neither a string nor a number", () => {
			assert.throws(() => arrayToMap([{ id: null }], "id"), /string or number/);
		});
	});

	describe("hsvToRgb", () => {
		const colors: [[number, number, number], [number, number, number]][] = [
			[[0, 1, 1], [255, 0, 0]],
			[[1 / 6, 1, 1], [255, 255, 0]],
			[[2 / 6, 1, 1], [0, 255, 0]],
			[[3 / 6, 1, 1], [0, 255, 255]],
			[[4 / 6, 1, 1], [0, 0, 255]],
			[[5 / 6, 1, 1], [255, 0, 255]],
			[[0, 0, 1], [255, 255, 255]],
			[[0.5, 1, 0], [0, 0, 0]],
			[[0.5, 0.5, 0.5], [64, 128, 128]],
			// Out of range reads as the nearest end of the range.
			[[2, 2, 2], [255, 0, 0]],
			[[-1, -1, 0.5], [128, 128, 128]],
		];

		for (const [[h, s, v], [r, g, b]] of colors) {
			it(`turns hsv(${h.toFixed(2)}, ${s}, ${v}) into rgb(${r}, ${g}, ${b})`, () => {
				assert.deepStrictEqual(hsvToRgb(h, s, v), { r, g, b });
			});
		}
	});

	describe("slice", () => {
		const bad = withBadEntries([10, 11], -1, -2);
		const slices: [string, number[] | undefined, number, number, number[]][] = [
			["nothing of a missing array", undefined, 0, 2, []],
			["a middle run", [1, 2, 3, 4], 1, 3, [2, 3]],
			["a start counted from the end", [1, 2, 3, 4], -2, 4, [3, 4]],
			["an end counted from the end", [1, 2, 3, 4], 0, -1, [1, 2, 3]],
			["a start before the beginning as the beginning", [1, 2], -5, 2, [1, 2]],
			["an end past the last item as the last item", [1, 2], 0, 9, [1, 2]],
			["nothing when the end is not after the start", [1, 2, 3], 2, 1, []],
			["the bad entries of a world map array", bad, -2, 0, [-2, -1]],
			["bad entries and the items after them", bad, -2, 2, [-2, -1, 10, 11]],
			["one bad entry up to another", bad, -2, -1, [-2]],
			["a bad entry and no further than the last item", bad, -1, 9, [-1, 10, 11]],
			["nothing when the end falls before a bad start", bad, -1, -5, []],
		];

		for (const [title, array, start, end, expected] of slices) {
			it(`returns ${title}`, () => {
				assert.deepStrictEqual(slice(array, start, end), expected);
			});
		}
	});

	describe("clipNumber", () => {
		for (const [value, expected] of [[5, 5], [-1, 0], [11, 10], [0, 0], [10, 10]]) {
			it(`keeps ${value} within 0 and 10 as ${expected}`, () => {
				assert.strictEqual(clipNumber(value, 0, 10), expected);
			});
		}
	});

	describe("withTimeout", () => {
		beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));

		it("settles as the promise does when that comes first", async () => {
			assert.strictEqual(await withTimeout(Promise.resolve("done"), 100), "done");
			await assert.rejects(withTimeout(Promise.reject(new Error("failed")), 100), /failed/);
		});

		it("rejects with a TimeoutError once the time is up", async () => {
			const waiting = withTimeout(new Promise(() => undefined), 100);
			mock.timers.tick(100);
			await assert.rejects(waiting, { name: "TimeoutError", message: "Operation timed out after 100ms" });
		});

		it("rejects with what onTimeout returns, or the default when it returns nothing", async () => {
			const custom = withTimeout(new Promise(() => undefined), 100, () => new UserError("still loading"));
			let told = false;
			const silent = withTimeout(new Promise(() => undefined), 100, () => {
				told = true;
			});
			mock.timers.tick(100);
			await assert.rejects(custom, { name: "UserError", message: "still loading" });
			await assert.rejects(silent, TimeoutError);
			assert.strictEqual(told, true);
		});

		it("ignores a promise that settles after the timeout, and a timeout after the promise", async () => {
			const late = deferred<string>();
			const waiting = withTimeout(late.promise, 100);
			mock.timers.tick(100);
			late.resolve("too late");
			await assert.rejects(waiting, TimeoutError);

			let told = false;
			const early = await withTimeout(Promise.resolve("in time"), 100, () => {
				told = true;
			});
			mock.timers.tick(100);
			assert.deepStrictEqual([early, told], ["in time", false]);
		});
	});

	describe("mapLimit", () => {
		const items = [1, 2, 3, 4, 5, 6];

		it("returns the results in the order of the items", async () => {
			assert.deepStrictEqual(await mapLimit(items, 2, async (item, index) => item * 10 + index), [10, 21, 32, 43, 54, 65]);
			assert.deepStrictEqual(await mapLimit([], 2, async (item) => item), []);
		});

		for (const [limit, expected] of [[1, 1], [3, 3], [50, 6], [0, 1]]) {
			it(`runs ${expected} at a time when the limit is ${limit}`, async () => {
				assert.strictEqual(await peakConcurrency((fn) => mapLimit(items, limit, fn)), expected);
			});
		}

		it("rejects with the failure of an item", async () => {
			await assert.rejects(mapLimit(items, 2, async (item) => {
				if (item === 3) {
					throw new Error("third");
				}
			}), /third/);
		});
	});

	describe("createTimeSlicer", () => {
		it("yields the event loop only once the budget has passed", async () => {
			mock.timers.enable({ apis: ["Date"] });
			const slicer = createTimeSlicer(8);
			let turns = 0;
			const turn = () => void slicer().then(() => turns++);

			turn();
			await Promise.resolve();
			assert.strictEqual(turns, 1);

			mock.timers.tick(8);
			turn();
			await Promise.resolve();
			assert.strictEqual(turns, 1);
			await settle();
			assert.strictEqual(turns, 2);

			turn();
			await Promise.resolve();
			assert.strictEqual(turns, 3);
		});
	});

	describe("createWorkQueue", () => {
		it("returns the results in the order of the items, however many there are", async () => {
			const items = Array.from({ length: 200 }, (_, i) => i);
			assert.deepStrictEqual(await createWorkQueue(4).map(items, async (item, index) => item + index), items.map((i) => i * 2));
			assert.deepStrictEqual(await createWorkQueue(4).map([], async (item) => item), []);
		});

		it("shares one budget between every call running through it", async () => {
			const queue = createWorkQueue(2);
			const peak = await peakConcurrency((fn) => Promise.all([queue.map([1, 2, 3], fn), queue.map([4, 5, 6], fn)]));
			assert.strictEqual(peak, 2);
			assert.strictEqual(await peakConcurrency((fn) => createWorkQueue(0).map([1, 2, 3], fn)), 1);
		});

		it("lets the event loop turn between items", async () => {
			const log: (number | string)[] = [];
			setImmediate(() => log.push("io"));
			await createWorkQueue(1).map([1, 2, 3], async (item) => {
				log.push(item);
			});
			assert.deepStrictEqual(log, [1, "io", 2, 3]);
		});

		it("rejects with the first failure and runs none of the items after it", async () => {
			const ran: number[] = [];
			const run = createWorkQueue(1).map([1, 2, 3, 4], async (item) => {
				ran.push(item);
				if (item >= 2) {
					throw new Error(`item ${item}`);
				}
			});
			await assert.rejects(run, /item 2/);
			assert.deepStrictEqual(ran, [1, 2]);
		});

		it("rejects a cancelled call, leaving the items it had left alone", async () => {
			const token = { isCancellationRequested: false };
			const ran: number[] = [];
			const run = createWorkQueue(1).map([1, 2, 3], async (item) => {
				ran.push(item);
				token.isCancellationRequested = true;
			}, { token });
			await assert.rejects(run, CancelledError);
			assert.deepStrictEqual(ran, [1]);
		});

		it("keeps the failure of one call out of another", async () => {
			const queue = createWorkQueue(2);
			const failing = queue.map([1, 2], async () => {
				throw new Error("failed");
			});
			const working = queue.map([1, 2], async (item) => item * 2);
			await assert.rejects(failing, /failed/);
			assert.deepStrictEqual(await working, [2, 4]);
		});
	});

	describe("memoizeWithTtl", () => {
		function memo(options: { maxSize?: number } = {}) {
			const clock = { now: 0 };
			const calls: string[] = [];
			const get = memoizeWithTtl(async (key: string) => {
				calls.push(key);
				if (key === "bad") {
					throw new Error("failed");
				}
				return `${key}#${calls.length}`;
			}, { ttl: 100, now: () => clock.now, ...options });
			return { clock, calls, get };
		}

		it("computes a key once within the ttl and again after it", async () => {
			const { clock, calls, get } = memo();
			assert.strictEqual(get("a"), get("a"));
			clock.now = 99;
			assert.strictEqual(await get("a"), "a#1");
			clock.now = 100;
			assert.strictEqual(await get("a"), "a#2");
			assert.strictEqual(await get("b"), "b#3");
			assert.deepStrictEqual(calls, ["a", "a", "b"]);
		});

		it("does not keep a failure", async () => {
			const { calls, get } = memo();
			await assert.rejects(get("bad"), /failed/);
			await assert.rejects(get("bad"), /failed/);
			assert.deepStrictEqual(calls, ["bad", "bad"]);
		});

		it("forgets everything on clear", async () => {
			const { calls, get } = memo();
			await get("a");
			get.clear();
			await get("a");
			assert.deepStrictEqual(calls, ["a", "a"]);
		});

		it("drops the key computed longest ago once over maxSize", async () => {
			const { calls, get } = memo({ maxSize: 2 });
			await get("a");
			await get("b");
			await get("c");
			await Promise.all([get("b"), get("c")]);
			assert.deepStrictEqual(calls, ["a", "b", "c"]);
			await get("a");
			assert.deepStrictEqual(calls, ["a", "b", "c", "a"]);
		});

		it("keeps what is still fresh when it clears out expired keys", async () => {
			const { clock, calls, get } = memo({ maxSize: 2 });
			await get("a");
			await get("b");
			clock.now = 100;
			await get("c");
			clock.now = 150;
			await get("d");
			await Promise.all([get("c"), get("d")]);
			assert.deepStrictEqual(calls, ["a", "b", "c", "d"]);
		});
	});

	describe("debounceByInput", () => {
		it("runs once per key with the last input, then starts over", () => {
			mock.timers.enable({ apis: ["setTimeout", "Date"] });
			const calls: [string, number][] = [];
			const save = debounceByInput(
				(file: string, version: number) => {
					calls.push([file, version]);
				},
				(file) => file,
				100,
			);

			save("a.txt", 1);
			save("a.txt", 2);
			save("b.txt", 1);
			mock.timers.tick(99);
			assert.deepStrictEqual(calls, []);
			mock.timers.tick(1);
			assert.deepStrictEqual(calls, [["a.txt", 2], ["b.txt", 1]]);

			save("a.txt", 3);
			mock.timers.tick(100);
			assert.deepStrictEqual(calls[2], ["a.txt", 3]);
		});
	});

	describe("errors", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const thrown: [string, unknown, string][] = [
			["a string", "disk full", "disk full"],
			["an object", { code: 5 }, 'Non-error value thrown: {"code":5}'],
			["a number", 42, "Non-error value thrown: 42"],
			["undefined", undefined, "Non-error value thrown: undefined"],
			["null", null, "Non-error value thrown: null"],
			["an object JSON cannot write", circular, "Non-error value thrown: [object Object]"],
		];

		for (const [title, value, message] of thrown) {
			it(`forceError turns ${title} into an Error saying so`, () => {
				const error = forceError(value);
				assert.ok(error instanceof Error);
				assert.strictEqual(error.message, message);
				assert.strictEqual(error.cause, typeof value === "string" ? undefined : value);
			});
		}

		it("forceError returns an Error as it is", () => {
			const error = new UserError("bad file");
			assert.strictEqual(forceError(error), error);
		});

		it("each error names itself and keeps its cause", () => {
			const cause = new Error("root");
			const user = new UserError("bad file", { cause });
			assert.deepStrictEqual([user.name, user.message, user.cause], ["UserError", "bad file", cause]);
			assert.deepStrictEqual([new TimeoutError().name, new TimeoutError().message], ["TimeoutError", "Operation timed out"]);
			assert.deepStrictEqual([new CancelledError().name, new CancelledError().message], ["CancelledError", "Operation cancelled"]);
		});

		it("throwIfCancelled throws for a cancelled token only", () => {
			throwIfCancelled(undefined);
			throwIfCancelled({ isCancellationRequested: false });
			assert.throws(() => throwIfCancelled({ isCancellationRequested: true }), CancelledError);
		});
	});

	describe("randomString", () => {
		it("is as long as asked, from the charset given", () => {
			assert.match(randomString(40), /^[A-Za-z0-9]{40}$/);
			assert.match(randomString(40, "ab"), /^[ab]{40}$/);
			assert.strictEqual(randomString(0), "");
		});
	});

	describe("jsonForScript", () => {
		const values: [string, unknown, string][] = [
			["a value JSON writes as it is", { id: "a", x: [1, null, true] }, '{"id":"a","x":[1,null,true]}'],
			["a closing script tag", "</script><script>alert(1)", '"\\u003c/script>\\u003cscript>alert(1)"'],
			["the separators that end a line in old JavaScript", "a\u2028b\u2029c", '"a\\u2028b\\u2029c"'],
		];

		for (const [title, value, expected] of values) {
			it(`writes ${title}, and it reads back the same`, () => {
				assert.strictEqual(jsonForScript(value), expected);
				assert.deepStrictEqual(JSON.parse(jsonForScript(value)), value);
			});
		}
	});
});
