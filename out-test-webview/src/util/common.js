"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserError = exports.TimeoutError = void 0;
exports.arrayToMap = arrayToMap;
exports.hsvToRgb = hsvToRgb;
exports.slice = slice;
exports.debounceByInput = debounceByInput;
exports.randomString = randomString;
exports.clipNumber = clipNumber;
exports.withTimeout = withTimeout;
exports.mapLimit = mapLimit;
exports.forceError = forceError;
const lodash_1 = require("lodash");
function arrayToMap(items, key, valueSelector) {
    const result = {};
    for (const item of items) {
        const id = item[key];
        if (typeof id !== 'string' && typeof id !== 'number') {
            throw new Error('key of arrayToMap must be a string or number type');
        }
        result[id] = valueSelector ? valueSelector(item) : item;
    }
    return result;
}
function hsvToRgb(h, s, v) {
    var r, g, b, i, f, p, q, t;
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
            r = v, g = t, b = p;
            break;
        case 1:
            r = q, g = v, b = p;
            break;
        case 2:
            r = p, g = v, b = t;
            break;
        case 3:
            r = p, g = q, b = v;
            break;
        case 4:
            r = t, g = p, b = v;
            break;
        case 5:
            r = v, g = p, b = q;
            break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}
function slice(array, start, end) {
    if (!array) {
        return [];
    }
    if (start >= 0) {
        return array.slice(start, end);
    }
    else {
        if (end <= start) {
            return [];
        }
        const result = new Array(end - start);
        for (let i = start, j = 0; i < end; i++, j++) {
            result[j] = array[i];
        }
        return result;
    }
}
function debounceByInput(func, keySelector, wait, debounceSettings) {
    const cachedMethods = {};
    function result(...input) {
        const key = keySelector(...input);
        const method = cachedMethods[key];
        if (method) {
            return method(input);
        }
        const newMethod = (0, lodash_1.debounce)((input2) => {
            delete cachedMethods[key];
            return func(...input2);
        }, wait, debounceSettings);
        cachedMethods[key] = newMethod;
        return newMethod(input);
    }
    return result;
}
function randomString(length, charset = undefined) {
    var result = '';
    var characters = charset ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}
function clipNumber(value, min, max) {
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
class TimeoutError extends Error {
    constructor(message = 'Operation timed out') {
        super(message);
        this.name = 'TimeoutError';
    }
}
exports.TimeoutError = TimeoutError;
function withTimeout(promise, ms, onTimeout) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            const err = onTimeout?.() ?? new TimeoutError(`Operation timed out after ${ms}ms`);
            reject(err);
        }, ms);
        promise.then(value => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, error => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
    });
}
/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` callbacks concurrently.
 * Keeps the event loop responsive when each callback does heavy synchronous work
 * (e.g. DDS->PNG image conversion) under memory pressure. Results preserve input order.
 */
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    if (items.length === 0) {
        return results;
    }
    const effectiveLimit = Math.max(1, Math.min(limit, items.length));
    let nextIndex = 0;
    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) {
                return;
            }
            results[index] = await fn(items[index], index);
        }
    }
    const workers = [];
    for (let i = 0; i < effectiveLimit; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}
class UserError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UserError';
    }
}
exports.UserError = UserError;
function forceError(e) {
    if (e instanceof Error || e instanceof UserError) {
        return e;
    }
    if (typeof e === 'string') {
        return new Error(e.toString());
    }
    return new Error();
}
//# sourceMappingURL=common.js.map