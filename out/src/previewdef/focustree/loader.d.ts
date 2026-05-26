import { ContentLoader, LoadResultOD, Dependency, LoaderSession } from "../../util/loader/loader";
import { FocusTree } from "./schema";
export interface FocusTreeLoaderResult {
    focusTrees: FocusTree[];
    gfxFiles: string[];
}
export type ProgressCallback = (message: string, current?: number, total?: number) => void;
export declare class FocusTreeLoader extends ContentLoader<FocusTreeLoaderResult> {
    private progressListener;
    setProgressListener(cb: ProgressCallback | undefined): void;
    private emitProgress;
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<FocusTreeLoaderResult>>;
    toString(): string;
}
