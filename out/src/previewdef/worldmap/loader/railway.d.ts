import { LoaderSession } from "../../../util/loader/loader";
import { Railway, SupplyNode } from "../definitions";
import { FileLoader, LoadResult, LoadResultOD } from "./common";
import { DefaultMapLoader } from "./provincemap";
type RailwayLoaderResult = {
    railways: Railway[];
};
export declare class RailwayLoader extends FileLoader<RailwayLoaderResult> {
    private defaultMapLoader;
    constructor(defaultMapLoader: DefaultMapLoader);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<RailwayLoaderResult>>;
    protected loadFromFile(session: LoaderSession): Promise<LoadResultOD<RailwayLoaderResult>>;
    toString(): string;
}
type SupplyNodeLoaderResult = {
    supplyNodes: SupplyNode[];
};
export declare class SupplyNodeLoader extends FileLoader<SupplyNodeLoaderResult> {
    private defaultMapLoader;
    constructor(defaultMapLoader: DefaultMapLoader);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<SupplyNodeLoaderResult>>;
    protected loadFromFile(session: LoaderSession): Promise<LoadResultOD<SupplyNodeLoaderResult>>;
    toString(): string;
}
export {};
