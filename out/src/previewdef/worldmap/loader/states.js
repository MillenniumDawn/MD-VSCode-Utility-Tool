"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatesLoader = void 0;
const tslib_1 = require("tslib");
const fileloader_1 = require("../../../util/fileloader");
const debug_1 = require("../../../util/debug");
const common_1 = require("./common");
const common_2 = require("../../../util/common");
const i18n_1 = require("../../../util/i18n");
const lodash_1 = require("lodash");
const stateFileSchema = {
    state: {
        _innerType: {
            id: "number",
            name: "string",
            manpower: "number",
            state_category: "string",
            history: {
                owner: "string",
                victory_points: {
                    _innerType: "enum",
                    _type: "array",
                },
                add_core_of: {
                    _innerType: "string",
                    _type: "array",
                },
            },
            provinces: "enum",
            impassable: "boolean",
            resources: {
                _innerType: "number",
                _type: "map",
            },
        },
        _type: "array",
    },
};
const stateCategoryFileSchema = {
    state_categories: {
        _innerType: {
            color: {
                _innerType: "enum",
                _type: "detailvalue",
            },
        },
        _type: "map",
    },
};
class StatesLoader extends common_1.FolderLoader {
    constructor(defaultMapLoader, resourcesLoader) {
        super('history/states', StateLoader);
        this.defaultMapLoader = defaultMapLoader;
        this.resourcesLoader = resourcesLoader;
        this.categoriesLoader = new StateCategoriesLoader();
        this.categoriesLoader.onProgress(e => this.onProgressEmitter.fire(e));
    }
    shouldReloadImpl(session) {
        const _super = Object.create(null, {
            shouldReloadImpl: { get: () => super.shouldReloadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            return (yield _super.shouldReloadImpl.call(this, session)) || (yield this.defaultMapLoader.shouldReload(session))
                || (yield this.categoriesLoader.shouldReload(session)) || (yield this.resourcesLoader.shouldReload(session));
        });
    }
    loadImpl(session) {
        const _super = Object.create(null, {
            loadImpl: { get: () => super.loadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingstates', 'Loading states...'));
            return _super.loadImpl.call(this, session);
        });
    }
    mergeFiles(fileResults, session) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const provinceMap = yield this.defaultMapLoader.load(session);
            const stateCategories = yield this.categoriesLoader.load(session);
            const resources = (0, common_2.arrayToMap)((yield this.resourcesLoader.load(session)).result, 'name');
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.mapprovincestostates', 'Mapping provinces to states...'));
            const warnings = (0, common_1.mergeInLoadResult)([stateCategories, ...fileResults], 'warnings');
            const { provinces, width, height } = provinceMap.result;
            const states = (0, lodash_1.flatMap)(fileResults, c => c.result);
            const { sortedStates, badStateId } = sortStates(states, warnings);
            const filledStates = new Array(sortedStates.length);
            for (let i = badStateId + 1; i < sortedStates.length; i++) {
                if (sortedStates[i]) {
                    const state = calculateBoundingBox(sortedStates[i], provinces, width, height, warnings);
                    filledStates[i] = state;
                    if (!(state.category in stateCategories.result)) {
                        warnings.push({
                            source: [{ type: 'state', id: i }],
                            relatedFiles: [state.file],
                            text: (0, i18n_1.localize)('worldmap.warnings.statecategorynotexist', "State category of state {0} is not defined: {1}.", i, state.category),
                        });
                    }
                    for (const key in state.resources) {
                        if (state.resources[key] !== undefined && !(key in resources)) {
                            warnings.push({
                                source: [{ type: 'state', id: i }],
                                relatedFiles: [state.file],
                                text: (0, i18n_1.localize)('worldmap.warnings.resourcenotexist', "Resource {0} used in state {1} is not defined.", key, i),
                            });
                        }
                    }
                }
            }
            const badStatesCount = badStateId + 1;
            validateProvinceInState(provinces, filledStates, badStatesCount, warnings);
            return {
                result: {
                    states: filledStates,
                    badStatesCount,
                },
                dependencies: [this.folder + '/*', ...stateCategories.dependencies],
                warnings,
            };
        });
    }
    toString() {
        return `[StatesLoader]`;
    }
}
exports.StatesLoader = StatesLoader;
class StateLoader extends common_1.FileLoader {
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const warnings = [];
            return {
                result: yield loadState(this.file, warnings),
                warnings,
            };
        });
    }
    toString() {
        return `[StateLoader: ${this.file}]`;
    }
}
class StateCategoriesLoader extends common_1.FolderLoader {
    constructor() {
        super('common/state_category', StateCategoryLoader);
    }
    loadImpl(session) {
        const _super = Object.create(null, {
            loadImpl: { get: () => super.loadImpl }
        });
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadstatecategories', 'Loading state categories...'));
            return _super.loadImpl.call(this, session);
        });
    }
    mergeFiles(fileResults) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const warnings = (0, common_1.mergeInLoadResult)(fileResults, 'warnings');
            const categories = {};
            fileResults.forEach(result => result.result.forEach(category => {
                if (category.name in categories) {
                    warnings.push({
                        source: [{ type: 'statecategory', name: category.name }],
                        relatedFiles: [category.file, categories[category.name].file],
                        text: (0, i18n_1.localize)('worldmap.warnings.statecategoryconflict', "There're multiple state categories have name \"{0}\".", category.name),
                    });
                }
                categories[category.name] = category;
            }));
            return {
                result: categories,
                dependencies: [this.folder + '/*'],
                warnings,
            };
        });
    }
    toString() {
        return `[StateCategoriesLoader]`;
    }
}
class StateCategoryLoader extends common_1.FileLoader {
    loadFromFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const warnings = [];
            return {
                result: yield loadStateCategory(this.file, warnings),
                warnings,
            };
        });
    }
    toString() {
        return `[StateCategoryLoader: ${this.file}]`;
    }
}
function loadState(stateFile, globalWarnings) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            const data = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(stateFile, stateFileSchema);
            const result = [];
            for (const state of data.state) {
                const warnings = [];
                const id = state.id ? state.id : (warnings.push((0, i18n_1.localize)('worldmap.warnings.statenoid', "A state in {0} doesn't have id field.", stateFile)), -1);
                const name = state.name ? state.name : (warnings.push((0, i18n_1.localize)('worldmap.warnings.statenoname', "The state doesn't have name field.")), '');
                const manpower = (_a = state.manpower) !== null && _a !== void 0 ? _a : 0;
                const category = state.state_category ? state.state_category : (warnings.push((0, i18n_1.localize)('worldmap.warnings.statenocategory', "The state doesn't have category field.")), '');
                const owner = (_b = state.history) === null || _b === void 0 ? void 0 : _b.owner;
                const provinces = state.provinces._values.map(v => parseInt(v));
                const cores = (_d = (_c = state.history) === null || _c === void 0 ? void 0 : _c.add_core_of.map(v => v).filter((v, i, a) => v !== undefined && i === a.indexOf(v))) !== null && _d !== void 0 ? _d : [];
                const impassable = (_e = state.impassable) !== null && _e !== void 0 ? _e : false;
                const victoryPointsArray = (_g = (_f = state.history) === null || _f === void 0 ? void 0 : _f.victory_points.filter(v => v._values.length >= 2).map(v => v._values.slice(0, 2).map(v => parseInt(v)))) !== null && _g !== void 0 ? _g : [];
                const victoryPoints = (0, common_2.arrayToMap)(victoryPointsArray, "0", v => v[1]);
                const resources = (0, common_2.arrayToMap)(Object.values(state.resources._map), '_key', v => v._value);
                if (provinces.length === 0) {
                    globalWarnings.push({
                        source: [{ type: 'state', id }],
                        relatedFiles: [stateFile],
                        text: (0, i18n_1.localize)('worldmap.warnings.statenoprovinces', "State {0} in \"{1}\" doesn't have provinces.", id, stateFile),
                    });
                }
                for (const vpPair of victoryPointsArray) {
                    if (!provinces.includes(vpPair[0])) {
                        warnings.push((0, i18n_1.localize)('worldmap.warnings.provincenothere', 'Province {0} not included in this state. But victory points defined here.', vpPair[0]));
                    }
                }
                globalWarnings.push(...warnings.map(warning => ({
                    source: [{ type: 'state', id }],
                    relatedFiles: [stateFile],
                    text: warning,
                })));
                result.push({
                    id, name, manpower, category, owner, provinces, cores, impassable, victoryPoints, resources,
                    file: stateFile,
                    token: (_h = state._token) !== null && _h !== void 0 ? _h : null,
                });
            }
            return result;
        }
        catch (e) {
            (0, debug_1.error)(e);
            return [];
        }
    });
}
function sortStates(states, warnings) {
    const { sorted, badId } = (0, common_1.sortItems)(states, 10000, (maxId) => { throw new common_2.UserError((0, i18n_1.localize)('worldmap.warnings.stateidtoolarge', 'Max state id is too large: {0}', maxId)); }, (newState, existingState, badId) => warnings.push({
        source: [{ type: 'state', id: badId }],
        relatedFiles: [newState.file, existingState.file],
        text: (0, i18n_1.localize)('worldmap.warnings.stateidconflict', "There're more than one states using state id {0}.", newState.id),
    }), (startId, endId) => warnings.push({
        source: [{ type: 'state', id: startId }],
        relatedFiles: [],
        text: (0, i18n_1.localize)('worldmap.warnings.statenotexist', "State with id {0} doesn't exist.", startId === endId ? startId : `${startId}-${endId}`),
    }));
    return {
        sortedStates: sorted,
        badStateId: badId,
    };
}
function calculateBoundingBox(noBoundingBoxState, provinces, width, height, warnings) {
    const state = (0, common_1.mergeRegion)(noBoundingBoxState, 'provinces', provinces, width, provinceId => warnings.push({
        source: [{ type: 'state', id: noBoundingBoxState.id }],
        relatedFiles: [noBoundingBoxState.file],
        text: (0, i18n_1.localize)('worldmap.warnings.stateprovincenotexist', "Province {0} used in state {1} doesn't exist.", provinceId, noBoundingBoxState.id),
    }), () => warnings.push({
        source: [{ type: 'state', id: noBoundingBoxState.id }],
        relatedFiles: [noBoundingBoxState.file],
        text: (0, i18n_1.localize)('worldmap.warnings.statenovalidprovinces', "State {0} in doesn't have valid provinces.", noBoundingBoxState.id),
    }));
    if (state.boundingBox.w > width / 2 || state.boundingBox.h > height / 2) {
        warnings.push({
            source: [{ type: 'state', id: state.id }],
            relatedFiles: [state.file],
            text: (0, i18n_1.localize)('worldmap.warnings.statetoolarge', 'State {0} is too large: {1}x{2}.', state.id, state.boundingBox.w, state.boundingBox.h),
        });
    }
    return state;
}
function validateProvinceInState(provinces, states, badStatesCount, warnings) {
    const provinceToState = {};
    for (let i = badStatesCount; i < states.length; i++) {
        const state = states[i];
        if (!state) {
            continue;
        }
        state.provinces.forEach(p => {
            const province = provinces[p];
            if (provinceToState[p] !== undefined) {
                if (!province) {
                    return;
                }
                warnings.push({
                    source: [
                        ...[state.id, provinceToState[p]].map(id => ({ type: 'state', id })),
                        { type: 'province', id: p, color: province.color }
                    ],
                    relatedFiles: [state.file, states[provinceToState[p]].file],
                    text: (0, i18n_1.localize)('worldmap.warnings.provinceinmultistates', 'Province {0} exists in multiple states: {1}, {2}.', p, provinceToState[p], state.id),
                });
            }
            else {
                provinceToState[p] = state.id;
            }
            if ((province === null || province === void 0 ? void 0 : province.type) === 'sea') {
                warnings.push({
                    source: [
                        { type: 'state', id: state.id },
                        { type: 'province', id: p, color: province.color },
                    ],
                    relatedFiles: [state.file],
                    text: (0, i18n_1.localize)('worldmap.warnings.statehassea', "Sea province {0} shouldn't belong to a state.", p),
                });
            }
        });
    }
}
function loadStateCategory(file, warning) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        try {
            const data = yield (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, stateCategoryFileSchema);
            const result = [];
            for (const categories of Object.values(data.state_categories._map)) {
                const name = categories._key;
                const color = (0, common_1.convertColor)(categories._value.color);
                result.push({ name, color, file });
            }
            return result;
        }
        catch (e) {
            (0, debug_1.error)(e);
            return [];
        }
    });
}
//# sourceMappingURL=states.js.map