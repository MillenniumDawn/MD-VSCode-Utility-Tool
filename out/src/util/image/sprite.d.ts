import * as vscode from 'vscode';
import { NumberPosition } from "../common";
export declare class Image {
    readonly pngBuffer: Buffer;
    readonly width: number;
    readonly height: number;
    readonly path: vscode.Uri;
    private cachedUri;
    constructor(pngBuffer: Buffer, width: number, height: number, path: vscode.Uri);
    get uri(): string;
}
export declare class Sprite {
    readonly id: string;
    readonly image: Image;
    readonly noOfFrames: number;
    private cachedFrames;
    constructor(id: string, image: Image, noOfFrames: number);
    get frames(): Image[];
    get width(): number;
    get height(): number;
}
export declare class CorneredTileSprite extends Sprite {
    readonly size: NumberPosition;
    readonly borderSize: NumberPosition;
    private cachedTiles;
    constructor(id: string, image: Image, noOfFrames: number, size: NumberPosition, borderSize: NumberPosition);
    getTiles(frameId?: number): Image[];
}
