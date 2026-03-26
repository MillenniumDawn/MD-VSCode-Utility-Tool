import { ProvinceBmp } from "../definitions";
import { FileLoader, LoadResult, LoadResultOD } from "./common";
export declare class ProvinceBmpLoader extends FileLoader<ProvinceBmp> {
    protected loadFromFile(): Promise<LoadResultOD<ProvinceBmp>>;
    protected extraMesurements(result: LoadResult<ProvinceBmp>): {
        width: number;
        height: number;
        provinceCount: number;
    };
    toString(): string;
}
