import { FolderLoader, LoadResult } from "./common";
import { SupplyArea, Region } from "../definitions";
import { DefaultMapLoader } from "./provincemap";
import { StatesLoader } from "./states";
import { LoaderSession } from "../../../util/loader/loader";
type SupplyAreasLoaderResult = {
    supplyAreas: SupplyArea[];
    badSupplyAreasCount: number;
};
export declare class SupplyAreasLoader extends FolderLoader<SupplyAreasLoaderResult, SupplyAreaNoRegion[]> {
    private defaultMapLoader;
    private statesLoader;
    constructor(defaultMapLoader: DefaultMapLoader, statesLoader: StatesLoader);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<SupplyAreasLoaderResult>>;
    protected mergeFiles(fileResults: LoadResult<SupplyAreaNoRegion[]>[], session: LoaderSession): Promise<LoadResult<SupplyAreasLoaderResult>>;
    toString(): string;
}
type SupplyAreaNoRegion = Omit<SupplyArea, keyof Region>;
export {};
