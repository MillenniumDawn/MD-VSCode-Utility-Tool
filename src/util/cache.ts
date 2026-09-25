export interface CacheOptions<V> {
	factory(key: string): V;
	expireWhenChange?(key: string, cachedValue: V): unknown;
	life: number;
	nonExpireLife?: number;
	/** Maximum number of entries kept. When exceeded, the least recently accessed entries are evicted. Unbounded when undefined. */
	maxSize?: number;
	/** Maximum total weight (e.g. bytes) kept. When exceeded, least recently accessed entries are evicted. Needs `weigher`. */
	maxBytes?: number;
	/**
	 * Weight of a value, used together with `maxBytes`. Defaults to 0 (count-only eviction) when
	 * omitted. Re-evaluated on every access to the entry and on every limit check, so it may read
	 * fields the value populates lazily after it was cached.
	 */
	weigher?(value: V): number;
}

export interface PromiseCacheOptions<V>
	extends Omit<CacheOptions<Promise<V>>, "weigher"> {
	expireWhenChange?(key: string, cachedValue: Promise<V>): unknown;
	/** Weight of the resolved value, used together with `maxBytes`; re-evaluated like `CacheOptions.weigher`. */
	weigher?(value: V): number;
}

interface CacheEntry<V> {
	value: V;
	expiryToken: unknown;
	lastAccess: number;
	// Monotonic access sequence used for LRU eviction ordering. lastAccess (a Date.now() timestamp)
	// can't order accesses that fall within the same millisecond, so eviction would drop the wrong
	// entry under rapid access; a strictly increasing counter gives true least-recently-used order.
	accessSeq: number;
	// Last computed weight, and the function that recomputes it. A value can grow after it was
	// cached (an image memoizes its data URI, a sprite its split frames), so the weight is refreshed
	// on access and at every limit check rather than fixed at insertion.
	weight: number;
	weigh?: () => number;
}

// One timer for every cache, rather than one per cache. Each instance keeps its own life; the
// shared tick runs at the shortest of them, so nothing sweeps less often than it did, and a host
// holding dozens of caches wakes up once instead of dozens of times.
interface SweepEntry {
	sweepInterval: number;
	tryClean(): void;
}

const sweptCaches = new Set<SweepEntry>();
let sweeperToken: NodeJS.Timeout | null = null;
let sweeperInterval = 0;

/** How many caches the shared sweeper is currently ticking. Used by the tests. */
export function sweepingCacheCount(): number {
	return sweptCaches.size;
}

function rescheduleSweeper(): void {
	let shortest = Infinity;
	for (const cache of sweptCaches) {
		shortest = Math.min(shortest, cache.sweepInterval);
	}

	if (shortest === Infinity) {
		if (sweeperToken !== null) {
			clearInterval(sweeperToken);
			sweeperToken = null;
		}
		sweeperInterval = 0;
		return;
	}

	if (sweeperToken !== null && sweeperInterval === shortest) {
		return;
	}

	if (sweeperToken !== null) {
		clearInterval(sweeperToken);
	}
	sweeperInterval = shortest;
	sweeperToken = setInterval(() => {
		for (const cache of sweptCaches) {
			cache.tryClean();
		}
	}, shortest);
	// A cache sweep is never a reason to keep the process alive.
	if (
		typeof (sweeperToken as unknown as { unref?: () => void }).unref ===
		"function"
	) {
		(sweeperToken as unknown as { unref: () => void }).unref();
	}
}

export class Cache<V> {
	protected _cache: Record<string, CacheEntry<V>> = {};
	// Kept alongside the record so a count-only limit check does not have to materialise every
	// key on every miss. Every write to _cache goes through setEntry/deleteEntry to keep it right.
	private _size = 0;
	private readonly _sweepEntry: SweepEntry | null;
	private _accessCounter = 0;

	protected nextAccessSeq(): number {
		return ++this._accessCounter;
	}

	protected setEntry(key: string, entry: CacheEntry<V>): void {
		if (this._cache[key] === undefined) {
			this._size++;
		}
		this._cache[key] = entry;
	}

	private deleteEntry(key: string): void {
		if (this._cache[key] !== undefined) {
			delete this._cache[key];
			this._size--;
		}
	}

	constructor(protected readonly options: CacheOptions<V>) {
		if (options.life > 0) {
			this._sweepEntry = {
				sweepInterval: options.life / 5,
				tryClean: () => this.tryClean(),
			};
			sweptCaches.add(this._sweepEntry);
			rescheduleSweeper();
		} else {
			this._sweepEntry = null;
		}
		if (!options.expireWhenChange) {
			options.expireWhenChange = () => undefined;
		}
		if (options.nonExpireLife === undefined) {
			options.nonExpireLife = 200;
		}
	}

