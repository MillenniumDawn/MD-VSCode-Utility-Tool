"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distanceHamming = exports.distanceSqr = exports.bboxCenter = exports.inBBox = void 0;
function inBBox(point, bbox) {
    return point.x >= bbox.x && point.x < bbox.x + bbox.w && point.y >= bbox.y && point.y < bbox.y + bbox.h;
}
exports.inBBox = inBBox;
function bboxCenter(bbox) {
    return {
        x: bbox.x + bbox.w / 2,
        y: bbox.y + bbox.h / 2,
    };
}
exports.bboxCenter = bboxCenter;
function distanceSqr(a, b) {
    return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}
exports.distanceSqr = distanceSqr;
function distanceHamming(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
exports.distanceHamming = distanceHamming;
//# sourceMappingURL=graphutils.js.map