import { ContentLoader, Dependency, LoaderSession, LoadResultOD } from "./loader";
export declare class YamlLoader extends ContentLoader<any> {
    constructor(file: string, contentProvider?: () => Promise<string>);
    protected postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<any>>;
    toString(): string;
}
