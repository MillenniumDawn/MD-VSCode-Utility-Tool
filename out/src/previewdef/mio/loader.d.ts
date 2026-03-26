import { ContentLoader, LoadResultOD, Dependency, LoaderSession } from "../../util/loader/loader";
import { Mio } from "./schema";
export interface MioLoaderResult {
    mios: Mio[];
    gfxFiles: string[];
}
export declare class MioLoader extends ContentLoader<MioLoaderResult> {
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<MioLoaderResult>>;
    toString(): string;
}
