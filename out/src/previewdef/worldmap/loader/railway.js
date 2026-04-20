"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplyNodeLoader = exports.RailwayLoader = void 0;
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const common_1 = require("./common");
class RailwayLoader extends common_1.FileLoader {
    defaultMapLoader;
    constructor(defaultMapLoader) {
        super("map/railways.txt");
        this.defaultMapLoader = defaultMapLoader;
    }
    async shouldReloadImpl(session) {
        return await super.shouldReloadImpl(session) || await this.defaultMapLoader.shouldReload(session);
    }
    async loadImpl(session) {
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingrailways', 'Loading railways...'));
        return super.loadImpl(session);
    }
    async loadFromFile(session) {
        const provinceMap = await this.defaultMapLoader.load(session);
        const warnings = [];
        return {
            result: {
                railways: await loadRailway(provinceMap.result.provinces, this.file, warnings)
            },
            warnings,
        };
    }
    toString() {
        return `[RailwayLoader: ${this.file}]`;
    }
}
exports.RailwayLoader = RailwayLoader;
async function loadRailway(provinces, file, warnings) {
    const [railwaysBuffer] = await (0, fileloader_1.readFileFromModOrHOI4)(file);
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
    defaultMapLoader;
    constructor(defaultMapLoader) {
        super("map/supply_nodes.txt");
        this.defaultMapLoader = defaultMapLoader;
    }
    async shouldReloadImpl(session) {
        return await super.shouldReloadImpl(session) || await this.defaultMapLoader.shouldReload(session);
    }
    async loadImpl(session) {
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingsupplynodes', 'Loading supply nodes...'));
        return super.loadImpl(session);
    }
    async loadFromFile(session) {
        const provinceMap = await this.defaultMapLoader.load(session);
        const warnings = [];
        return {
            result: {
                supplyNodes: await loadSupplyNodes(provinceMap.result.provinces, this.file, warnings)
            },
            warnings,
        };
    }
    toString() {
        return `[SupplyNodeLoader: ${this.file}]`;
    }
}
exports.SupplyNodeLoader = SupplyNodeLoader;
async function loadSupplyNodes(provinces, file, warnings) {
    const [supplyNodesBuffer] = await (0, fileloader_1.readFileFromModOrHOI4)(file);
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
}
//# sourceMappingURL=railway.js.map