"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHeight = exports.getWidth = exports.removeHtmlOptions = exports.normalizeMargin = exports.calculateBBox = exports.calculateStartLength = exports.normalizeNumberLike = void 0;
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
exports.normalizeNumberLike = normalizeNumberLike;
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
    var _a, _b, _c, _d;
    let posValue = (_a = normalizeNumberLike(pos, parentSize)) !== null && _a !== void 0 ? _a : 0;
    let length = ((_b = normalizeNumberLike(size, parentSize)) !== null && _b !== void 0 ? _b : 0) * scale;
    if ((size === null || size === void 0 ? void 0 : size._unit) === '%%') {
        length = length - posValue;
    }
    if (length < 0) {
        length = length + parentSize;
    }
    const start = posValue + parentSize * orientationFactor - length * origoFactor;
    if ((size === null || size === void 0 ? void 0 : size._unit) === '%%' || ((_c = size === null || size === void 0 ? void 0 : size._value) !== null && _c !== void 0 ? _c : 0) < 0) {
        let end = (_d = normalizeNumberLike(size, parentSize)) !== null && _d !== void 0 ? _d : 0;
        if (end < 0) {
            end = end + parentSize;
        }
        length = Math.max(0, end - start);
    }
    return [start, length];
}
exports.calculateStartLength = calculateStartLength;
function calculateBBox({ orientation, origo, position, size, scale }, parentInfo) {
    var _a, _b, _c, _d, _e, _f;
    const myOrientation = (_a = orientation === null || orientation === void 0 ? void 0 : orientation._name) !== null && _a !== void 0 ? _a : 'upper_left';
    const parentSize = parentInfo.size;
    const orientationFactor = (_b = offsetMap[myOrientation]) !== null && _b !== void 0 ? _b : offsetMap['upper_left'];
    const origoFactor = (_d = offsetMap[(_c = origo === null || origo === void 0 ? void 0 : origo._name) !== null && _c !== void 0 ? _c : 'upper_left']) !== null && _d !== void 0 ? _d : offsetMap['upper_left'];
    let [x, width] = calculateStartLength(position === null || position === void 0 ? void 0 : position.x, getWidth(size), parentSize.width, orientationFactor.x, origoFactor.x, scale !== null && scale !== void 0 ? scale : 1);
    let [y, height] = calculateStartLength(position === null || position === void 0 ? void 0 : position.y, getHeight(size), parentSize.height, orientationFactor.y, origoFactor.y, scale !== null && scale !== void 0 ? scale : 1);
    const minWidth = (_e = normalizeNumberLike(getWidth(size === null || size === void 0 ? void 0 : size.min), parentSize.width, x)) !== null && _e !== void 0 ? _e : width;
    const minHeight = (_f = normalizeNumberLike(getHeight(size === null || size === void 0 ? void 0 : size.min), parentSize.height, y)) !== null && _f !== void 0 ? _f : height;
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
    return [x, y, width, height, myOrientation];
}
exports.calculateBBox = calculateBBox;
function normalizeMargin(margin, size) {
    var _a, _b, _c, _d;
    return [
        (_a = normalizeNumberLike(margin === null || margin === void 0 ? void 0 : margin.top, size.height)) !== null && _a !== void 0 ? _a : 0,
        (_b = normalizeNumberLike(margin === null || margin === void 0 ? void 0 : margin.right, size.width)) !== null && _b !== void 0 ? _b : 0,
        (_c = normalizeNumberLike(margin === null || margin === void 0 ? void 0 : margin.bottom, size.height)) !== null && _c !== void 0 ? _c : 0,
        (_d = normalizeNumberLike(margin === null || margin === void 0 ? void 0 : margin.left, size.width)) !== null && _d !== void 0 ? _d : 0,
    ];
}
exports.normalizeMargin = normalizeMargin;
function removeHtmlOptions(options) {
    const result = Object.assign({}, options);
    delete result['id'];
    delete result['classNames'];
    return result;
}
exports.removeHtmlOptions = removeHtmlOptions;
function getWidth(size) {
    var _a;
    return (_a = size === null || size === void 0 ? void 0 : size.width) !== null && _a !== void 0 ? _a : size === null || size === void 0 ? void 0 : size.x;
}
exports.getWidth = getWidth;
function getHeight(size) {
    var _a;
    return (_a = size === null || size === void 0 ? void 0 : size.height) !== null && _a !== void 0 ? _a : size === null || size === void 0 ? void 0 : size.y;
}
exports.getHeight = getHeight;
//# sourceMappingURL=common.js.map