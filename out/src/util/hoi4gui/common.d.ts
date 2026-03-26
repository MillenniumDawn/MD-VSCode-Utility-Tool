import { NumberLike, Position, HOIPartial } from "../../hoiformat/schema";
import { NumberSize } from "../common";
import { StyleTable } from '../styletable';
import { Orientation, ComplexSize, Size, Margin } from "../../hoiformat/gui";
export interface ParentInfo {
    size: NumberSize;
    orientation: Orientation['_name'];
}
export interface RenderCommonOptions {
    id?: string;
    classNames?: string;
    styleTable: StyleTable;
    enableNavigator?: boolean;
}
export declare function normalizeNumberLike(value: NumberLike, parentValue: number, subtractValue?: number): number;
export declare function normalizeNumberLike(value: undefined, parentValue: number, subtractValue?: number): undefined;
export declare function normalizeNumberLike(value: NumberLike | undefined, parentValue: number, subtractValue?: number): number | undefined;
export declare function calculateStartLength(pos: NumberLike | undefined, size: NumberLike | undefined, parentSize: number, orientationFactor: number, origoFactor: number, scale: number): [number, number];
export declare function calculateBBox({ orientation, origo, position, size, scale }: {
    orientation?: Orientation;
    origo?: Orientation;
    position?: Partial<Position>;
    size?: HOIPartial<ComplexSize> | Partial<Size & {
        min: undefined;
    }>;
    scale?: number;
}, parentInfo: ParentInfo): [number, number, number, number, Orientation['_name']];
export declare function normalizeMargin(margin: Partial<Margin> | undefined, size: NumberSize): [number, number, number, number];
export declare function removeHtmlOptions<T>(options: T): {
    [K in Exclude<keyof T, 'id' | 'classNames'>]: T[K];
};
export declare function getWidth(size?: Partial<Size>): NumberLike | undefined;
export declare function getHeight(size?: Partial<Size>): NumberLike | undefined;
