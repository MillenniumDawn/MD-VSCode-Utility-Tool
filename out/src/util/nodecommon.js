"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchPathEnd = matchPathEnd;
exports.isSamePath = isSamePath;
const tslib_1 = require("tslib");
const path = tslib_1.__importStar(require("path"));
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
function isSamePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
//# sourceMappingURL=nodecommon.js.map