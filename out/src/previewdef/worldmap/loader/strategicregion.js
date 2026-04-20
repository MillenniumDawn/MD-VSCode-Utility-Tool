"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategicRegionsLoader = void 0;
const common_1 = require("./common");
const fileloader_1 = require("../../../util/fileloader");
const debug_1 = require("../../../util/debug");
const i18n_1 = require("../../../util/i18n");
const common_2 = require("../../../util/common");
const lodash_1 = require("lodash");
const strategicRegionFileSchema = {
    strategic_region: {
        _innerType: {
            id: "number",
            name: "string",
            provinces: "enum",
            naval_terrain: "string",
        },
        _type: "array",
    },
};
class StrategicRegionsLoader extends common_1.FolderLoader {
    defaultMapLoader;
    statesLoader;
    constructor(defaultMapLoader, statesLoader) {
        super('map/strategicregions', StrategicRegionLoader);
        this.defaultMapLoader = defaultMapLoader;
        this.statesLoader = statesLoader;
    }
    async shouldReloadImpl(session) {
        return await super.shouldReloadImpl(session) || await this.defaultMapLoader.shouldReload(session) || await this.statesLoader.shouldReload(session);
    }
    async loadImpl(session) {
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingstrategicregions', 'Loading strategic regions...'));
        return super.loadImpl(session);
    }
    async mergeFiles(fileResults, session) {
        const provinceMap = await this.defaultMapLoader.load(session);
        const stateMap = await this.statesLoader.load(session);
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.mapprovincestostrategicregions', 'Mapping provinces to strategic regions...'));
        const warnings = (0, common_1.mergeInLoadResult)(fileResults, 'warnings');
        const strategicRegions = (0, lodash_1.flatMap)(fileResults, c => c.result);
        const { width, provinces, terrains } = provinceMap.result;
        validateStrategicRegions(strategicRegions, terrains, warnings);
        const { sortedStrategicRegions, badStrategicRegionId } = sortStrategicRegions(strategicRegions, warnings);
        const { states, badStatesCount } = stateMap.result;
        const badStrategicRegionsCount = badStrategicRegionId + 1;
        const filledStrategicRegions = new Array(sortedStrategicRegions.length);
        for (let i = badStrategicRegionsCount; i < sortedStrategicRegions.length; i++) {
            if (sortedStrategicRegions[i]) {
                filledStrategicRegions[i] = calculateBoundingBox(sortedStrategicRegions[i], provinces, width, warnings);
            }
        }
        validateProvincesInStrategicRegions(provinces, states, filledStrategicRegions, badStatesCount, badStrategicRegionsCount, warnings);
        return {
            result: {
                strategicRegions: filledStrategicRegions,
                badStrategicRegionsCount,
            },
            dependencies: [this.folder + '/*'],
            warnings,
        };
    }
    toString() {
        return `[StrategicRegionsLoader]`;
    }
}
exports.StrategicRegionsLoader = StrategicRegionsLoader;
class StrategicRegionLoader extends common_1.FileLoader {
    async loadFromFile() {
        const warnings = [];
        return {
            result: await loadStrategicRegion(this.file, warnings),
            warnings,
        };
    }
    toString() {
        return `[StrategicRegionLoader: ${this.file}]`;
    }
}
async function loadStrategicRegion(file, globalWarnings) {
    const result = [];
    try {
        const data = await (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, strategicRegionFileSchema);
        for (const strategicRegion of data.strategic_region) {
            const warnings = [];
            const id = strategicRegion.id ? strategicRegion.id : (warnings.push((0, i18n_1.localize)('worldmap.warnings.strategicregionnoid', "A strategic region in \"{0}\" doesn't have id field.", file)), -1);
            const name = strategicRegion.name ? strategicRegion.name : (warnings.push((0, i18n_1.localize)('worldmap.warnings.strategicregionnoname', "Strategic region {0} doesn't have name field.", id)), '');
            const provinces = strategicRegion.provinces._values.map(v => parseInt(v));
            const navalTerrain = strategicRegion.naval_terrain ?? null;
            if (provinces.length === 0) {
                warnings.push((0, i18n_1.localize)('worldmap.warnings.strategicregionnoprovinces', "Strategic region {0} in \"{1}\" doesn't have provinces.", id, file));
            }
            globalWarnings.push(...warnings.map(warning => ({
                source: [{ type: 'strategicregion', id }],
                relatedFiles: [file],
                text: warning,
            })));
            result.push({
                id,
                name,
                provinces,
                navalTerrain,
                file,
                token: strategicRegion._token ?? null,
            });
        }
    }
    catch (e) {
        (0, debug_1.error)(e);
    }
    return result;
}
function validateStrategicRegions(strategicRegions, terrains, warnings) {
    const terrainMap = (0, common_2.arrayToMap)(terrains, 'name');
    for (const strategicRegion of strategicRegions) {
        const terrain = strategicRegion.navalTerrain;
        if (terrain !== null) {
            const terrainObj = terrainMap[terrain];
            if (!terrainObj || !terrainObj.isNaval) {
                warnings.push({
                    source: [{
                            type: 'strategicregion',
                            id: strategicRegion.id,
                        }],
                    relatedFiles: [strategicRegion.file],
                    text: (0, i18n_1.localize)('worldmap.warnings.navalterrainnotdefined', 'Naval terrain "{0}" is not defined.', terrain),
                });
            }
        }
    }
}
function sortStrategicRegions(strategicRegions, warnings) {
    const { sorted, badId } = (0, common_1.sortItems)(strategicRegions, 10000, (maxId) => { throw new common_2.UserError((0, i18n_1.localize)('worldmap.warnings.strategicregionidtoolarge', 'Max strategic region ID is too large: {0}.', maxId)); }, (newStrategicRegion, existingStrategicRegion, badId) => warnings.push({
        source: [{ type: 'strategicregion', id: badId }],
        relatedFiles: [newStrategicRegion.file, existingStrategicRegion.file],
        text: (0, i18n_1.localize)('worldmap.warnings.strategicregionidconflict', "There're more than one strategic regions using ID {0}.", newStrategicRegion.id),
    }), (startId, endId) => warnings.push({
        source: [{ type: 'strategicregion', id: startId }],
        relatedFiles: [],
        text: (0, i18n_1.localize)('worldmap.warnings.strategicregionnotexist', "Strategic region with id {0} doesn't exist.", startId === endId ? startId : `${startId}-${endId}`),
    }));
    return {
        sortedStrategicRegions: sorted,
        badStrategicRegionId: badId,
    };
}
function calculateBoundingBox(strategicRegionNoRegion, provinces, width, warnings) {
    return (0, common_1.mergeRegion)(strategicRegionNoRegion, 'provinces', provinces, width, provinceId => warnings.push({
        source: [{ type: 'strategicregion', id: strategicRegionNoRegion.id }],
        relatedFiles: [strategicRegionNoRegion.file],
        text: (0, i18n_1.localize)('worldmap.warnings.provinceinstrategicregionnotexist', "Province {0} used in strategic region {1} doesn't exist.", provinceId, strategicRegionNoRegion.id),
    }), () => warnings.push({
        source: [{ type: 'strategicregion', id: strategicRegionNoRegion.id }],
        relatedFiles: [strategicRegionNoRegion.file],
        text: (0, i18n_1.localize)('worldmap.warnings.strategicregionnovalidprovinces', "Strategic region {0} doesn't have valid provinces.", strategicRegionNoRegion.id),
    }));
}
function validateProvincesInStrategicRegions(provinces, states, strategicRegions, badStatesCount, badStrategicRegionsCount, warnings) {
    const provinceToStrategicRegion = {};
    for (let i = badStrategicRegionsCount; i < strategicRegions.length; i++) {
        const strategicRegion = strategicRegions[i];
        if (!strategicRegion) {
            continue;
        }
        strategicRegion.provinces.forEach(p => {
            const province = provinces[p];
            if (provinceToStrategicRegion[p] !== undefined) {
                if (!province) {
                    return;
                }
                warnings.push({
                    source: [
                        ...[strategicRegion.id, provinceToStrategicRegion[p]].map(id => ({ type: 'strategicregion', id })),
                        { type: 'province', id: p, color: province.color }
                    ],
                    relatedFiles: [strategicRegion.file, strategicRegions[provinceToStrategicRegion[p]].file],
                    text: (0, i18n_1.localize)('worldmap.warnings.provinceinmultiplestrategicregions', 'Province {0} exists in multiple strategic regions: {1}, {2}.', p, provinceToStrategicRegion[p], strategicRegion.id),
                });
            }
            else {
                provinceToStrategicRegion[p] = strategicRegion.id;
            }
        });
    }
    for (let i = 1; i < provinces.length; i++) {
        const province = provinces[i];
        if (!province) {
            continue;
        }
        if (!(i in provinceToStrategicRegion)) {
            warnings.push({
                source: [{ type: 'province', id: i, color: province.color }],
                relatedFiles: [],
                text: (0, i18n_1.localize)('worldmap.warnings.provincenostrategicregion', 'Province {0} is not in any strategic region.', i),
            });
        }
    }
    for (let i = badStatesCount; i < states.length; i++) {
        const state = states[i];
        if (!state) {
            continue;
        }
        const strategicRegionId = state.provinces
            .filter(p => provinces[p])
            .map(p => [p, provinceToStrategicRegion[p]])
            .filter(p => p[1] !== undefined);
        const strategicRegionIdCount = {};
        strategicRegionId.forEach(([_, sr]) => strategicRegionIdCount[sr] = (strategicRegionIdCount[sr] ?? 0) + 1);
        const entries = Object.entries(strategicRegionIdCount);
        if (entries.length > 1) {
            entries.sort((a, b) => b[1] - a[1]);
            const mostStrategicRegionId = parseInt(entries[0][0]);
            const badProvinces = strategicRegionId.filter(([_, sr]) => sr !== mostStrategicRegionId).map(v => v[0]);
            warnings.push({
                source: [
                    ...badProvinces.map(id => ({ type: 'province', id, color: provinces[id]?.color ?? -1 })),
                    { type: 'state', id: i },
                ],
                relatedFiles: [state.file],
                text: (0, i18n_1.localize)('worldmap.warnings.stateinmultiplestrategicregions', 'In state {0}, province {1} are not belong to same strategic region as other provinces.', i, badProvinces.join(', ')),
            });
        }
    }
}
//# sourceMappingURL=strategicregion.js.map