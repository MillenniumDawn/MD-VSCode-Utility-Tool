import { ProvinceMap } from "../definitions";
import { FileLoader, LoadResult } from "./common";
import { LoaderSession } from "../../../util/loader/loader";
export declare class DefaultMapLoader extends FileLoader<ProvinceMap> {
    private definitionsLoader;
    private provinceBmpLoader;
    private adjacenciesLoader;
    private continentsLoader;
    private terrainDefinitionLoader;
    private riverLoader;
    constructor();
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadFromFile(session: LoaderSession): Promise<LoadResult<ProvinceMap>>;
    private checkAndCreateLoader;
    protected extraMesurements(result: LoadResult<ProvinceMap>): {
        width: number;
        height: number;
        provinceCount: number;
    };
    toString(): string;
}
