"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplyAreasLoader = void 0;
const common_1 = require("./common");
const fileloader_1 = require("../../../util/fileloader");
const i18n_1 = require("../../../util/i18n");
const debug_1 = require("../../../util/debug");
const lodash_1 = require("lodash");
const common_2 = require("../../../util/common");
const supplyAreaFileSchema = {
    supply_area: {
        _innerType: {
            id: "number",
            name: "string",
            value: "number",
            states: "enum",
        },
        _type: "array",
    },
};
class SupplyAreasLoader extends common_1.FolderLoader {
    defaultMapLoader;
    statesLoader;
    constructor(defaultMapLoader, statesLoader) {
        super('map/supplyareas', SupplyAreaLoader);
        this.defaultMapLoader = defaultMapLoader;
        this.statesLoader = statesLoader;
    }
    async shouldReloadImpl(session) {
        return await super.shouldReloadImpl(session) || await this.defaultMapLoader.shouldReload(session) || await this.statesLoader.shouldReload(session);
    }
    async loadImpl(session) {
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.loadingsupplyareas', 'Loading supply areas...'));
        return super.loadImpl(session);
    }
    async mergeFiles(fileResults, session) {
        const provinceMap = await this.defaultMapLoader.load(session);
        const stateMap = await this.statesLoader.load(session);
        await this.fireOnProgressEvent((0, i18n_1.localize)('worldmap.progress.mapstatetosupplyarea', 'Mapping states to supply areas...'));
        const warnings = (0, common_1.mergeInLoadResult)(fileResults, 'warnings');
        const SupplyAreas = (0, lodash_1.flatMap)(fileResults, c => c.result);
        const { width, provinces } = provinceMap.result;
        const { sortedSupplyAreas, badSupplyAreaId } = sortSupplyAreas(SupplyAreas, warnings);
        const { states } = stateMap.result;
        const badSupplyAreasCount = badSupplyAreaId + 1;
        const filledSupplyAreas = new Array(sortedSupplyAreas.length);
        for (let i = badSupplyAreasCount; i < sortedSupplyAreas.length; i++) {
            if (sortedSupplyAreas[i]) {
                filledSupplyAreas[i] = calculateBoundingBox(sortedSupplyAreas[i], states, width, warnings);
            }
        }
        validateStatesInSupplyAreas(states, filledSupplyAreas, provinces, badSupplyAreasCount, warnings);
        return {
            result: {
                supplyAreas: filledSupplyAreas,
                badSupplyAreasCount,
            },
            dependencies: [this.folder + '/*'],
            warnings,
        };
    }
    toString() {
        return `[SupplyAreasLoader]`;
    }
}
exports.SupplyAreasLoader = SupplyAreasLoader;
class SupplyAreaLoader extends common_1.FileLoader {
    async loadFromFile() {
        const warnings = [];
        return {
            result: await loadSupplyArea(this.file, warnings),
            warnings,
        };
    }
    toString() {
        return `[SupplyAreaLoader: ${this.file}]`;
    }
}
async function loadSupplyArea(file, globalWarnings) {
    const result = [];
    try {
        const data = await (0, fileloader_1.readFileFromModOrHOI4AsJson)(file, supplyAreaFileSchema);
        for (const supplyArea of data.supply_area) {
            const warnings = [];
            const id = supplyArea.id ? supplyArea.id : (warnings.push((0, i18n_1.localize)('worldmap.warnings.supplyareanoid', "A supply area in \"{0}\" doesn't have id field.", file)), -1);
            const name = supplyArea.name ? supplyArea.name : (warnings.push((0, i18n_1.localize)('worldmap.warnings.supplyareanoname', "Supply area {0} doesn't have name field.", id)), '');
            const value = supplyArea.value ?? 0;
            const states = supplyArea.states._values.map(v => parseInt(v));
            if (states.length === 0) {
                warnings.push((0, i18n_1.localize)('worldmap.warnings.supplyareanostates', "Supply area {0} in \"{1}\" doesn't have states.", id, file));
            }
            globalWarnings.push(...warnings.map(warning => ({
                source: [{ type: 'supplyarea', id }],
                relatedFiles: [file],
                text: warning,
            })));
            result.push({
                id,
                name,
                states,
                value,
                file,
                token: supplyArea._token ?? null,
            });
        }
    }
    catch (e) {
        (0, debug_1.error)(e);
    }
    return result;
}
function sortSupplyAreas(supplyAreas, warnings) {
    const { sorted, badId } = (0, common_1.sortItems)(supplyAreas, 10000, (maxId) => { throw new common_2.UserError((0, i18n_1.localize)('worldmap.warnings.supplyareaidtoolarge', 'Max supply area ID is too large: {0}.', maxId)); }, (newSupplyArea, existingSupplyArea, badId) => warnings.push({
        source: [{ type: 'supplyarea', id: badId }],
        relatedFiles: [newSupplyArea.file, existingSupplyArea.file],
        text: (0, i18n_1.localize)('worldmap.warnings.supplyareaidconflict', "There're more than one supply areas using ID {0}.", newSupplyArea.id),
    }), (startId, endId) => warnings.push({
        source: [{ type: 'supplyarea', id: startId }],
        relatedFiles: [],
        text: (0, i18n_1.localize)('worldmap.warnings.supplyareanotexist', "Supply area with id {0} doesn't exist.", startId === endId ? startId : `${startId}-${endId}`),
    }));
    return {
        sortedSupplyAreas: sorted,
        badSupplyAreaId: badId,
    };
}
function calculateBoundingBox(supplyAreaNoRegion, states, width, warnings) {
    return (0, common_1.mergeRegion)(supplyAreaNoRegion, 'states', states, width, stateId => warnings.push({
        source: [{ type: 'supplyarea', id: supplyAreaNoRegion.id }],
        relatedFiles: [supplyAreaNoRegion.file],
        text: (0, i18n_1.localize)('worldmap.warnings.stateinsupplyareanotexist', "State {0} used in supply area {1} doesn't exist.", stateId, supplyAreaNoRegion.id),
    }), () => warnings.push({
        source: [{ type: 'supplyarea', id: supplyAreaNoRegion.id }],
        relatedFiles: [supplyAreaNoRegion.file],
        text: (0, i18n_1.localize)('worldmap.warnings.supplyareanovalidstates', "Supply area {0} doesn't have valid states.", supplyAreaNoRegion.id),
    }));
}
function validateStatesInSupplyAreas(states, supplyAreas, provinces, badSupplyAreasCount, warnings) {
    const stateToSupplyArea = {};
    for (let i = badSupplyAreasCount; i < supplyAreas.length; i++) {
        const supplyArea = supplyAreas[i];
        if (!supplyArea) {
            continue;
        }
        const statesInSupplyArea = supplyArea.states.map(s => {
            const state = states[s];
            if (stateToSupplyArea[s] !== undefined) {
                if (!state) {
                    return undefined;
                }
                warnings.push({
                    source: [
                        ...[supplyArea.id, stateToSupplyArea[s]].map(id => ({ type: 'supplyarea', id })),
                        { type: 'state', id: s }
                    ],
                    relatedFiles: [supplyArea.file, supplyAreas[stateToSupplyArea[s]].file, state.file],
                    text: (0, i18n_1.localize)('worldmap.warnings.stateinmultiplesupplyareas', 'State {0} exists in multiple supply areas: {1}, {2}.', s, stateToSupplyArea[s], supplyArea.id),
                });
            }
            else {
                stateToSupplyArea[s] = supplyArea.id;
            }
            return state;
        }).filter((s) => !!s);
        const badStates = checkStatesContiguous(statesInSupplyArea, provinces);
        if (badStates) {
            warnings.push({
                source: [{ type: 'supplyarea', id: i }],
                relatedFiles: [supplyArea.file],
                text: (0, i18n_1.localize)('worldmap.warnings.statesnotcontiguous', 'States in supply area {0} are not contiguous: {1}, {2}.', i, badStates[0], badStates[1]),
            });
        }
    }
    for (let i = 1; i < states.length; i++) {
        const state = states[i];
        if (!state) {
            continue;
        }
        if (!(i in stateToSupplyArea)) {
            warnings.push({
                source: [{ type: 'state', id: i }],
                relatedFiles: [state.file],
                text: (0, i18n_1.localize)('worldmap.warnings.statenosupplyarea', 'State {0} is not in any supply area.', i),
            });
        }
    }
}
function checkStatesContiguous(states, provinces) {
    if (states.length === 0) {
        return undefined;
    }
    const accessedStates = {};
    const stack = [states[0]];
    accessedStates[stack[0].id] = true;
    while (stack.length) {
        const currentState = stack.pop();
        for (const state of states) {
            if (accessedStates[state.id]) {
                continue;
            }
            if (statesAreAdjacent(state, currentState, provinces)) {
                stack.push(state);
                accessedStates[state.id] = true;
            }
        }
    }
    const inAccessedState = states.find(state => !accessedStates[state.id]);
    return inAccessedState === undefined ? undefined : [inAccessedState.id, parseInt(Object.keys(accessedStates)[0])];
}
function statesAreAdjacent(stateA, stateB, provinces) {
    return stateA.provinces.some(p => provinces[p]?.edges
        .some(e => e.type !== 'impassable' && stateB.provinces.some(p2 => provinces[p2] && e.to === p2)) ?? false);
}
//# sourceMappingURL=supplyarea.js.map