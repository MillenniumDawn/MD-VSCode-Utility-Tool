import { TechnologyTree } from "./schema";
import { HOIPartial } from "../../hoiformat/schema";
import { GuiFile } from "../../hoiformat/gui";
import { ContentLoader, Dependency, LoadResultOD, LoaderSession } from "../../util/loader/loader";
export interface TechnologyTreeLoaderResult {
    technologyTrees: TechnologyTree[];
    guiFiles: {
        file: string;
        data: HOIPartial<GuiFile>;
    }[];
    gfxFiles: string[];
}
export declare class TechnologyTreeLoader extends ContentLoader<TechnologyTreeLoaderResult> {
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<TechnologyTreeLoaderResult>>;
    toString(): string;
}
