"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeNumberLike = normalizeNumberLike;
exports.calculateStartLength = calculateStartLength;
exports.calculateBBox = calculateBBox;
exports.normalizeMargin = normalizeMargin;
exports.removeHtmlOptions = removeHtmlOptions;
exports.getWidth = getWidth;
exports.getHeight = getHeight;
function normalizeNumberLike(value, parentValue, subtractValue = 0) {
    if (!value) {
        return undefined;
    }
    switch (value._unit) {
        case '%': return value._value / 100.0 * parentValue;
        case '%%': return value._value / 100.0 * parentValue - subtractValue;
        default: return value._value;
    }
}
const offsetMap = {
    'upper_left': { x: 0, y: 0 },
    'upper_right': { x: 1, y: 0 },
    'lower_left': { x: 0, y: 1 },
    'lower_right': { x: 1, y: 1 },
    'center_up': { x: 0.5, y: 0 },
    'center_down': { x: 0.5, y: 1 },
    'center_left': { x: 0, y: 0.5 },
    'center_right': { x: 1, y: 0.5 },
    'center': { x: 0.5, y: 0.5 },
};
function calculateStartLength(pos, size, parentSize, orientationFactor, origoFactor, scale) {
    let posValue = normalizeNumberLike(pos, parentSize) ?? 0;
    let length = (normalizeNumberLike(size, parentSize) ?? 0) * scale;
    if (size?._unit === '%%') {
        length = length - posValue;
    }
    if (length < 0) {
        length = length + parentSize;
    }
    const start = posValue + parentSize * orientationFactor - length * origoFactor;
    if (size?._unit === '%%' || (size?._value ?? 0) < 0) {
        let end = normalizeNumberLike(size, parentSize) ?? 0;
        if (end < 0) {
            end = end + parentSize;
        }
        length = Math.max(0, end - start);
    }
    return [start, length];
}
function calculateBBox({ orientation, origo, position, size, scale }, parentInfo) {
    const myOrientation = orientation?._name ?? 'upper_left';
    const parentSize = parentInfo.size;
    const orientationFactor = offsetMap[myOrientation] ?? offsetMap['upper_left'];
    const origoFactor = offsetMap[origo?._name ?? 'upper_left'] ?? offsetMap['upper_left'];
    let [x, width] = calculateStartLength(position?.x, getWidth(size), parentSize.width, orientationFactor.x, origoFactor.x, scale ?? 1);
    let [y, height] = calculateStartLength(position?.y, getHeight(size), parentSize.height, orientationFactor.y, origoFactor.y, scale ?? 1);
    const minWidth = normalizeNumberLike(getWidth(size?.min), parentSize.width, x) ?? width;
    const minHeight = normalizeNumberLike(getHeight(size?.min), parentSize.height, y) ?? height;
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
    return [x, y, width, height, myOrientation];
}
function normalizeMargin(margin, size) {
    return [
        normalizeNumberLike(margin?.top, size.height) ?? 0,
        normalizeNumberLike(margin?.right, size.width) ?? 0,
        normalizeNumberLike(margin?.bottom, size.height) ?? 0,
        normalizeNumberLike(margin?.left, size.width) ?? 0,
    ];
}
function removeHtmlOptions(options) {
    const result = { ...options };
    delete result['id'];
    delete result['classNames'];
    return result;
}
function getWidth(size) {
    return size?.width ?? size?.x;
}
function getHeight(size) {
    return size?.height ?? size?.y;
}
//# sourceMappingURL=common.js.map