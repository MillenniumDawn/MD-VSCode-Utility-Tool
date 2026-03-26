import { ProvinceDefinition } from "../definitions";
import { FileLoader, LoadResultOD } from "./common";
export declare class DefinitionsLoader extends FileLoader<ProvinceDefinition[]> {
    protected loadFromFile(): Promise<LoadResultOD<ProvinceDefinition[]>>;
    toString(): string;
}
