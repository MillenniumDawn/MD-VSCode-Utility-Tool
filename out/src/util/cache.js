"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromiseCache = exports.Cache = void 0;
class Cache {
    options;
    _cache = {};
    _intervalToken = null;
    constructor(options) {
        this.options = options;
        if (options.life > 0) {
            this._intervalToken = setInterval(() => this.tryClean(), options.life / 5);
        }
        if (!options.expireWhenChange) {
            options.expireWhenChange = () => undefined;
        }
        if (options.nonExpireLife === undefined) {
            options.nonExpireLife = 200;
        }
    }
    get(key = '') {
        const cacheEntry = this._cache[key];
        const now = Date.now();
        let expireToken = undefined;
        if (cacheEntry &&
            (now - cacheEntry.lastAccess < this.options.nonExpireLife ||
                (expireToken = this.options.expireWhenChange(key, cacheEntry.value)) === cacheEntry.expiryToken)) {
            cacheEntry.lastAccess = now;
            return cacheEntry.value;
        }
        const value = this.options.factory(key);
        const newEntry = {
            lastAccess: now,
            expiryToken: expireToken ?? this.options.expireWhenChange(key, value),
            value
        };
        this._cache[key] = newEntry;
        return newEntry.value;
    }
    remove(key = '') {
        delete this._cache[key];
    }
    clear() {
        this._cache = {};
    }
    dispose() {
        this._cache = {};
        if (this._intervalToken) {
            clearTimeout(this._intervalToken);
        }
    }
    tryClean() {
        const now = Date.now();
        for (const entry of Object.entries(this._cache)) {
            if (entry[1].lastAccess + this.options.life < now) {
                delete this._cache[entry[0]];
            }
        }
    }
}
exports.Cache = Cache;
class PromiseCache extends Cache {
    constructor(options) {
        super({
            ...options,
            factory: (key) => {
                return options.factory(key).then(value => {
                    if (value === null || value === undefined) {
                        this.remove(key);
                    }
                    return value;
                }, error => {
                    this.remove(key);
                    return Promise.reject(error);
                });
            }
        });
    }
    async get(key = '') {
        const cacheEntry = this._cache[key];
        const now = Date.now();
        let expireToken = undefined;
        if (cacheEntry &&
            (now - cacheEntry.lastAccess < this.options.nonExpireLife ||
                await (expireToken = Promise.resolve(this.options.expireWhenChange(key, cacheEntry.value))) === await cacheEntry.expiryToken)) {
            cacheEntry.lastAccess = now;
            return await cacheEntry.value;
        }
        const value = this.options.factory(key);
        const newEntry = {
            lastAccess: now,
            expiryToken: expireToken ?? Promise.resolve(this.options.expireWhenChange(key, value)),
            value
        };
        this._cache[key] = newEntry;
        return await newEntry.value;
    }
}
exports.PromiseCache = PromiseCache;
//# sourceMappingURL=cache.js.map