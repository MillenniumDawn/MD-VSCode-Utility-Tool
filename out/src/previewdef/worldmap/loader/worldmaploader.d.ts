import { WorldMapData } from "../definitions";
import { Loader, LoadResult } from "./common";
import { LoaderSession } from "../../../util/loader/loader";
export declare class WorldMapLoader extends Loader<WorldMapData> {
    private defaultMapLoader;
    private statesLoader;
    private countriesLoader;
    private strategicRegionsLoader;
    private supplyAreasLoader;
    private railwayLoader;
    private supplyNodeLoader;
    private resourcesLoader;
    private shouldReloadValue;
    constructor();
    shouldReloadImpl(): Promise<boolean>;
    loadImpl(session: LoaderSession): Promise<LoadResult<WorldMapData>>;
    getWorldMap(force?: boolean): Promise<WorldMapData>;
    shallowForceReload(): void;
    protected extraMesurements(result: LoadResult<WorldMapData>): {
        width: number;
        height: number;
        provincesCount: number;
        statesCount: number;
        countriesCount: number;
        strategicRegionsCount: number;
        supplyAreasCount: number;
    };
    toString(): string;
}
