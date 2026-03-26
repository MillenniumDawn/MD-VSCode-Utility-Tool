import { PixelFormat } from "./pixelformat";
export declare class Surface {
    private readonly buffer;
    private readonly offset;
    private readonly length;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly pixelFormat: PixelFormat;
    constructor(buffer: ArrayBuffer, offset: number, length: number, name: string, width: number, height: number, pixelFormat: PixelFormat);
    getFullRgba(): Uint8Array;
    private getFullRgbaFromRawPixels;
    private getFullRgbaFromCompressedPixels;
}
