import { ProvinceEdgeAdjacency } from "../definitions";
import { FileLoader, LoadResultOD } from "./common";
export declare class AdjacenciesLoader extends FileLoader<ProvinceEdgeAdjacency[]> {
    protected loadFromFile(): Promise<LoadResultOD<ProvinceEdgeAdjacency[]>>;
    toString(): string;
}
