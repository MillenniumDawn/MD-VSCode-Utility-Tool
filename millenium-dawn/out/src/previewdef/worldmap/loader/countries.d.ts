import { Country } from "../definitions";
import { Loader, LoadResult } from "./common";
import { LoaderSession } from "../../../util/loader/loader";
export declare class CountriesLoader extends Loader<Country[]> {
    private countryTagsLoader;
    private countryLoaders;
    private colorsLoader;
    constructor();
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<Country[]>>;
    protected extraMesurements(result: LoadResult<Country[]>): {
        fileCount: number;
    };
    toString(): string;
}
