import { FileLoader, LoadResultOD, FolderLoader } from "./common";
import { MapLoaderExtra, Terrain } from "../definitions";
import { LoadResult, LoaderSession } from '../../../util/loader/loader';
export declare class TerrainDefinitionLoader extends FolderLoader<Terrain[], Terrain[]> {
    constructor();
    protected mergeFiles(fileResults: LoadResult<Terrain[], MapLoaderExtra>[], session: LoaderSession): Promise<LoadResult<Terrain[], MapLoaderExtra>>;
    toString(): string;
}
export declare class TerrainFileLoader extends FileLoader<Terrain[]> {
    protected loadFromFile(): Promise<LoadResultOD<Terrain[]>>;
    toString(): string;
}
