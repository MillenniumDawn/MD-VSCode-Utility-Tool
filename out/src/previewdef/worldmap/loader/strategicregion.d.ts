import { StrategicRegion, Region } from "../definitions";
import { DefaultMapLoader } from "./provincemap";
import { FolderLoader, LoadResult } from "./common";
import { StatesLoader } from "./states";
import { LoaderSession } from "../../../util/loader/loader";
type StrategicRegionsLoaderResult = {
    strategicRegions: StrategicRegion[];
    badStrategicRegionsCount: number;
};
export declare class StrategicRegionsLoader extends FolderLoader<StrategicRegionsLoaderResult, StrategicRegionNoRegion[]> {
    private defaultMapLoader;
    private statesLoader;
    constructor(defaultMapLoader: DefaultMapLoader, statesLoader: StatesLoader);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<StrategicRegionsLoaderResult>>;
    protected mergeFiles(fileResults: LoadResult<StrategicRegionNoRegion[]>[], session: LoaderSession): Promise<LoadResult<StrategicRegionsLoaderResult>>;
    toString(): string;
}
type StrategicRegionNoRegion = Omit<StrategicRegion, keyof Region>;
export {};
