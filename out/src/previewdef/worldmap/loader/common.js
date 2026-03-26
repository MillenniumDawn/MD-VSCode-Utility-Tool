"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPointToZone = exports.mergeRegions = exports.mergeRegion = exports.sortItems = exports.convertColor = exports.pointEqual = exports.mergeInLoadResult = exports.FolderLoader = exports.FileLoader = exports.Loader = void 0;
const common_1 = require("../../../util/common");
const loader_1 = require("../../../util/loader/loader");
const lodash_1 = require("lodash");
class Loader extends loader_1.Loader {
}
exports.Loader = Loader;
class FileLoader extends loader_1.FileLoader {
}
exports.FileLoader = FileLoader;
class FolderLoader extends loader_1.FolderLoader {
}
exports.FolderLoader = FolderLoader;
exports.mergeInLoadResult = loader_1.mergeInLoadResult;
function pointEqual(a, b) {
    return a.x === b.x && a.y === b.y;
}
exports.pointEqual = pointEqual;
function convertColor(color) {
    if (!color) {
        return 0;
    }
    const vec = color._value._values.map(e => parseFloat(e));
    if (vec.length < 3) {
        return 0;
    }
    if (!color._attachment || color._attachment.toLowerCase() === 'rgb') {
        let [r, g, b] = vec;
        r = (0, common_1.clipNumber)(r, 0, 255);
        g = (0, common_1.clipNumber)(g, 0, 255);
        b = (0, common_1.clipNumber)(b, 0, 255);
        return (r << 16) | (g << 8) | b;
    }
    if (color._attachment.toLowerCase() === 'hsv') {
        const { r, g, b } = (0, common_1.hsvToRgb)(vec[0], vec[1], vec[2]);
        return (r << 16) | (g << 8) | b;
    }
    return 0;
}
exports.convertColor = convertColor;
function sortItems(items, validMaxId, onMaxIdTooLarge, onConflict, onNotExist, reassignMinusOneId = true, badId = -1) {
    var _a, _b;
    const maxId = (_b = (_a = (0, lodash_1.maxBy)(items, 'id')) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : 0;
    if (maxId > validMaxId) {
        onMaxIdTooLarge(maxId);
    }
    const result = new Array(maxId + 1);
    items.forEach(p => {
        if (reassignMinusOneId && p.id === -1) {
            p.id = badId--;
        }
        if (result[p.id]) {
            const conflictItem = result[p.id];
            onConflict(p, conflictItem, badId);
            conflictItem.id = badId--;
            result[conflictItem.id] = conflictItem;
        }
        result[p.id] = p;
    });
    let lastNotExistStateId = undefined;
    for (let i = 1; i <= maxId; i++) {
        if (result[i]) {
            if (lastNotExistStateId !== undefined) {
                onNotExist(lastNotExistStateId, i - 1);
                lastNotExistStateId = undefined;
            }
        }
        else {
            if (lastNotExistStateId === undefined) {
                lastNotExistStateId = i;
            }
        }
    }
    ;
    return {
        sorted: result,
        badId,
    };
}
exports.sortItems = sortItems;
function mergeRegion(input, subRegionIdType, subRegions, width, onRegionNotExist, onNoRegion) {
    const regionsInInput = input[subRegionIdType]
        .map(r => {
        const region = subRegions[r];
        if (!region) {
            onRegionNotExist(r);
        }
        return region;
    })
        .filter((r) => !!r);
    let result;
    if (regionsInInput.length > 0) {
        result = Object.assign(input, mergeRegions(regionsInInput, width));
    }
    else {
        result = Object.assign(input, { boundingBox: { x: 0, y: 0, w: 0, h: 0 }, centerOfMass: { x: 0, y: 0 }, mass: 0 });
        if (input[subRegionIdType].length > 0) {
            onNoRegion();
        }
    }
    return result;
}
exports.mergeRegion = mergeRegion;
function mergeRegions(regions, width) {
    const oneFourthWidth = 0.25 * width;
    const halfWidth = 0.5 * width;
    const threeFourthWidth = 0.75 * width;
    const nearBorder = regions.map(r => 'mass' in r ? r.boundingBox : r).every(z => z.w + z.x < oneFourthWidth || z.x > threeFourthWidth);
    let massX = 0;
    let massY = 0;
    let mass = 0;
    let minX = 1e10;
    let minY = 1e10;
    let maxX = -1e10;
    let maxY = -1e10;
    for (const region of regions) {
        let regionBondingBox;
        if ('mass' in region) {
            massX += (region.centerOfMass.x + (nearBorder && region.centerOfMass.x > halfWidth ? -width : 0)) * region.mass;
            massY += region.centerOfMass.y * region.mass;
            mass += region.mass;
            regionBondingBox = region.boundingBox;
        }
        else {
            const regionMass = region.h * region.w;
            massX += ((region.x + region.w / 2) + (nearBorder && region.x + region.w / 2 > halfWidth ? -width : 0)) * regionMass;
            massY += (region.y + region.h / 2) * regionMass;
            mass += regionMass;
            regionBondingBox = region;
        }
        minX = Math.min(minX, regionBondingBox.x + (nearBorder && regionBondingBox.x > halfWidth ? -width : 0));
        minY = Math.min(minY, regionBondingBox.y);
        maxX = Math.max(maxX, regionBondingBox.x + regionBondingBox.w + (nearBorder && regionBondingBox.x > halfWidth ? -width : 0));
        maxY = Math.max(maxY, regionBondingBox.y + regionBondingBox.h);
    }
    let x = massX / mass;
    if (x < 0) {
        x += width;
    }
    if (minX < 0) {
        minX += width;
        maxX += width;
    }
    return {
        boundingBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        centerOfMass: { x, y: massY / mass },
        mass,
    };
}
exports.mergeRegions = mergeRegions;
function addPointToZone(zone, point) {
    if (point.x < zone.x) {
        zone.w += zone.x - point.x;
        zone.x = point.x;
    }
    else if (point.x >= zone.x + zone.w) {
        zone.w = point.x - zone.x + 1;
    }
    if (point.y < zone.y) {
        zone.h += zone.y - point.y;
        zone.y = point.y;
    }
    else if (point.y >= zone.y + zone.h) {
        zone.h = point.y - zone.y + 1;
    }
}
exports.addPointToZone = addPointToZone;
//# sourceMappingURL=common.js.map