import { FileLoader, LoadResultOD } from "./common";
export declare class ContinentsLoader extends FileLoader<string[]> {
    protected loadFromFile(): Promise<LoadResultOD<string[]>>;
    toString(): string;
}
