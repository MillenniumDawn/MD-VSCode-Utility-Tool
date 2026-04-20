export interface BMP {
    width: number;
    height: number;
    bitsPerPixel: number;
    bytesPerRow: number;
    data: Uint8Array;
}
export declare function parseBmp(buffer: ArrayBuffer, byteOffset: number): BMP;
