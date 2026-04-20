"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Loader = void 0;
const common_1 = require("../util/common");
const graphutils_1 = require("./graphutils");
const event_1 = require("../util/event");
const vscode_1 = require("../util/vscode");
const rxjs_1 = require("rxjs");
class Loader extends event_1.Subscriber {
    worldMap;
    loading$ = new rxjs_1.BehaviorSubject(false);
    progress = 0;
    progressText = '';
    writableWorldMap$ = new rxjs_1.Subject();
    worldMap$ = this.writableWorldMap$;
    writableProgress$ = new rxjs_1.BehaviorSubject({ progress: 0, progressText: '' });
    progress$ = this.writableProgress$;
    loadingProvinceMap;
    loadingQueue = [];
    loadingQueueStartLength = 0;
    constructor() {
        super();
        this.worldMap = new FEWorldMapClass();
        this.load();
        this.worldMap$.subscribe(wm => window['worldMap'] = wm);
    }
    refresh() {
        this.worldMap = new FEWorldMapClass();
        this.writableWorldMap$.next(this.worldMap);
        vscode_1.vscode.postMessage({ command: 'loaded', force: true });
        this.loading$.next(true);
    }
    load() {
        this.addSubscription((0, rxjs_1.fromEvent)(window, 'message').subscribe(event => {
            const message = event.data;
            switch (message.command) {
                case 'provincemapsummary':
                    this.loadingProvinceMap = { ...message.data };
                    this.loadingProvinceMap.provinces = new Array(this.loadingProvinceMap.provincesCount);
                    this.loadingProvinceMap.states = new Array(this.loadingProvinceMap.statesCount);
                    this.loadingProvinceMap.countries = new Array(this.loadingProvinceMap.countriesCount);
                    this.loadingProvinceMap.strategicRegions = new Array(this.loadingProvinceMap.strategicRegionsCount);
                    console.log(message.data);
                    this.startLoading();
                    break;
                case 'provinces':
                    this.receiveData(this.loadingProvinceMap?.provinces, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'states':
                    this.receiveData(this.loadingProvinceMap?.states, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'countries':
                    this.receiveData(this.loadingProvinceMap?.countries, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'strategicregions':
                    this.receiveData(this.loadingProvinceMap?.strategicRegions, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'supplyareas':
                    this.receiveData(this.loadingProvinceMap?.supplyAreas, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'railways':
                    this.receiveData(this.loadingProvinceMap?.railways, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'supplynodes':
                    this.receiveData(this.loadingProvinceMap?.supplyNodes, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'warnings':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.warnings = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'continents':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.continents = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'terrains':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.terrains = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'resources':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.resources = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'progress':
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    break;
                case 'error':
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    this.loading$.next(false);
                    break;
            }
        }));
        vscode_1.vscode.postMessage({ command: 'loaded', force: false });
        this.loading$.next(true);
    }
    startLoading() {
        if (!this.loadingProvinceMap) {
            return;
        }
        this.loadingQueue.length = 0;
        this.queueLoadingRequest('requestcountries', this.loadingProvinceMap.countriesCount, 300);
        this.queueLoadingRequest('requeststrategicregions', this.loadingProvinceMap.strategicRegionsCount, 300);
        this.queueLoadingRequest('requeststrategicregions', -this.loadingProvinceMap.badStrategicRegionsCount, 300, this.loadingProvinceMap.badStrategicRegionsCount);
        this.queueLoadingRequest('requestsupplyareas', this.loadingProvinceMap.supplyAreasCount, 300);
        this.queueLoadingRequest('requestsupplyareas', -this.loadingProvinceMap.badSupplyAreasCount, 300, this.loadingProvinceMap.badSupplyAreasCount);
        this.queueLoadingRequest('requeststates', this.loadingProvinceMap.statesCount, 300);
        this.queueLoadingRequest('requeststates', -this.loadingProvinceMap.badStatesCount, 300, this.loadingProvinceMap.badStatesCount);
        this.queueLoadingRequest('requestprovinces', this.loadingProvinceMap.provincesCount, 300);
        this.queueLoadingRequest('requestprovinces', -this.loadingProvinceMap.badProvincesCount, 300, this.loadingProvinceMap.badProvincesCount);
        this.queueLoadingRequest('requestrailways', this.loadingProvinceMap.railwaysCount, 1000);
        this.queueLoadingRequest('requestsupplynodes', this.loadingProvinceMap.supplyNodesCount, 2000);
        this.loadingQueueStartLength = this.loadingQueue.length;
        this.progressText = '';
        this.loadNext();
    }
    queueLoadingRequest(command, count, step, offset = 0) {
        for (let i = offset, j = 0; j < count; i += step, j += step) {
            this.loadingQueue.push({
                command,
                start: i,
                end: Math.min(i + step, offset + count),
            });
        }
    }
    loadNext(updateMap = true) {
        this.progress = 1 - this.loadingQueue.length / this.loadingQueueStartLength;
        if (updateMap) {
            this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
            this.writableWorldMap$.next(this.worldMap);
        }
        if (this.loadingQueue.length === 0) {
            this.loading$.next(false);
        }
        else {
            vscode_1.vscode.postMessage(this.loadingQueue.shift());
        }
        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
    }
    receiveData(arr, start, end, data) {
        if (arr) {
            (0, common_1.copyArray)(JSON.parse(data), arr, 0, start, end - start);
        }
    }
}
exports.Loader = Loader;
class FEWorldMapClass {
    width;
    height;
    countries;
    warnings;
    provincesCount;
    statesCount;
    countriesCount;
    strategicRegionsCount;
    supplyAreasCount;
    railwaysCount;
    supplyNodesCount;
    badProvincesCount;
    badStatesCount;
    badStrategicRegionsCount;
    badSupplyAreasCount;
    continents;
    terrains;
    resources;
    rivers;
    provinces;
    states;
    strategicRegions;
    supplyAreas;
    railways;
    supplyNodes;
    constructor(worldMap) {
        Object.assign(this, worldMap ?? {
            width: 0, height: 0,
            provinces: [], states: [], countries: [], warnings: [], continents: [], strategicRegions: [], supplyAreas: [], terrains: [],
            railways: [], supplyNodes: [], resources: [], rivers: [],
            provincesCount: 0, statesCount: 0, countriesCount: 0, strategicRegionsCount: 0, supplyAreasCount: 0,
            badProvincesCount: 0, badStatesCount: 0, badStrategicRegionsCount: 0, badSupplyAreasCount: 0,
            railwaysCount: 0, supplyNodesCount: 0,
        });
    }
    getProvinceById = (provinceId) => {
        return provinceId ? this.provinces[provinceId] ?? undefined : undefined;
    };
    getStateById = (stateId) => {
        return stateId ? this.states[stateId] ?? undefined : undefined;
    };
    getStrategicRegionById = (strategicRegionId) => {
        return strategicRegionId ? this.strategicRegions[strategicRegionId] ?? undefined : undefined;
    };
    getSupplyAreaById = (supplyAreaId) => {
        return supplyAreaId ? this.supplyAreas[supplyAreaId] ?? undefined : undefined;
    };
    getStateByProvinceId(provinceId) {
        let resultState = undefined;
        this.forEachState(state => {
            if (state.provinces.includes(provinceId)) {
                resultState = state;
                return true;
            }
        });
        return resultState;
    }
    getStrategicRegionByProvinceId(provinceId) {
        let resultStrategicRegion = undefined;
        this.forEachStrategicRegion(strategicRegion => {
            if (strategicRegion.provinces.includes(provinceId)) {
                resultStrategicRegion = strategicRegion;
                return true;
            }
        });
        return resultStrategicRegion;
    }
    getSupplyAreaByStateId(stateId) {
        let resultSupplyArea = undefined;
        this.forEachSupplyArea(supplyArea => {
            if (supplyArea.states.includes(stateId)) {
                resultSupplyArea = supplyArea;
                return true;
            }
        });
        return resultSupplyArea;
    }
    getRailwayLevelByProvinceId(provinceId) {
        let resultRailwayLevel = -1;
        this.forEachRailway(railway => {
            if (railway.provinces.includes(provinceId)) {
                resultRailwayLevel = Math.max(resultRailwayLevel, railway.level);
            }
        });
        return resultRailwayLevel === -1 ? undefined : resultRailwayLevel;
    }
    getSupplyNodeByProvinceId(provinceId) {
        let resultSupplyNode = undefined;
        this.forEachSupplyNode(supplyNode => {
            if (supplyNode.province === provinceId) {
                resultSupplyNode = supplyNode;
                return true;
            }
        });
        return resultSupplyNode;
    }
    getProvinceByPosition(x, y) {
        const point = { x, y };
        let resultProvince = undefined;
        this.forEachProvince(province => {
            if ((0, graphutils_1.inBBox)(point, province.boundingBox) && province.coverZones.some(z => (0, graphutils_1.inBBox)(point, z))) {
                resultProvince = province;
                return true;
            }
        });
        return resultProvince;
    }
    getProvinceToStateMap() {
        const result = {};
        this.forEachState(state => state.provinces.forEach(p => {
            result[p] = state.id;
        }));
        return result;
    }
    getProvinceToStrategicRegionMap() {
        const result = {};
        this.forEachStrategicRegion(strategicRegion => strategicRegion.provinces.forEach(p => {
            result[p] = strategicRegion.id;
        }));
        return result;
    }
    getStateToSupplyAreaMap() {
        const result = {};
        this.forEachSupplyArea(supplyArea => supplyArea.states.forEach(s => {
            result[s] = supplyArea.id;
        }));
        return result;
    }
    forEachProvince(callback) {
        const count = this.provincesCount;
        for (let i = this.badProvincesCount; i < count; i++) {
            const province = this.provinces[i];
            if (province && callback(province)) {
                break;
            }
        }
    }
    forEachState(callback) {
        const count = this.statesCount;
        for (let i = this.badStatesCount; i < count; i++) {
            const state = this.states[i];
            if (state && callback(state)) {
                break;
            }
        }
    }
    forEachStrategicRegion(callback) {
        const count = this.strategicRegionsCount;
        for (let i = this.badStrategicRegionsCount; i < count; i++) {
            const strategicRegion = this.strategicRegions[i];
            if (strategicRegion && callback(strategicRegion)) {
                break;
            }
        }
    }
    forEachSupplyArea(callback) {
        const count = this.supplyAreasCount;
        for (let i = this.badSupplyAreasCount; i < count; i++) {
            const supplyArea = this.supplyAreas[i];
            if (supplyArea && callback(supplyArea)) {
                break;
            }
        }
    }
    forEachRailway(callback) {
        const count = this.railwaysCount;
        for (let i = 0; i < count; i++) {
            const railway = this.railways[i];
            if (railway && callback(railway)) {
                break;
            }
        }
    }
    forEachSupplyNode(callback) {
        const count = this.supplyNodesCount;
        for (let i = 0; i < count; i++) {
            const supplyNode = this.supplyNodes[i];
            if (supplyNode && callback(supplyNode)) {
                break;
            }
        }
    }
    getProvinceWarnings(province, state, strategicRegion, supplyArea) {
        return this.warnings
            .filter(v => v.source.some(s => (province && s.type === 'province' && (s.id === province.id || s.color === province.color)) ||
            (state && s.type === 'state' && s.id === state.id) ||
            (strategicRegion && s.type === 'strategicregion' && s.id === strategicRegion.id) ||
            (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)))
            .map(v => v.text);
    }
    getStateWarnings(state, supplyArea) {
        return this.warnings
            .filter(v => v.source.some(s => (s.type === 'state' && s.id === state.id) ||
            (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)))
            .map(v => v.text);
    }
    getStrategicRegionWarnings(strategicRegion) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'strategicregion' && s.id === strategicRegion.id)).map(v => v.text);
    }
    getSupplyAreaWarnings(supplyArea) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'supplyarea' && s.id === supplyArea.id)).map(v => v.text);
    }
    getRiverWarnings(riverIndex) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'river' && s.index === riverIndex)).map(v => v.text);
    }
}
//# sourceMappingURL=loader.js.map