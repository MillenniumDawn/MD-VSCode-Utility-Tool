import { State, Region } from "../definitions";
import { LoadResult, FolderLoader } from "./common";
import { DefaultMapLoader } from "./provincemap";
import { LoaderSession } from "../../../util/loader/loader";
import { ResourceDefinitionLoader } from "./resource";
type StateNoBoundingBox = Omit<State, keyof Region>;
type StateLoaderResult = {
    states: State[];
    badStatesCount: number;
};
export declare class StatesLoader extends FolderLoader<StateLoaderResult, StateNoBoundingBox[]> {
    private defaultMapLoader;
    private resourcesLoader;
    private categoriesLoader;
    constructor(defaultMapLoader: DefaultMapLoader, resourcesLoader: ResourceDefinitionLoader);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<StateLoaderResult>>;
    protected mergeFiles(fileResults: LoadResult<StateNoBoundingBox[]>[], session: LoaderSession): Promise<LoadResult<StateLoaderResult>>;
    toString(): string;
}
export {};
