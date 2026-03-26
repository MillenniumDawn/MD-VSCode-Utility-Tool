import { DDSPixelFormat, DDSHeaderDXT10 } from "./typedef";
export declare const PIXEL_VALUE_TYPE_SIGNED = 1;
export declare const PIXEL_VALUE_TYPE_NORM = 2;
export declare const PIXEL_VALUE_TYPE_SRGB = 4;
export declare enum PixelValueType {
    typeless = 0,
    float = 16,
    uint = 32,
    unorm = 34,
    unorm_srgb = 38,
    sint = 33,
    snorm = 35,
    shardedexp = 48
}
export declare enum CompressFormat {
    bc1 = 1,
    bc2 = 2,
    bc3 = 3,
    bc4 = 4,
    bc5 = 5,
    bc6h = 6,
    bc7 = 7
}
export declare const CHANNEL_FORMAT_ALPHA = 1;
export declare const CHANNEL_FORMAT_TYPE_MASK = 254;
export declare enum ChannelFormat {
    rgb = 0,
    rgba = 1,
    yuv = 2,
    yuva = 3,
    l = 4,
    la = 5,
    a = 7,
    rg = 8,
    r = 10,
    g = 12,
    d = 14,
    ycbcr = 16,
    ycbcra = 18
}
export interface PixelFormatBase {
    compressed: boolean;
    valueType: PixelValueType;
}
export interface CompressedPixelFormat extends PixelFormatBase {
    compressed: true;
    compressFormat: CompressFormat;
    alphaPremultiplied: boolean;
}
export interface RawPixelFormat extends PixelFormatBase {
    compressed: false;
    bitsPerPixel: number;
    channelCount: number;
    channelOrderInPixel: number[];
    channelStartInPixel: number[];
    channelLengthInPixel: number[];
    channelFormat: ChannelFormat;
}
export type PixelFormat = CompressedPixelFormat | RawPixelFormat;
export declare function convertPixelFormat(ddsPixelFormat: DDSPixelFormat, dxt10Header?: DDSHeaderDXT10): PixelFormat;
export declare function getImageSizeInBytes(pixelFormat: PixelFormat, width: number, height: number): number;
export declare function getBlockSize(compressFormat: CompressFormat): number;
export declare function pixelFormatToString(pixelFormat: PixelFormat): string;
