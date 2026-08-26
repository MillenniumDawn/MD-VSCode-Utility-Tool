import { debounce, DebounceSettings } from "lodash";

export interface NumberSize {
	width: number;
	height: number;
}

export interface NumberPosition {
	x: number;
	y: number;
}

export interface Warning<T> {
	text: string;
	source: T;
}

export function arrayToMap<T, K extends keyof T>(
	items: T[],
	key: K,
): T[K] extends string
	? Record<string, T>
	: T[K] extends number
		? Record<number, T>
		: never;
export function arrayToMap<T, K extends keyof T, V>(
	items: T[],
	key: K,
	valueSelector: (value: T) => V,
): T[K] extends string
	? Record<string, V>
	: T[K] extends number
		? Record<number, V>
		: never;
export function arrayToMap<T, K extends keyof T, V = T>(
	items: T[],
	key: K,
	valueSelector?: (value: T) => V,
): T[K] extends string
	? Record<string, V | T>
	: T[K] extends number
		? Record<number, V | T>
		: never {
	const result: Record<string | number, V | T> = {};
	for (const item of items) {
		const id = item[key];
		if (typeof id !== "string" && typeof id !== "number") {
			throw new Error("key of arrayToMap must be a string or number type");
		}
		result[id] = valueSelector ? valueSelector(item) : item;
	}

	return result as T[K] extends string
		? Record<string, V | T>
		: T[K] extends number
			? Record<number, V | T>
			: never;
}

export function hsvToRgb(
	h: number,
	s: number,
	v: number,
): Record<"r" | "g" | "b", number> {
	var r: number,
		g: number,
		b: number,
		i: number,
		f: number,
		p: number,
		q: number,
		t: number;
	h = clipNumber(h, 0, 1);
	s = clipNumber(s, 0, 1);
	v = clipNumber(v, 0, 1);
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
		case 0:
			(r = v), (g = t), (b = p);
			break;
		case 1:
			(r = q), (g = v), (b = p);
			break;
		case 2:
			(r = p), (g = v), (b = t);
			break;
		case 3:
			(r = p), (g = q), (b = v);
			break;
		case 4:
			(r = t), (g = p), (b = v);
			break;
		case 5:
			(r = v), (g = p), (b = q);
			break;
	}
	return {
		r: Math.round(r! * 255),
		g: Math.round(g! * 255),
		b: Math.round(b! * 255),
	};
}

export function slice<T>(
	array: T[] | undefined,
	start: number,
	end: number,
): T[] {
	if (!array) {
		return [];
	}

	// Synthetic world-map arrays store "bad" entries at negative indices (-1 .. -N)
	// as own properties, with bad*Count now a non-negative N. For those arrays a
	// negative start is a direct index, not len+start. Detect via own-property.
	if (start < 0 && Object.prototype.hasOwnProperty.call(array, String(start))) {
		let realEnd = end;
		if (realEnd < 0 && !Object.prototype.hasOwnProperty.call(array, String(realEnd))) {
			realEnd = array.length + realEnd;
		}
		if (realEnd <= start) {
			return [];
		}
		const result: T[] = [];
		for (let i = start; i < realEnd; i++) {
			if (i < 0) {
				result.push((array as unknown as Record<number, T>)[i]!);
			} else if (i < array.length) {
				result.push(array[i]!);
			} else {
				break;
			}
		}
		return result;
	}

	const len = array.length;
	let realStart = start;
	if (realStart < 0) {
		realStart = len + realStart;
	}
	if (realStart < 0) {
		realStart = 0;
	}

	let realEnd = end;
	if (realEnd < 0) {
		realEnd = len + realEnd;
	}

	if (realEnd <= realStart) {
		return [];
	}
	return array.slice(realStart, realEnd);
}

export function debounceByInput<TI extends unknown[], TO>(
	func: (...input: TI) => TO,
	keySelector: (...input: TI) => string,
	wait?: number,
	debounceSettings?: DebounceSettings,
): (...input: TI) => TO {
	const cachedMethods: Record<string, (input: TI) => TO> = {};

	function result(...input: TI): TO {
		const key = keySelector(...input);
		const method = cachedMethods[key];
		if (method) {
			return method(input);
		}

		const newMethod = debounce(
			(input2) => {
				delete cachedMethods[key];
				return func(...input2);
			},
			wait,
			debounceSettings,
		);
		cachedMethods[key] = newMethod;
		return newMethod(input);
	}

	return result;
}

