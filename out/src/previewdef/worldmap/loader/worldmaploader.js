"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldMapLoader = void 0;
const countries_1 = require("./countries");
const common_1 = require("./common");
const states_1 = require("./states");
const provincemap_1 = require("./provincemap");
const debug_1 = require("../../../util/debug");
const strategicregion_1 = require("./strategicregion");
const supplyarea_1 = require("./supplyarea");
const loader_1 = require("../../../util/loader/loader");
const vsccommon_1 = require("../../../util/vsccommon");
const railway_1 = require("./railway");
const resource_1 = require("./resource");
class WorldMapLoader extends common_1.Loader {
    defaultMapLoader;
    statesLoader;
    countriesLoader;
    strategicRegionsLoader;
    supplyAreasLoader;
    railwayLoader;
    supplyNodeLoader;
    resourcesLoader;
    shouldReloadValue = false;
    constructor() {
        super();
        this.defaultMapLoader = new provincemap_1.DefaultMapLoader();
        this.defaultMapLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.resourcesLoader = new resource_1.ResourceDefinitionLoader();
        this.resourcesLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.statesLoader = new states_1.StatesLoader(this.defaultMapLoader, this.resourcesLoader);
        this.statesLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.countriesLoader = new countries_1.CountriesLoader();
        this.countriesLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.strategicRegionsLoader = new strategicregion_1.StrategicRegionsLoader(this.defaultMapLoader, this.statesLoader);
        this.strategicRegionsLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.supplyAreasLoader = new supplyarea_1.SupplyAreasLoader(this.defaultMapLoader, this.statesLoader);
        this.supplyAreasLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.railwayLoader = new railway_1.RailwayLoader(this.defaultMapLoader);
        this.railwayLoader.onProgress(e => this.onProgressEmitter.fire(e));
        this.supplyNodeLoader = new railway_1.SupplyNodeLoader(this.defaultMapLoader);
        this.supplyNodeLoader.onProgress(e => this.onProgressEmitter.fire(e));
    }
    async shouldReloadImpl() {
        return this.shouldReloadValue;
    }
    async loadImpl(session) {
        this.shouldReloadValue = false;
        const provinceMap = await this.defaultMapLoader.load(session);
        session.throwIfCancelled();
        const stateMap = await this.statesLoader.load(session);
        session.throwIfCancelled();
        const countries = await this.countriesLoader.load(session);
        session.throwIfCancelled();
        const strategicRegions = await this.strategicRegionsLoader.load(session);
        session.throwIfCancelled();
        const enableSupplyArea = (0, vsccommon_1.getConfiguration)().enableSupplyArea;
        const supplyAreas = enableSupplyArea ?
            await this.supplyAreasLoader.load(session) :
            { warnings: [], result: { supplyAreas: [], badSupplyAreasCount: 0 }, dependencies: [] };
        session.throwIfCancelled();
        const railways = enableSupplyArea ?
            { warnings: [], result: { railways: [] }, dependencies: [] } :
            await this.railwayLoader.load(session);
        session.throwIfCancelled();
        const supplyNodes = enableSupplyArea ?
            { warnings: [], result: { supplyNodes: [] }, dependencies: [] } :
            await this.supplyNodeLoader.load(session);
        session.throwIfCancelled();
        const resources = await this.resourcesLoader.load(session);
        session.throwIfCancelled();
        const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
        (0, debug_1.debug)('Loader session', loadedLoaders);
        const subLoaderResults = [provinceMap, stateMap, countries, strategicRegions, supplyAreas, railways, supplyNodes, resources];
        const warnings = (0, common_1.mergeInLoadResult)(subLoaderResults, 'warnings');
        const worldMap = {
            ...provinceMap.result,
            ...stateMap.result,
            ...strategicRegions.result,
            ...supplyAreas.result,
            ...railways.result,
            ...supplyNodes.result,
            resources: resources.result,
            provincesCount: provinceMap.result.provinces.length,
            statesCount: stateMap.result.states.length,
            countriesCount: countries.result.length,
            strategicRegionsCount: strategicRegions.result.strategicRegions.length,
            supplyAreasCount: supplyAreas.result.supplyAreas.length,
            countries: countries.result,
            railwaysCount: railways.result.railways.length,
            supplyNodesCount: supplyNodes.result.supplyNodes.length,
            warnings,
        };
        delete worldMap['colorByPosition'];
        const dependencies = (0, common_1.mergeInLoadResult)(subLoaderResults, 'dependencies');
        (0, debug_1.debug)('World map dependencies', dependencies);
        return {
            result: worldMap,
            dependencies,
            warnings,
        };
    }
    getWorldMap(force) {
        const session = new loader_1.LoaderSession(force ?? false);
        return this.load(session).then(r => r.result);
    }
    shallowForceReload() {
        this.shouldReloadValue = true;
    }
    extraMesurements(result) {
        return {
            ...super.extraMesurements(result),
            width: result.result.width,
            height: result.result.height,
            provincesCount: result.result.provincesCount,
            statesCount: result.result.statesCount,
            countriesCount: result.result.countriesCount,
            strategicRegionsCount: result.result.strategicRegionsCount,
            supplyAreasCount: result.result.supplyAreasCount,
        };
    }
    toString() {
        return `[WorldMapLoader]`;
    }
}
exports.WorldMapLoader = WorldMapLoader;
//# sourceMappingURL=worldmaploader.js.map