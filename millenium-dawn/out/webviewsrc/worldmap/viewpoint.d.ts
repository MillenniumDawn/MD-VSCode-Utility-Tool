import { Subscriber } from "../util/event";
import { FEWorldMap } from "./loader";
import { Zone, Point } from "./definitions";
import { Observable } from 'rxjs';
type ViewPointObj = {
    x: number;
    y: number;
    scale: number;
};
export declare class ViewPoint extends Subscriber {
    private canvas;
    private loader;
    private topBarHeight;
    x: number;
    y: number;
    scale: number;
    observable$: Observable<ViewPointObj>;
    constructor(canvas: HTMLCanvasElement, loader: {
        worldMap: FEWorldMap | undefined;
    }, topBarHeight: number, viewPointObj: ViewPointObj);
    convertX(x: number): number;
    convertY(y: number): number;
    convertBackX(x: number): number;
    convertBackY(y: number): number;
    bboxInView(bbox: Zone, xoffset: number): boolean;
    lineInView(start: Point, end: Point, xoffset: number): boolean;
    centerZone(zone: Zone): void;
    centerPoint(point: Point): void;
    toJson(): {
        x: number;
        y: number;
        scale: number;
    };
    private enableDragger;
    private alignViewPointXY;
    private updateObservable;
}
export {};
