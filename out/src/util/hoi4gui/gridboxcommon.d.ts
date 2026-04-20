import { HOIPartial } from "../../hoiformat/schema";
import { ParentInfo, RenderCommonOptions } from "./common";
import { NumberSize, NumberPosition } from "../common";
import { StyleTable } from '../styletable';
import { GridBoxType, Format, Background } from "../../hoiformat/gui";
export type GridBoxConnectionType = 'child' | 'parent' | 'related';
export interface GridBoxConnection {
    target: string;
    targetType: GridBoxConnectionType;
    style?: string;
    classNames?: string;
}
export interface GridBoxItem {
    id: string;
    gridX: number;
    gridY: number;
    connections: GridBoxConnection[];
    isJoint?: boolean;
    htmlId?: string;
    classNames?: string;
}
export interface GridBoxConnectionItemDirection {
    in: Record<string, true>;
    out: Record<string, true>;
}
export interface GridBoxConnectionItem {
    x: number;
    y: number;
    up?: GridBoxConnectionItemDirection;
    down?: GridBoxConnectionItemDirection;
    left?: GridBoxConnectionItemDirection;
    right?: GridBoxConnectionItemDirection;
}
export interface RenderGridBoxCommonOptions extends RenderCommonOptions {
    items: Record<string, GridBoxItem>;
    onRenderItem?(item: GridBoxItem, parentInfo: ParentInfo): Promise<string>;
    onRenderLineBox?(item: GridBoxConnectionItem, parentInfo: ParentInfo): Promise<string>;
    lineRenderMode?: 'line' | 'control';
    cornerPosition?: number;
}
export declare function renderGridBoxCommon(gridBox: HOIPartial<GridBoxType>, parentInfo: ParentInfo, options: RenderGridBoxCommonOptions, onRenderBackground?: (background: HOIPartial<Background> | undefined, parentInfo: ParentInfo) => Promise<string>): Promise<string>;
export declare function renderLineConnections(items: Record<string, GridBoxItem>, format: Format['_name'], slotSize: NumberSize, size: NumberSize, styleTable: StyleTable, cornerPosition: number): string;
export declare function renderGridBoxConnection(a: NumberPosition, b: NumberPosition, style: string, type: GridBoxConnectionType, format: Format['_name'], gridSize: NumberSize, classNames: string | undefined, styleTable: StyleTable, cornerPosition?: number, fromId?: string, toId?: string): string;
