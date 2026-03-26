"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultMapLoader = void 0;
const tslib_1 = require("tslib");
const common_1 = require("./common");
const fileloader_1 = require("../../../util/fileloader");
const terrain_1 = require("./terrain");
const common_2 = require("../../../util/common");
const i18n_1 = require("../../../util/i18n");
const provincedefinitions_1 = require("./provincedefinitions");
const adjacencies_1 = require("./adjacencies");
const continents_1 = require("./continents");
const provincebmp_1 = require("./provincebmp");
const river_1 = require("./river");
const defaultMapSchema = {
    definitions: 'string',
    provinces: 'string',
    adjacencies: 'string',
    continent: 'string',
    rivers: 'string',
};
class DefaultMapLoader extends common_1.FileLoader {
    constructor() {
        super('map/default.map');
        this.terrainDefinitionLoader = new terrain_1.TerrainDefinitionLoader();
        this.terrainDefinitionLoader.onProgress(e => this.onProgressEmitter.fire(e));
    }
    shouldReloadImpl(session) {
        const _super = Object.create(null, {
            shouldReloadImpl: { get: () => super.shouldReloadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (yield _super.shouldReloadImpl.call(this, session)) {
                return true;
            }
            return (yield Promise.all([
                this.definitionsLoader,
                this.provinceBmpLoader,
                this.adjacenciesLoader,
                this.continentsLoader,
                this.terrainDefinitionLoader,
                this.riverLoader,
            ].map(v => { var _a; return (_a = v === null || v === void 0 ? void 0 : v.shouldReload(session)) !== null && _a !== void 0 ? _a : Promise.resolve(false); }))).some(v => v);
        });
    }
    loadFromFile(session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const defaultMap = yield loadDefaultMap(e => this.fireOnProgressEvent(e));
            session.throwIfCancelled();
            const provinceDefinitions = yield (this.definitionsLoader = this.checkAndCreateLoader(this.definitionsLoader, 'map/' + defaultMap.definitions, provincedefinitions_1.DefinitionsLoader)).load(session);
            session.throwIfCancelled();
            const provinceBmp = yield (this.provinceBmpLoader = this.checkAndCreateLoader(this.provinceBmpLoader, 'map/' + defaultMap.provinces, provincebmp_1.ProvinceBmpLoader)).load(session);
            session.throwIfCancelled();
            const adjacencies = yield (this.adjacenciesLoader = this.checkAndCreateLoader(this.adjacenciesLoader, 'map/' + defaultMap.adjacencies, adjacencies_1.AdjacenciesLoader)).load(session);
            session.throwIfCancelled();
            const continents = yield (this.continentsLoader = this.checkAndCreateLoader(this.continentsLoader, 'map/' + defaultMap.continent, continents_1.ContinentsLoader)).load(session);
            session.throwIfCancelled();
            const terrains = yield this.terrainDefinitionLoader.load(session);
            session.throwIfCancelled();
            const rivers = yield (this.riverLoader = this.checkAndCreateLoader(this.riverLoader, 'map/' + defaultMap.rivers, river_1.RiverLoader)).load(session);
            session.throwIfCancelled();
            const subLoaderResults = [provinceDefinitions, provinceBmp, adjacencies, continents, terrains, rivers];
            const warnings = (0, common_1.mergeInLoadResult)(subLoaderResults, 'warnings');
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.mergeandvalidateprovince', 'Merging and validating provinces...'));
            const { provinces, badProvinceId: badProvinceIdForMerge } = mergeProvinceDefinitions(provinceDefinitions.result, provinceBmp.result, ['map/' + defaultMap.definitions, 'map/' + defaultMap.provinces], warnings);
            validateProvinceContinents(provinces, continents.result, ['map/' + defaultMap.definitions, 'map/' + defaultMap.continent], warnings);
            validateProvinceTerrains(provinces, terrains.result, ['map/' + defaultMap.definitions], warnings);
            fillAdjacencyEdges(provinces, adjacencies.result, provinceBmp.result.height, ['map/' + defaultMap.provinces, 'map/' + defaultMap.definitions], warnings);
            const { sortedProvinces, badProvinceId } = sortProvinces(provinces, badProvinceIdForMerge, ['map/' + defaultMap.definitions], warnings);
            if (rivers.result.width !== provinceBmp.result.width || rivers.result.height !== provinceBmp.result.height) {
                warnings.push({
                    relatedFiles: [this.provinceBmpLoader.file, this.riverLoader.file],
                    text: (0, i18n_1.localize)('worldmap.warning.riversizenotmatch', 'Size of the rivers image ({0}x{1}) doesn\'t match size of province map image ({2}x{3}).', rivers.result.width, rivers.result.height, provinceBmp.result.width, provinceBmp.result.height),
                    source: [{ type: 'river', name: '', index: -1 }]
                });
            }
            return {
                result: {
                    width: provinceBmp.result.width,
                    height: provinceBmp.result.height,
                    colorByPosition: provinceBmp.result.colorByPosition,
                    provinces: sortedProvinces,
                    badProvincesCount: badProvinceId + 1,
                    continents: continents.result,
                    terrains: terrains.result,
                    rivers: rivers.result.rivers,
                },
                dependencies: (0, common_1.mergeInLoadResult)(subLoaderResults, 'dependencies'),
                warnings,
            };
        });
    }
    checkAndCreateLoader(loader, file, constructor) {
        if (loader && loader.file === file) {
            return loader;
        }
        loader = new constructor(file);
        loader.onProgress(e => this.onProgressEmitter.fire(e));
        return loader;
    }
    extraMesurements(result) {
        return Object.assign(Object.assign({}, super.extraMesurements(result)), { width: result.result.width, height: result.result.height, provinceCount: result.result.provinces.length });
    }
    toString() {
        return `[DefaultMapLoader]`;
    }
}
exports.DefaultMapLoader = DefaultMapLoader;
function loadDefaultMap(progressReporter) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield progressReporter((0, i18n_1.localize)('worldmap.progress.loadingdefaultmap', 'Loading default.map...'));
        const defaultMap = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)('map/default.map', defaultMapSchema);
        ['definitions', 'provinces', 'adjacencies', 'continent'].forEach(field => {
            if (!defaultMap[field]) {
                throw new common_2.UserError((0, i18n_1.localize)('worldmap.error.fieldnotindefaultmap', 'Field "{0}" is not found in default.map.', field));
            }
        });
        return defaultMap;
    });
}
function sortProvinces(provinces, badProvinceId, relatedFiles, warnings) {
    const { sorted, badId } = (0, common_1.sortItems)(provinces, 200000, (maxId) => { throw new common_2.UserError((0, i18n_1.localize)('worldmap.error.provinceidtoolarge', 'Max province id is too large: {0}.', maxId)); }, (newProvince, existingProvince, badId) => warnings.push({
        source: [{ type: 'province', id: badId, color: existingProvince.color }],
        relatedFiles,
        text: (0, i18n_1.localize)('worldmap.warnings.provinceidconflict', "There're more than one rows for province id {0}. Set id to {1}.", newProvince.id, badProvinceId),
    }), (startId, endId) => warnings.push({
        source: [{ type: 'province', id: startId, color: -1 }],
        relatedFiles: [],
        text: (0, i18n_1.localize)('worldmap.warnings.provincenotexist', "Province with id {0} doesn't exist.", startId === endId ? startId : `${startId}-${endId}`),
    }), false, badProvinceId);
    return {
        sortedProvinces: sorted,
        badProvinceId: badId,
    };
}
function mergeProvinceDefinitions(provinceDefinitions, { provinces, colorToProvince }, relatedFiles, warnings) {
    const result = [];
    const colorToProvinceId = {};
    for (const provinceDef of provinceDefinitions) {
        if (colorToProvinceId[provinceDef.color] !== undefined) {
            warnings.push({
                source: [provinceDef.id, colorToProvinceId[provinceDef.color]].map(id => ({ type: 'province', id, color: provinceDef.color })),
                relatedFiles: relatedFiles.slice(0, 1),
                text: (0, i18n_1.localize)('worldmap.warnings.provincecolorconflict', 'Province {0} has conflict color with province {1}.', provinceDef.id, colorToProvinceId[provinceDef.color]),
            });
        }
        colorToProvinceId[provinceDef.color] = provinceDef.id;
        const provinceInMap = colorToProvince[provinceDef.color];
        if (provinceInMap) {
            result.push(Object.assign(Object.assign(Object.assign({}, provinceDef), provinceInMap), { edges: [] }));
        }
        else {
            if (provinceDef.id !== 0) {
                warnings.push({
                    source: [{ type: 'province', id: provinceDef.id, color: provinceDef.color }],
                    relatedFiles: relatedFiles,
                    text: (0, i18n_1.localize)('worldmap.warnings.provincenotexistonmap', "Province {0} doesn't exist on map.", provinceDef.id),
                });
            }
            result.push(Object.assign(Object.assign({}, provinceDef), { boundingBox: { x: 0, y: 0, w: 0, h: 0 }, mass: 0, centerOfMass: { x: 0, y: 0 }, coverZones: [], edges: [] }));
        }
    }
    let badId = -1;
    for (const provinceInMap of provinces) {
        const color = provinceInMap.color;
        if (colorToProvinceId[color]) {
            continue;
        }
        const useBadId = badId--;
        warnings.push({
            source: [{ type: 'province', id: useBadId, color }],
            relatedFiles,
            text: (0, i18n_1.localize)('worldmap.warnings.provincenotexistindef', "Province with color ({0}, {1}, {2}) in provinces bmp ({3}, {4}) doesn't exist in definitions.", (color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF, provinceInMap.coverZones[0].x, provinceInMap.coverZones[0].y),
        });
        colorToProvinceId[color] = useBadId;
        result.push(Object.assign(Object.assign({}, provinceInMap), { edges: [], id: useBadId, continent: 0, type: 'sea', coastal: false, terrain: '' }));
    }
    for (const province of result) {
        const provinceInMap = colorToProvince[province.color];
        if (provinceInMap) {
            province.edges = provinceInMap.edges.map(e => { var _a; return (Object.assign(Object.assign({}, e), { to: (_a = colorToProvinceId[e.toColor]) !== null && _a !== void 0 ? _a : -1, type: '' })); });
        }
    }
    for (const warning of warnings) {
        for (const source of warning.source) {
            if (source.type === 'province' && source.id === -1) {
                const provinceId = colorToProvinceId[source.color];
                if (provinceId !== undefined) {
                    source.id = provinceId;
                }
            }
        }
    }
    return { provinces: result, badProvinceId: badId };
}
function validateProvinceContinents(provinces, continents, relatedFiles, warnings) {
    for (const province of provinces) {
        const continent = province.continent;
        if (continent >= continents.length || continent < 0) {
            warnings.push({
                source: [{
                        type: 'province',
                        id: province.id,
                        color: province.color,
                    }],
                relatedFiles,
                text: (0, i18n_1.localize)('worldmap.warnings.continentnotdefined', 'Continent {0} is not defined.', continent),
            });
        }
        if (province.type === 'land' && (continent === 0 || isNaN(continent)) && province.id !== 0) {
            warnings.push({
                source: [{
                        type: 'province',
                        id: province.id,
                        color: province.color,
                    }],
                relatedFiles,
                text: (0, i18n_1.localize)('worldmap.warnings.provincenocontinent', 'Land province {0} must belong to a continent.', province.id),
            });
        }
    }
}
function validateProvinceTerrains(provinces, terrains, relatedFiles, warnings) {
    const terrainMap = (0, common_2.arrayToMap)(terrains, 'name');
    for (const province of provinces) {
        const terrain = province.terrain;
        const terrainObj = terrainMap[terrain];
        if (!terrainObj) {
            warnings.push({
                source: [{
                        type: 'province',
                        id: province.id,
                        color: province.color,
                    }],
                relatedFiles,
                text: (0, i18n_1.localize)('worldmap.warnings.terrainnotdefined', 'Terrain "{0}" is not defined.', terrain),
            });
        }
    }
}
function fillAdjacencyEdges(provinces, adjacencies, height, relatedFiles, warnings) {
    for (const { row, from, to, through, start: saveStart, stop: saveStop, rule, type } of adjacencies) {
        if (!provinces[from] || !provinces[to]) {
            warnings.push({
                source: [{ type: 'province', id: from, color: -1 }],
                relatedFiles,
                text: (0, i18n_1.localize)('worldmap.warnings.adjacencynotexist', 'Adjacency not from or to an existing province: {0}, {1}', row[0], row[1]),
            });
            continue;
        }
        const resultThrough = through !== undefined && !isNaN(through) && through !== -1 ? through : undefined;
        if (resultThrough && !provinces[resultThrough]) {
            warnings.push({
                source: [{ type: 'province', id: resultThrough, color: -1 }],
                relatedFiles,
                text: (0, i18n_1.localize)('worldmap.warnings.adjacencythroughnotexist', 'Adjacency not through an existing province: {0}', row[3]),
            });
            continue;
        }
        const start = saveStart ? Object.assign(Object.assign({}, saveStart), { y: height - saveStart.y }) : undefined;
        const stop = saveStop ? Object.assign(Object.assign({}, saveStop), { y: height - saveStop.y }) : undefined;
        const existingEdgeInFrom = provinces[from].edges.find(e => e.to === to);
        if (existingEdgeInFrom) {
            Object.assign(existingEdgeInFrom, { through: resultThrough, start, stop, rule, type });
        }
        else {
            provinces[from].edges.push({ to, through: resultThrough, start, stop, rule, type, path: [] });
        }
        const existingEdgeInTo = provinces[to].edges.find(e => e.to === from);
        if (existingEdgeInTo) {
            Object.assign(existingEdgeInTo, { through: resultThrough, start, stop, rule, type });
        }
        else {
            provinces[to].edges.push({ to: from, through: resultThrough, start: stop, stop: start, rule, type, path: [] });
        }
    }
}
//# sourceMappingURL=provincemap.js.map