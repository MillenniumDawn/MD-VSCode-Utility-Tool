import { ContentLoader, LoadResultOD, Dependency, LoaderSession } from "../../util/loader/loader";
import { FocusTree } from "./schema";
export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
}
export declare class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<FocusTreeLoaderResult>>;
    toString(): string;
}
