import { Point, Zone } from "./definitions";
export declare function inBBox(point: Point, bbox: Zone): boolean;
export declare function bboxCenter(bbox: Zone): Point;
export declare function distanceSqr(a: Point, b: Point): number;
export declare function distanceHamming(a: Point, b: Point): number;
