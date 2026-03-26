"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplyNodeLoader = exports.RailwayLoader = void 0;
const tslib_1 = require("tslib");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class RailwayLoader extends common_1.FileLoader {
    constructor(defaultMapLoader) {
        super("map/railways.txt");
        this.defaultMapLoader = defaultMapLoader;
    }
    shouldReloadImpl(session) {
        const _super = Object.create(null, {
            shouldReloadImpl: { get: () => super.shouldReloadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return (yield _super.shouldReloadImpl.call(this, session)) || (yield this.defaultMapLoader.shouldReload(session));
        });
    }
    loadImpl(session) {
        const _super = Object.create(null, {
            loadImpl: { get: () => super.loadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingrailways', 'Loading railways...'));
            return _super.loadImpl.call(this, session);
        });
    }
    loadFromFile(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const provinceMap = yield this.defaultMapLoader.load(session);
            const warnings = [];
            return {
                result: {
                    railways: yield loadRailway(provinceMap.result.provinces, this.file, warnings)
                },
                warnings,
            };
        });
    }
    toString() {
        return `[RailwayLoader: ${this.file}]`;
    }
}
exports.RailwayLoader = RailwayLoader;
function loadRailway(provinces, file, warnings) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [railwaysBuffer] = yield (0, fileloader_1.readFileFromModOrHOI4)(file);
        const railwaysRaw = railwaysBuffer.toString().split(/(?:\r\n|\n|\r)/).map(line => line.trimLeft().split(/\s+/).map(v => parseInt(v))).filter(v => v.length >= 3);
        const railways = railwaysRaw.map((line, index) => {
            if (line[1] + 2 > line.length) {
                warnings.push({
                    source: [{ type: 'railway', id: index }],
                    relatedFiles: [file],
                    text: (0, i18n_1.localize)('worldmap.warnings.railwaylinecountnotenough', 'Not enough provinces in railway: {0}', line),
                });
            }
            return {
                level: line[0],
                provinces: line.slice(2, Math.min(line[1] + 2, line.length)),
            };
        });
        validateRailways(provinces, file, railways, warnings);
        return railways;
    });
}
function validateRailways(provinces, file, railways, warnings) {
    railways.forEach(railway => {
        railway.provinces.forEach((provinceId, index) => {
            const province = provinces[provinceId];
            if (!province) {
                warnings.push({
                    source: [{ type: 'railway', id: index }, { type: 'province', id: provinceId, color: 0 }],
                    text: (0, i18n_1.localize)('worldmap.warnings.provincenotexist', 'Province with id {0} doesn\'t exist.', provinceId),
                    relatedFiles: [file],
                });
            }
            else if (index > 0) {
                const lastProvinceId = railway.provinces[index - 1];
                const hasEdge = province.edges.filter(e => e.to === lastProvinceId && e.type !== 'impassable').length > 0;
                if (!hasEdge) {
                    warnings.push({
                        source: [{ type: 'railway', id: index }, { type: 'province', id: provinceId, color: 0 }, { type: 'province', id: lastProvinceId, color: 0 }],
                        text: (0, i18n_1.localize)('worldmap.warnings.provincenotadjacent', 'Province {0}, {1} are not adjacent.', provinceId, lastProvinceId),
                        relatedFiles: [file],
                    });
                }
            }
        });
    });
}
class SupplyNodeLoader extends common_1.FileLoader {
    constructor(defaultMapLoader) {
        super("map/supply_nodes.txt");
        this.defaultMapLoader = defaultMapLoader;
    }
    shouldReloadImpl(session) {
        const _super = Object.create(null, {
            shouldReloadImpl: { get: () => super.shouldReloadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return (yield _super.shouldReloadImpl.call(this, session)) || (yield this.defaultMapLoader.shouldReload(session));
        });
    }
    loadImpl(session) {
        const _super = Object.create(null, {
            loadImpl: { get: () => super.loadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingsupplynodes', 'Loading supply nodes...'));
            return _super.loadImpl.call(this, session);
        });
    }
    loadFromFile(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const provinceMap = yield this.defaultMapLoader.load(session);
            const warnings = [];
            return {
                result: {
                    supplyNodes: yield loadSupplyNodes(provinceMap.result.provinces, this.file, warnings)
                },
                warnings,
            };
        });
    }
    toString() {
        return `[SupplyNodeLoader: ${this.file}]`;
    }
}
exports.SupplyNodeLoader = SupplyNodeLoader;
function loadSupplyNodes(provinces, file, warnings) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const [supplyNodesBuffer] = yield (0, fileloader_1.readFileFromModOrHOI4)(file);
        const supplyNodesRaw = supplyNodesBuffer.toString().split(/(?:\r\n|\n|\r)/).map(line => line.split(/\s+/).map(v => parseInt(v))).filter(v => v.length >= 2);
        const supplyNodes = supplyNodesRaw.map((line, index) => {
            const provinceId = line[1];
            if (!provinces[provinceId]) {
                warnings.push({
                    source: [{ type: 'supplynode', id: index }, { type: 'province', id: provinceId, color: 0 }],
                    text: (0, i18n_1.localize)('worldmap.warnings.provincenotexist', 'Province with id {0} doesn\'t exist.', provinceId),
                    relatedFiles: [file],
                });
            }
            return {
                level: line[0],
                province: provinceId,
            };
        });
        return supplyNodes;
    });
}
//# sourceMappingURL=railway.js.map