	public get(key: string = ""): V {
		const cacheEntry = this._cache[key];
		const now = Date.now();
		let expireToken: unknown = undefined;
		if (
			cacheEntry &&
			(now - cacheEntry.lastAccess < this.options.nonExpireLife! ||
				(expireToken = this.options.expireWhenChange!(
					key,
					cacheEntry.value,
				)) === cacheEntry.expiryToken)
		) {
			cacheEntry.lastAccess = now;
			cacheEntry.accessSeq = this.nextAccessSeq();
			this.reweigh(cacheEntry);
			return cacheEntry.value;
		}

		const value = this.options.factory(key);
		const weigher = this.options.weigher;
		const weigh = weigher ? () => weigher(value) ?? 0 : undefined;
		const newEntry: CacheEntry<V> = {
			lastAccess: now,
			accessSeq: this.nextAccessSeq(),
			expiryToken: expireToken ?? this.options.expireWhenChange!(key, value),
			value,
			weight: weigh ? weigh() : 0,
			weigh,
		};

		this.setEntry(key, newEntry);
		this.enforceLimits();
		return newEntry.value;
	}

	public remove(key: string = ""): void {
		this.deleteEntry(key);
	}

	public clear(): void {
		this._cache = {};
		this._size = 0;
	}

	public dispose(): void {
		this.clear();
		if (this._sweepEntry !== null && sweptCaches.delete(this._sweepEntry)) {
			rescheduleSweeper();
		}
	}

	private tryClean(): void {
		const now = Date.now();
		for (const [key, entry] of Object.entries(this._cache)) {
			if (entry.lastAccess + this.options.life < now) {
				this.deleteEntry(key);
			}
		}
	}

	// Refreshes the weight of an entry that was just accessed; when it changed, the totals are
	// re-checked so a value that grew since it was cached is accounted for from this access on.
	protected reweigh(entry: CacheEntry<V>): void {
		if (this.options.maxBytes === undefined || !entry.weigh) {
			return;
		}
		const weight = entry.weigh();
		if (weight !== entry.weight) {
			entry.weight = weight;
			this.enforceLimits();
		}
	}

	protected enforceLimits(): void {
		const { maxSize, maxBytes } = this.options;
		if (maxSize === undefined && maxBytes === undefined) {
			return;
		}
		// Only a byte limit needs every entry re-weighed; a count limit that is not exceeded is
		// answered from the running size.
		if (maxBytes === undefined && this._size <= maxSize!) {
			return;
		}

		const keys = Object.keys(this._cache);
		let count = keys.length;
		let totalBytes = 0;
		if (maxBytes !== undefined) {
			for (const k of keys) {
				const entry = this._cache[k];
				if (!entry) {
					continue;
				}
				if (entry.weigh) {
					entry.weight = entry.weigh();
				}
				totalBytes += entry.weight;
			}
		}

		const over = () =>
			(maxSize !== undefined && count > maxSize) ||
			(maxBytes !== undefined && totalBytes > maxBytes);
		if (!over()) {
			return;
		}

		// Evict least recently accessed entries until back under both limits.
		keys.sort(
			(a, b) =>
				(this._cache[a]?.accessSeq ?? 0) - (this._cache[b]?.accessSeq ?? 0),
		);
		for (const key of keys) {
			if (!over()) {
				break;
			}
			const entry = this._cache[key];
			if (!entry) {
				continue;
			}
			totalBytes -= entry.weight;
			this.deleteEntry(key);
			count--;
		}
	}
}

export class PromiseCache<V> extends Cache<Promise<V>> {
	private readonly pweigher?: (value: V) => number;

	constructor(options: PromiseCacheOptions<V>) {
		const { weigher, ...rest } = options;
		super({
			...rest,
			factory: (key) => {
				return options.factory(key).then(
					(value) => {
						if (value === null || value === undefined) {
							this.remove(key);
						}
						return value;
					},
					(error) => {
						this.remove(key);
						return Promise.reject<V>(error);
					},
				);
			},
		});
		this.pweigher = weigher;
	}

	public override async get(key: string = ""): Promise<V> {
		const cacheEntry = this._cache[key];
		const now = Date.now();
		let expireToken: unknown = undefined;
		if (
			cacheEntry &&
			(now - cacheEntry.lastAccess < this.options.nonExpireLife! ||
				(await (expireToken = Promise.resolve(
					this.options.expireWhenChange!(key, cacheEntry.value),
				))) === (await cacheEntry.expiryToken))
		) {
			cacheEntry.lastAccess = now;
			cacheEntry.accessSeq = this.nextAccessSeq();
			this.reweigh(cacheEntry);
			return await cacheEntry.value;
		}

		const value = this.options.factory(key);
		const newEntry: CacheEntry<Promise<V>> = {
			lastAccess: now,
			accessSeq: this.nextAccessSeq(),
			expiryToken:
				expireToken ??
				Promise.resolve(this.options.expireWhenChange!(key, value)),
			value,
			weight: 0,
		};

		this.setEntry(key, newEntry);

		// The weight is only known once the promise resolves; update it then and re-check limits.
		const weigher = this.pweigher;
		if (weigher && this.options.maxBytes !== undefined) {
			value.then(
				(v) => {
					if (this._cache[key] === newEntry && v !== null && v !== undefined) {
						newEntry.weigh = () => weigher(v) ?? 0;
						newEntry.weight = newEntry.weigh();
						this.enforceLimits();
					}
				},
				() => {
					/* rejected promises are removed by the factory wrapper */
				},
			);
		}

		this.enforceLimits();
		return await newEntry.value;
	}
}
