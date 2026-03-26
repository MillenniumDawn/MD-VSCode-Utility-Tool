import { DDSHeader, DDSHeaderDXT10 } from './typedef';
import { Surface } from './surface';
export declare class DDS {
    readonly header: DDSHeader;
    readonly headerDxt10: DDSHeaderDXT10 | undefined;
    readonly images: Surface[];
    readonly type: 'texture' | 'cubemap' | 'volume';
    readonly arraySize: number;
    readonly mipmapCount: number;
    private constructor();
    static parse(buffer: ArrayBuffer, byteOffset: number): DDS;
    private static parseStandard;
    private static parseDxt10;
}
