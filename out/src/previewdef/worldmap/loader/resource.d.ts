import { FileLoader, LoadResultOD, FolderLoader } from "./common";
import { MapLoaderExtra, Resource } from "../definitions";
import { LoadResult, LoaderSession } from '../../../util/loader/loader';
export declare class ResourceDefinitionLoader extends FolderLoader<Resource[], Resource[]> {
    constructor();
    protected mergeFiles(fileResults: LoadResult<Resource[], MapLoaderExtra>[], session: LoaderSession): Promise<LoadResult<Resource[], MapLoaderExtra>>;
    toString(): string;
}
export declare class ResourceFileLoader extends FileLoader<Resource[]> {
    protected loadFromFile(): Promise<LoadResultOD<Resource[]>>;
    toString(): string;
}