export function randomString(
	length: number,
	charset: string | undefined = undefined,
): string {
	var result = "";
	var characters =
		charset ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	var charactersLength = characters.length;
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}

export function clipNumber(value: number, min: number, max: number): number {
	if (value < min) {
		return min;
	}
	if (value > max) {
		return max;
	}
	return value;
}

/**
 * Races a promise against a timeout. If the timeout fires first, `onTimeout` is called
 * (e.g. to surface a "still working" state) and the returned promise rejects with the
 * value `onTimeout` returns, or a default TimeoutError. The original promise keeps running
 * so a slow-but-not-stuck load can still finish in the background.
 */
export class TimeoutError extends Error {
	constructor(message: string = "Operation timed out") {
		super(message);
		this.name = "TimeoutError";
	}
}

/**
 * Thrown by work that noticed its CancellationToken was cancelled and stopped part-way. Deliberately
 * not `vscode.CancellationError`: this never leaves the extension, and the unit-test vscode stub has
 * no such class to construct.
 */
export class CancelledError extends Error {
	constructor(message: string = "Operation cancelled") {
		super(message);
		this.name = "CancelledError";
	}
}

/** The one member of `vscode.CancellationToken` that synchronous, pollable work needs. */
export interface CancellationLike {
	readonly isCancellationRequested: boolean;
}

