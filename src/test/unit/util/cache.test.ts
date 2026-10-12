import * as assert from "assert";
import { mock } from "node:test";
import { Cache, CacheOptions, PromiseCache, PromiseCacheOptions } from "../../../util/cache";

// A value whose weight can change after it was cached, as an image's does once it is decoded.
interface Sized {
	key: string;
	bytes: number;
}

describe("util/cache", () => {
	const open: { dispose(): void }[] = [];
	// The file each key stands for: the cache asks for its version to know whether it changed.
	let version: Record<string, number>;
	let made: string[];

	function cache<V = string>(options: Partial<CacheOptions<V>> = {}): Cache<V> {
		const result = new Cache<V>({
			life: 0,
			factory: (key) => {
				made.push(key);
				return `${key}#${made.length}` as V;
			},
			...options,
		});
		open.push(result);
		return result;
	}

	function promiseCache<V = string>(options: Partial<PromiseCacheOptions<V>> = {}): PromiseCache<V> {
		const result = new PromiseCache<V>({
			life: 0,
			factory: async (key) => {
				made.push(key);
				return `${key}#${made.length}` as V;
			},
			...options,
		});
		open.push(result);
		return result;
	}

	const sized = (key: string): Sized => {
		made.push(key);
		return { key, bytes: 10 };
	};

	beforeEach(() => {
		mock.timers.enable({ apis: ["Date", "setInterval"] });
		version = {};
		made = [];
	});

	afterEach(() => {
		open.splice(0).forEach((item) => item.dispose());
		mock.timers.reset();
	});

	describe("Cache", () => {
		it("makes a value once per key", () => {
			const c = cache();
			assert.deepStrictEqual([c.get("a"), c.get("a"), c.get("b"), c.get(), c.get("")], ["a#1", "a#1", "b#2", "#3", "#3"]);
		});

		it("asks whether a value changed only once nonExpireLife has passed, and remakes it if so", () => {
			const c = cache({ expireWhenChange: (key) => version[key], nonExpireLife: 200 });
			c.get("a");

			version.a = 1;
			mock.timers.tick(199);
			assert.strictEqual(c.get("a"), "a#1");

			mock.timers.tick(200);
			assert.strictEqual(c.get("a"), "a#2");
			mock.timers.tick(200);
			assert.strictEqual(c.get("a"), "a#2");
		});

		it("serves a value for good when nothing says it changed", () => {
			const c = cache();
			c.get("a");
			mock.timers.tick(1_000_000);
			assert.strictEqual(c.get("a"), "a#1");
		});

		it("forgets a removed key, and everything on clear and dispose", () => {
			const c = cache();
			c.get("a");
			c.get("b");
			c.remove("a");
			assert.deepStrictEqual([c.get("a"), c.get("b")], ["a#3", "b#2"]);
			c.clear();
			assert.deepStrictEqual([c.get("a"), c.get("b")], ["a#4", "b#5"]);
			c.dispose();
			c.dispose();
			assert.strictEqual(c.get("a"), "a#6");
		});

		it("drops the key used longest ago once over maxSize", () => {
			const c = cache({ maxSize: 2 });
			c.get("a");
			c.get("b");
			c.get("a");
			c.get("c");
			assert.deepStrictEqual(made, ["a", "b", "c"]);
			c.get("a");
			c.get("c");
			assert.deepStrictEqual(made, ["a", "b", "c"]);
			c.get("b");
			assert.deepStrictEqual(made, ["a", "b", "c", "b"]);
		});

		it("drops the keys used longest ago once their weights pass maxBytes", () => {
			const c = cache<Sized>({ factory: sized, maxBytes: 25, weigher: (value) => value.bytes });
			c.get("a");
			c.get("b");
			c.get("c");
			c.get("b");
			c.get("c");
			assert.deepStrictEqual(made, ["a", "b", "c"]);
			c.get("a");
			assert.deepStrictEqual(made, ["a", "b", "c", "a"]);
		});

		it("weighs a value again when it is used, since it may have grown", () => {
			const c = cache<Sized>({ factory: sized, maxBytes: 25, weigher: (value) => value.bytes });
			const a = c.get("a");
			c.get("b");
			a.bytes = 20;
			assert.strictEqual(c.get("a"), a);
			c.get("b");
			assert.deepStrictEqual(made, ["a", "b", "b"]);
		});

		it("holds to both limits when both are set, and counts a missing weight as nothing", () => {
			const both = cache<Sized>({ factory: sized, maxSize: 2, maxBytes: 15, weigher: (value) => value.bytes });
			both.get("a");
			both.get("b");
			both.get("b");
			both.get("a");
			assert.deepStrictEqual(made, ["a", "b", "a"]);

			made = [];
			const weightless = cache<Sized>({ factory: sized, maxBytes: 15, weigher: () => undefined as unknown as number });
			weightless.get("a");
			weightless.get("b");
			weightless.get("a");
			assert.deepStrictEqual(made, ["a", "b"]);
		});

		it("sweeps out a key not used for longer than its life", () => {
			const c = cache({ life: 1000 });
			const forever = cache();
			c.get("old");
			forever.get("kept");
			mock.timers.tick(900);
			c.get("fresh");
			mock.timers.tick(300);
			assert.deepStrictEqual([c.get("fresh"), forever.get("kept")], ["fresh#3", "kept#2"]);
			assert.strictEqual(c.get("old"), "old#4");
		});

		it("sweeps every cache on its own life, however many there are", () => {
			const long = cache({ life: 1000 });
			const alsoLong = cache({ life: 1000 });
			const short = cache({ life: 100 });
			long.get("a");
			alsoLong.get("a");
			short.get("a");
			mock.timers.tick(150);
			assert.deepStrictEqual([long.get("a"), alsoLong.get("a"), short.get("a")], ["a#1", "a#2", "a#4"]);

			short.dispose();
			mock.timers.tick(1250);
			assert.deepStrictEqual([long.get("a"), alsoLong.get("a")], ["a#5", "a#6"]);
		});
	});

	describe("PromiseCache", () => {
		it("shares one pending value between everyone asking for the key", async () => {
			const c = promiseCache();
			assert.deepStrictEqual(await Promise.all([c.get("a"), c.get("a"), c.get("b"), c.get()]), ["a#1", "a#1", "b#2", "#3"]);
			assert.strictEqual(await c.get("a"), "a#1");
		});

		it("does not keep a value that came back empty or failed", async () => {
			const results: unknown[] = [undefined, null, new Error("failed"), "found"];
			const c = promiseCache<unknown>({
				factory: async () => {
					const result = results.shift();
					if (result instanceof Error) {
						throw result;
					}
					return result;
				},
				maxBytes: 100,
				weigher: () => 10,
			});
			assert.strictEqual(await c.get("a"), undefined);
			assert.strictEqual(await c.get("a"), null);
			await assert.rejects(c.get("a"), /failed/);
			assert.strictEqual(await c.get("a"), "found");
			assert.strictEqual(await c.get("a"), "found");
		});

		it("asks whether a value changed only once nonExpireLife has passed, and remakes it if so", async () => {
			const c = promiseCache({ expireWhenChange: async (key) => version[key], nonExpireLife: 200 });
			await c.get("a");

			version.a = 1;
			mock.timers.tick(199);
			assert.strictEqual(await c.get("a"), "a#1");

			mock.timers.tick(200);
			assert.strictEqual(await c.get("a"), "a#2");
			mock.timers.tick(200);
			assert.strictEqual(await c.get("a"), "a#2");
		});

		it("forgets a removed key, and everything on clear", async () => {
			const c = promiseCache();
			await c.get("a");
			await c.get("b");
			c.remove("a");
			assert.deepStrictEqual([await c.get("a"), await c.get("b")], ["a#3", "b#2"]);
			c.clear();
			assert.strictEqual(await c.get("b"), "b#4");
		});

		it("weighs a value once it is there, and again when it is used", async () => {
			const c = promiseCache<Sized>({ factory: async (key) => sized(key), maxBytes: 25, weigher: (value) => value.bytes });
			await c.get("a");
			await c.get("b");
			await c.get("c");
			const b = await c.get("b");
			await c.get("c");
			assert.deepStrictEqual(made, ["a", "b", "c"]);

			b.bytes = 20;
			await c.get("b");
			await c.get("c");
			assert.deepStrictEqual(made, ["a", "b", "c", "c"]);
		});

		it("drops the key used longest ago once over maxSize", async () => {
			const c = promiseCache({ maxSize: 1 });
			await c.get("a");
			await c.get("b");
			await c.get("a");
			assert.deepStrictEqual(made, ["a", "b", "a"]);
		});
	});
});
