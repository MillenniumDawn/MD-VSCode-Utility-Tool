"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inBBox = inBBox;
exports.bboxCenter = bboxCenter;
exports.distanceSqr = distanceSqr;
exports.distanceHamming = distanceHamming;
function inBBox(point, bbox) {
    return point.x >= bbox.x && point.x < bbox.x + bbox.w && point.y >= bbox.y && point.y < bbox.y + bbox.h;
}
function bboxCenter(bbox) {
    return {
        x: bbox.x + bbox.w / 2,
        y: bbox.y + bbox.h / 2,
    };
}
function distanceSqr(a, b) {
    return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}
function distanceHamming(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
//# sourceMappingURL=graphutils.js.map