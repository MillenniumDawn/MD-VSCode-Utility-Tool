export interface CacheOptions<V> {
	factory(key: string): V;
	expireWhenChange?(key: string, cachedValue: V): any;
	life: number;
	nonExpireLife?: number;
	/** Maximum number of entries kept. When exceeded, the least recently accessed entries are evicted. Unbounded when undefined. */
	maxSize?: number;
	/** Maximum total weight (e.g. bytes) kept. When exceeded, least recently accessed entries are evicted. Needs `weigher`. */
	maxBytes?: number;
	/** Weight of a value, used together with `maxBytes`. Defaults to 0 (count-only eviction) when omitted. */
	weigher?(value: V): number;
}

export interface PromiseCacheOptions<V>
	extends Omit<CacheOptions<Promise<V>>, "weigher"> {
	expireWhenChange?(key: string, cachedValue: Promise<V>): Promise<any> | any;
	/** Weight of the resolved value, used together with `maxBytes`. */
	weigher?(value: V): number;
}

interface CacheEntry<V> {
	value: V;
	expiryToken: any;
	lastAccess: number;
	// Monotonic access sequence used for LRU eviction ordering. lastAccess (a Date.now() timestamp)
	// can't order accesses that fall within the same millisecond, so eviction would drop the wrong
	// entry under rapid access; a strictly increasing counter gives true least-recently-used order.
	accessSeq: number;
	weight: number;
}

export class Cache<V> {
	protected _cache: Record<string, CacheEntry<V>> = {};
	private _intervalToken: NodeJS.Timeout | null = null;
	private _accessCounter = 0;

	protected nextAccessSeq(): number {
		return ++this._accessCounter;
	}

	constructor(protected readonly options: CacheOptions<V>) {
		if (options.life > 0) {
			this._intervalToken = setInterval(
				() => this.tryClean(),
				options.life / 5,
			);
			if (this._intervalToken && typeof (this._intervalToken as unknown as { unref?: () => void }).unref === 'function') {
				(this._intervalToken as unknown as { unref: () => void }).unref();
			}
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
		let expireToken: any = undefined;
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
			return cacheEntry.value;
		}

		const value = this.options.factory(key);
		const newEntry: CacheEntry<V> = {
			lastAccess: now,
			accessSeq: this.nextAccessSeq(),
			expiryToken: expireToken ?? this.options.expireWhenChange!(key, value),
			value,
			weight: this.options.weigher ? (this.options.weigher(value) ?? 0) : 0,
		};

		this._cache[key] = newEntry;
		this.enforceLimits();
		return newEntry.value;
	}

	public remove(key: string = ""): void {
		delete this._cache[key];
	}

	public clear(): void {
		this._cache = {};
	}

	public dispose(): void {
		this._cache = {};
		if (this._intervalToken) {
			clearInterval(this._intervalToken);
		}
	}

	private tryClean(): void {
		const now = Date.now();
		for (const [key, entry] of Object.entries(this._cache)) {
			if (entry.lastAccess + this.options.life < now) {
				delete this._cache[key];
			}
		}
	}

	protected enforceLimits(): void {
		const { maxSize, maxBytes } = this.options;
		if (maxSize === undefined && maxBytes === undefined) {
			return;
		}

		const keys = Object.keys(this._cache);
		let count = keys.length;
		let totalBytes = 0;
		if (maxBytes !== undefined) {
			for (const k of keys) {
				totalBytes += this._cache[k]?.weight ?? 0;
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
			delete this._cache[key];
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

	public async get(key: string = ""): Promise<V> {
		const cacheEntry = this._cache[key];
		const now = Date.now();
		let expireToken: any = undefined;
		if (
			cacheEntry &&
			(now - cacheEntry.lastAccess < this.options.nonExpireLife! ||
				(await (expireToken = Promise.resolve(
					this.options.expireWhenChange!(key, cacheEntry.value),
				))) === (await cacheEntry.expiryToken))
		) {
			cacheEntry.lastAccess = now;
			cacheEntry.accessSeq = this.nextAccessSeq();
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

		this._cache[key] = newEntry;

		// The weight is only known once the promise resolves; update it then and re-check limits.
		if (this.pweigher && this.options.maxBytes !== undefined) {
			value.then(
				(v) => {
					if (this._cache[key] === newEntry) {
						newEntry.weight =
							v === null || v === undefined ? 0 : (this.pweigher!(v) ?? 0);
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
