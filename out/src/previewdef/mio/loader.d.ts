import { ContentLoader, LoadResultOD, Dependency, LoaderSession } from "../../util/loader/loader";
import { Mio } from "./schema";
import { HOIPartial } from "../../hoiformat/schema";
import { ContainerWindowType } from "../../hoiformat/gui";
export interface MioFrame {
    window: HOIPartial<ContainerWindowType>;
    scrollbarWindow: HOIPartial<ContainerWindowType> | undefined;
    treeHeaderWindow: HOIPartial<ContainerWindowType> | undefined;
    flavorTextWindow: HOIPartial<ContainerWindowType> | undefined;
}
export interface MioLoaderResult {
    mios: Mio[];
    gfxFiles: string[];
    frame: MioFrame | undefined;
}
export declare class MioLoader extends ContentLoader<MioLoaderResult> {
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<MioLoaderResult>>;
    toString(): string;
}
