import { RiverBmp } from "../definitions";
import { FileLoader, LoadResult, LoadResultOD } from "./common";
export declare class RiverLoader extends FileLoader<RiverBmp> {
    protected loadFromFile(): Promise<LoadResultOD<RiverBmp>>;
    protected extraMesurements(result: LoadResult<RiverBmp>): {
        riverCount: number;
    };
    toString(): string;
}
