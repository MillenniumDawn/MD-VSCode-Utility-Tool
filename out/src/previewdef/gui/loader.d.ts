import { GuiFile } from "../../hoiformat/gui";
import { HOIPartial } from "../../hoiformat/schema";
import { ContentLoader, Dependency, LoaderSession, LoadResultOD } from "../../util/loader/loader";
export interface GuiFileLoaderResult {
    guiFiles: {
        file: string;
        data: HOIPartial<GuiFile>;
    }[];
    gfxFiles: string[];
}
export declare class GuiFileLoader extends ContentLoader<GuiFileLoaderResult> {
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<GuiFileLoaderResult>>;
    toString(): string;
}
