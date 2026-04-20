import { Zone, Point, Region, MapLoaderExtra } from "../definitions";
import { DetailValue, Enum } from '../../../hoiformat/schema';
import { Loader as CommonLoader, FileLoader as CommonFileLoader, FolderLoader as CommonFolderLoader, mergeInLoadResult as commonMergeInLoadResult, LoadResult as CommonLoadResult, LoadResultOD as CommonLoadResultOD } from '../../../util/loader/loader';
export declare abstract class Loader<T> extends CommonLoader<T, MapLoaderExtra> {
}
export declare abstract class FileLoader<T> extends CommonFileLoader<T, MapLoaderExtra> {
}
export declare abstract class FolderLoader<T, F> extends CommonFolderLoader<T, F, MapLoaderExtra, MapLoaderExtra> {
}
export declare const mergeInLoadResult: typeof commonMergeInLoadResult;
export type LoadResult<T> = CommonLoadResult<T, MapLoaderExtra>;
export type LoadResultOD<T> = CommonLoadResultOD<T, MapLoaderExtra>;
export declare function pointEqual(a: Point, b: Point): boolean;
export declare function convertColor(color: DetailValue<Enum> | undefined): number;
export declare function sortItems<T extends {
    id: number;
}>(items: T[], validMaxId: number, onMaxIdTooLarge: (maxId: number) => void, onConflict: (newItem: T, existingItem: T, badId: number) => void, onNotExist: (startId: number, endId: number) => void, reassignMinusOneId?: boolean, badId?: number): {
    sorted: T[];
    badId: number;
};
export declare function mergeRegion<K extends string, T extends {
    [k in K]: number[];
}>(input: T, subRegionIdType: K, subRegions: (Region | undefined | null)[], width: number, onRegionNotExist: (regionId: number) => void, onNoRegion: () => void): T & Region;
export declare function mergeRegions(regions: (Zone | Region)[], width: number): Region;
export declare function addPointToZone(zone: Zone, point: Point): void;
