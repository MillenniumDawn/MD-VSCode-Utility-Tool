"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSamePath = exports.matchPathEnd = void 0;
const path = require("path");
function matchPathEnd(pathname, segments) {
    pathname = pathname.replace(/\/|\\/g, path.sep);
    for (let i = segments.length - 1; i >= 0; i--) {
        const name = path.basename(pathname);
        pathname = path.dirname(pathname);
        if (segments[i] === '*') {
            continue;
        }
        if (segments[i].toLowerCase() !== name.toLowerCase()) {
            return false;
        }
    }
    return true;
}
exports.matchPathEnd = matchPathEnd;
function isSamePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
exports.isSamePath = isSamePath;
//# sourceMappingURL=nodecommon.js.map