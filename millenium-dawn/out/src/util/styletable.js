"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeForStyle = exports.StyleTable = void 0;
class StyleTable {
    constructor() {
        this.records = {};
        this.rawRecords = {};
        this.id = 0;
    }
    style(name, callback, pseudoClass = '') {
        name = this.name(name);
        const key = name + pseudoClass;
        const result = this.records[key];
        if (result !== undefined) {
            return name;
        }
        const callbackResult = callback();
        if (typeof callbackResult === 'string') {
            this.records[key] = callbackResult;
            return name;
        }
        else {
            return callbackResult.then(v => {
                this.records[key] = v;
                return name;
            });
        }
    }
    oneTimeStyle(name, callback, fakeClass = '') {
        const sid = this.id++;
        return this.style(name + '-' + sid, callback, fakeClass);
    }
    toStyleElement(nonce) {
        return `<style nonce="${nonce}">
            ${Object.entries(this.records).map(([k, v]) => `.${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('')}
            ${Object.entries(this.rawRecords).map(([k, v]) => `${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('')}
            </style>`;
    }
    name(name) {
        return 'st-' + name;
    }
    raw(selector, content) {
        this.rawRecords[selector] = content;
    }
}
exports.StyleTable = StyleTable;
function normalizeForStyle(name) {
    return name.replace(/[^\w_]/g, r => '_' + r.charCodeAt(0));
}
exports.normalizeForStyle = normalizeForStyle;
//# sourceMappingURL=styletable.js.map