export function throwIfCancelled(token: CancellationLike | undefined): void {
	if (token?.isCancellationRequested) {
		throw new CancelledError();
	}
}

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	onTimeout?: () => Error | void,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			const err =
				onTimeout?.() ?? new TimeoutError(`Operation timed out after ${ms}ms`);
			reject(err);
		}, ms);

		promise.then(
			(value) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` callbacks concurrently.
 * Keeps the event loop responsive when each callback does heavy synchronous work
 * (e.g. DDS->PNG image conversion) under memory pressure. Results preserve input order.
 */
export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	if (items.length === 0) {
		return results;
	}

	const effectiveLimit = Math.max(1, Math.min(limit, items.length));
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) {
				return;
			}
			results[index] = await fn(items[index]!, index);
		}
	}

	const workers: Promise<void>[] = [];
	for (let i = 0; i < effectiveLimit; i++) {
		workers.push(worker());
	}
	await Promise.all(workers);

	return results;
}

/**
 * Hands the event loop one turn. `setImmediate` rather than a resolved promise on purpose: a
 * microtask would run before the host gets to service any of its pending IO or RPC, which is the
 * whole point of yielding here.
 */
export function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

export interface WorkQueueOptions {
	/** Checked before each item; a cancelled queue rejects and drops whatever it had left. */
	token?: CancellationLike;
}

export interface WorkQueue {
	/**
	 * Like {@link mapLimit}, but the concurrency budget belongs to the queue rather than to this
	 * one call. Results preserve input order; the first rejection is what the call rejects with.
	 */
	map<T, R>(
		items: T[],
		fn: (item: T, index: number) => Promise<R>,
		options?: WorkQueueOptions,
	): Promise<R[]>;
}

/**
 * A worker pool shared by everything that runs through it, where `mapLimit` gives every call a
 * pool of its own. Four index builds each calling `mapLimit(files, 8, parse)` over two halves put
 * up to 64 synchronous parses on the extension host at once, all competing with the RPC that the
 * other half of the same build is blocked on. Sharing one small budget is what stops that.
 *
 * A worker also yields the event loop after every item, so a run of back-to-back synchronous
 * parses cannot hold the host for the length of the whole run.
 *
 * One rule for callbacks: never await another `map` on the same queue from inside one. Holding a
 * slot while waiting for a slot is a deadlock as soon as `limit` callbacks do it at once.
 */
export function createWorkQueue(limit: number): WorkQueue {
	const effectiveLimit = Math.max(1, limit);
	// Drained through a moving head rather than `shift`, which moves every remaining element on
	// each call. All eight index build halves queue into this one array, so a cold build puts tens
	// of thousands of jobs in it and draining them cost the square of that in element moves. The
	// consumed prefix is dropped once it is more than half the array, so the array does not grow
	// without bound over a long session either.
	const pending: (() => Promise<void>)[] = [];
	let head = 0;
	let active = 0;

	function takeNextJob(): (() => Promise<void>) | undefined {
		if (head >= pending.length) {
			return undefined;
		}

		const job = pending[head];
		pending[head] = undefined as unknown as () => Promise<void>;
		head++;

		if (head > 32 && head * 2 >= pending.length) {
			pending.splice(0, head);
			head = 0;
		}

		return job;
	}

	function pump(): void {
		while (active < effectiveLimit) {
			const job = takeNextJob();
			if (job === undefined) {
				return;
			}
			active++;
			void job().then(onJobSettled, onJobSettled);
		}
	}

	function onJobSettled(): void {
		active--;
		pump();
	}

	async function map<T, R>(
		items: T[],
		fn: (item: T, index: number) => Promise<R>,
		options?: WorkQueueOptions,
	): Promise<R[]> {
		const results = new Array<R>(items.length);
		if (items.length === 0) {
			return results;
		}

		const token = options?.token;
		let failure: unknown;
		let failed = false;
		let settledCount = 0;

		await new Promise<void>((resolve) => {
			for (let i = 0; i < items.length; i++) {
				const index = i;
				pending.push(async () => {
					try {
						// Whatever is left of a call that already failed or was cancelled still has
						// to drain out of the queue, but it must not do any of its work.
						if (!failed) {
							throwIfCancelled(token);
							results[index] = await fn(items[index]!, index);
							await yieldToEventLoop();
						}
					} catch (cause) {
						if (!failed) {
							failed = true;
							failure = cause;
						}
					} finally {
						if (++settledCount === items.length) {
							resolve();
						}
					}
				});
			}

			// Synchronously, so the first item's `fn` is entered in this same microtask chain.
			pump();
		});

		if (failed) {
			throw failure;
		}
		return results;
	}

	return { map };
}

/**
 * Wraps an async, single-string-keyed function with a short-lived per-key memo. Within `ttl`
 * milliseconds of a key's last computation the memoized promise is returned as-is; after the TTL
 * the value is recomputed. Collapses IO bursts (e.g. the hundreds of fs.stat calls a single
 * preview render makes while re-checking the same files' expiry tokens) without a background
 * timer. Rejections are not memoized, so a transient failure is retried on the next call. The
 * map is bounded: over `maxSize`, expired entries are pruned first and then the oldest.
 * `now` is injectable for tests. The returned function exposes `.clear()` to drop every memoized
 * entry (e.g. when the workspace or config changes invalidate all resolutions at once).
 */
export function memoizeWithTtl<T>(
	fn: (key: string) => Promise<T>,
	options: { ttl: number; maxSize?: number; now?: () => number },
): ((key: string) => Promise<T>) & { clear: () => void } {
	const { ttl } = options;
	const maxSize = options.maxSize ?? 500;
	const now = options.now ?? (() => Date.now());
	const entries = new Map<string, { value: Promise<T>; time: number }>();

	const memoized = (key: string): Promise<T> => {
		const current = now();
		const existing = entries.get(key);
		if (existing && current - existing.time < ttl) {
			return existing.value;
		}

		const value = fn(key);
		const entry = { value, time: current };
		// Re-insert at the end so Map iteration order tracks recency for eviction below.
		entries.delete(key);
		entries.set(key, entry);

		value.catch(() => {
			if (entries.get(key) === entry) {
				entries.delete(key);
			}
		});

		if (entries.size > maxSize) {
			for (const [k, e] of entries) {
				if (current - e.time >= ttl) {
					entries.delete(k);
				}
			}
			while (entries.size > maxSize) {
				const oldest = entries.keys().next().value as string | undefined;
				if (oldest === undefined) {
					break;
				}
				entries.delete(oldest);
			}
		}

		return value;
	};

	return Object.assign(memoized, { clear: () => entries.clear() });
}

export class UserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserError";
	}
}

export function forceError(e: unknown): Error {
	if (e instanceof Error || e instanceof UserError) {
		return e;
	}

	if (typeof e === "string") {
		return new Error(e.toString());
	}

	return new Error();
}

// JSON for embedding in an inline <script>. The HTML parser ends the script at the first `</script`
// it sees, whatever the JavaScript around it means, so a workspace string containing one would
// otherwise truncate the payload and spill the rest into the document as markup. Escaping `<`
// prevents that; U+2028 and U+2029 are escaped because they are valid JSON but line terminators in
// older JavaScript parsers.
export function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(
		/[<\u2028\u2029]/g,
		(c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
	);
}
