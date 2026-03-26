import * as vscode from 'vscode';
import { Dependency } from '../dependency';
export { Dependency } from '../dependency';
export declare class LoaderSession {
    force: boolean;
    private cancelled?;
    private loadedLoader;
    private shouldLoaderReload;
    private cachedLoader;
    loadingLoader: Loader<unknown, unknown>[];
    constructor(force: boolean, cancelled?: (() => boolean) | undefined);
    isLoaded(loader: Loader<unknown, unknown>): boolean;
    setLoaded(loader: Loader<unknown, unknown>): void;
    checkingShouldReload(loader: Loader<unknown, unknown>): void;
    setShouldReload(loader: Loader<unknown, unknown>): void;
    clearShouldReload(loader: Loader<unknown, unknown>): void;
    shouldReload(loader: Loader<unknown, unknown>): boolean | 'checking';
    createOrGetCachedLoader<R extends Loader<unknown, unknown>>(file: string, loaderType: {
        new (file: string): R;
    }): R;
    forChild(): LoaderSession;
    throwIfCancelled(): void;
}
export type LoadResult<T, E = {}> = {
    result: T;
    dependencies: string[];
} & E;
export type LoadResultOD<T, E = {}> = Omit<LoadResult<T, E>, 'dependencies'> & Partial<Pick<LoadResult<T, E>, 'dependencies'>> & E;
export declare abstract class Loader<T, E = {}> {
    private cachedValue;
    protected onProgressEmitter: vscode.EventEmitter<string>;
    onProgress: vscode.Event<string>;
    protected onLoadDoneEmitter: vscode.EventEmitter<LoadResult<T, E>>;
    onLoadDone: vscode.Event<LoadResult<T, E>>;
    private loadingPromise;
    disableTelemetry: boolean;
    constructor();
    load(session: LoaderSession): Promise<LoadResult<T, E>>;
    shouldReload(session: LoaderSession): Promise<boolean>;
    protected shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected beforeLoadImpl(session: LoaderSession): void;
    protected fireOnProgressEvent(progress: string): Promise<void>;
    protected extraMesurements(result: LoadResult<T, E>): Record<string, number>;
    protected abstract loadImpl(session: LoaderSession): Promise<LoadResult<T, E>>;
}
export declare abstract class FileLoader<T, E = {}> extends Loader<T, E> {
    file: string;
    private expiryToken;
    constructor(file: string);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected beforeLoadImpl(session: LoaderSession): void;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<T, E>>;
    protected abstract loadFromFile(session: LoaderSession): Promise<LoadResultOD<T, E>>;
}
export declare abstract class FolderLoader<T, TFile, E = {}, EFile = {}> extends Loader<T, E> {
    folder: string;
    private subLoaderConstructor;
    private fileCount;
    private subLoaders;
    constructor(folder: string, subLoaderConstructor: {
        new (file: string): FileLoader<TFile, EFile>;
    });
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<T, E>>;
    protected extraMesurements(result: LoadResult<T, E>): {
        fileCount: number;
    };
    protected abstract mergeFiles(fileResults: LoadResult<TFile, EFile>[], session: LoaderSession): Promise<LoadResult<T, E>>;
}
export declare abstract class ContentLoader<T, E = {}> extends Loader<T, E> {
    file: string;
    private contentProvider?;
    private expiryToken;
    protected loaderDependencies: LoaderDependencies;
    protected readDependency: boolean;
    constructor(file: string, contentProvider?: (() => Promise<string>) | undefined);
    shouldReloadImpl(session: LoaderSession): Promise<boolean>;
    protected beforeLoadImpl(session: LoaderSession): void;
    protected loadImpl(session: LoaderSession): Promise<LoadResult<T, E>>;
    protected abstract postLoad(content: string | undefined, dependencies: Dependency[], error: any, session: LoaderSession): Promise<LoadResultOD<T, E>>;
}
type PromiseValue<P> = P extends Promise<infer K> ? K : P;
declare class LoaderDependencies {
    current: Record<string, Loader<unknown, unknown>>;
    private newValues;
    shouldReload(session: LoaderSession): Promise<boolean>;
    getOrCreate<R extends Loader<unknown, unknown>>(key: string, factory: (key: string) => R, type: {
        new (...args: any[]): R;
    }): R;
    loadMultiple<R extends Loader<unknown, unknown>>(dependencies: string[], session: LoaderSession, type: {
        new (...args: any[]): R;
    }): Promise<PromiseValue<ReturnType<R["load"]>>[]>;
    flip(): void;
}
export declare function mergeInLoadResult<K extends string, T extends {
    [k in K]: any[];
}>(loadResults: T[], key: K): T[K];
