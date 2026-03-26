"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromiseCache = exports.Cache = void 0;
const tslib_1 = require("tslib");
class Cache {
    constructor(options) {
        this.options = options;
        this._cache = {};
        this._intervalToken = null;
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
            expiryToken: expireToken !== null && expireToken !== void 0 ? expireToken : this.options.expireWhenChange(key, value),
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
        super(Object.assign(Object.assign({}, options), { factory: (key) => {
                return options.factory(key).then(value => {
                    if (value === null || value === undefined) {
                        this.remove(key);
                    }
                    return value;
                }, error => {
                    this.remove(key);
                    return Promise.reject(error);
                });
            } }));
    }
    get(key = '') {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const cacheEntry = this._cache[key];
            const now = Date.now();
            let expireToken = undefined;
            if (cacheEntry &&
                (now - cacheEntry.lastAccess < this.options.nonExpireLife ||
                    (yield (expireToken = Promise.resolve(this.options.expireWhenChange(key, cacheEntry.value)))) === (yield cacheEntry.expiryToken))) {
                cacheEntry.lastAccess = now;
                return yield cacheEntry.value;
            }
            const value = this.options.factory(key);
            const newEntry = {
                lastAccess: now,
                expiryToken: expireToken !== null && expireToken !== void 0 ? expireToken : Promise.resolve(this.options.expireWhenChange(key, value)),
                value
            };
            this._cache[key] = newEntry;
            return yield newEntry.value;
        });
    }
}
exports.PromiseCache = PromiseCache;
//# sourceMappingURL=cache.js.map