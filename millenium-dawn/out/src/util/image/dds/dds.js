"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DDS = void 0;
const typedef_1 = require("./typedef");
const surface_1 = require("./surface");
const pixelformat_1 = require("./pixelformat");
const common_1 = require("../../common");
class DDS {
    constructor(header, headerDxt10, images, type, arraySize, mipmapCount) {
        this.header = header;
        this.headerDxt10 = headerDxt10;
        this.images = images;
        this.type = type;
        this.arraySize = arraySize;
        this.mipmapCount = mipmapCount;
    }
    static parse(buffer, byteOffset) {
        const headerArray = new Int32Array(buffer, byteOffset, typedef_1.HEADER_LENGTH_INT);
        if (headerArray[0] !== typedef_1.DDS_MAGIC) {
            throw new common_1.UserError('Invalid magic number in DDS header');
        }
        const header = extractHeader(headerArray);
        if (header.ddspf.dwFlags === typedef_1.DDPF_FOURCC && header.ddspf.dwFourCC === typedef_1.FOURCC_DX10) {
            const dxt10HeaderArray = new Int32Array(buffer, byteOffset + typedef_1.HEADER_LENGTH_INT * 4, typedef_1.HEADER_DXT10_LENGTH_INT);
            const dxt10Header = extractDxt10Header(dxt10HeaderArray);
            return DDS.parseDxt10(buffer, byteOffset, header, dxt10Header);
        }
        else {
            return DDS.parseStandard(buffer, byteOffset, header);
        }
    }
    static parseStandard(buffer, byteOffset, header) {
        const pixelFormat = (0, pixelformat_1.convertPixelFormat)(header.ddspf);
        const cubeMap = !!(header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP);
        const volume = !!(header.dwCaps2 & typedef_1.DDSCAPS2_VOLUME);
        if (cubeMap && volume) {
            throw new common_1.UserError('Cannot set DDSCAPS2_CUBEMAP and DDSCAPS2_VOLUME at same time');
        }
        const mipmapCount = (header.dwCaps & typedef_1.DDSCAPS_MIPMAP) ? header.dwMipMapCount - 1 : 0;
        const offset = byteOffset + typedef_1.HEADER_LENGTH_INT * 4;
        let images;
        if (cubeMap) {
            const cubeMaps = [];
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_POSITIVEX) {
                cubeMaps.push("X+");
            }
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_NEGATIVEX) {
                cubeMaps.push("X-");
            }
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_POSITIVEY) {
                cubeMaps.push("Y+");
            }
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_NEGATIVEY) {
                cubeMaps.push("Y-");
            }
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_POSITIVEZ) {
                cubeMaps.push("Z+");
            }
            if (header.dwCaps2 & typedef_1.DDSCAPS2_CUBEMAP_NEGATIVEZ) {
                cubeMaps.push("Z-");
            }
            [images] = parseCubeMap(buffer, offset, pixelFormat, header.dwWidth, header.dwHeight, cubeMaps, mipmapCount);
        }
        else if (volume) {
            [images] = parseVolumeTexture(buffer, offset, pixelFormat, header.dwWidth, header.dwHeight, header.dwDepth, mipmapCount);
        }
        else {
            [images] = parseTexture(buffer, offset, pixelFormat, header.dwWidth, header.dwHeight, mipmapCount);
        }
        return new DDS(header, undefined, images, cubeMap ? 'cubemap' : volume ? 'volume' : 'texture', 1, mipmapCount);
    }
    static parseDxt10(buffer, byteOffset, header, dxt10Header) {
        const pixelFormat = (0, pixelformat_1.convertPixelFormat)(header.ddspf, dxt10Header);
        const cubeMap = !!(dxt10Header.miscFlag & typedef_1.DDS_RESOURCE_MISC_TEXTURECUBE);
        const volume = dxt10Header.resourceDimension === typedef_1.ResourceDimension.DDS_DIMENSION_TEXTURE3D;
        if (cubeMap && volume) {
            throw new common_1.UserError('Cannot set DDS_RESOURCE_MISC_TEXTURECUBE and use DDS_DIMENSION_TEXTURE3D at same time');
        }
        const mipmapCount = (header.dwCaps & typedef_1.DDSCAPS_MIPMAP) ? header.dwMipMapCount - 1 : 0;
        let offset = byteOffset + (typedef_1.HEADER_LENGTH_INT + typedef_1.HEADER_DXT10_LENGTH_INT) * 4;
        const allImages = [];
        const cubeMaps = ["X+", "X-", "Y+", "Y-", "Z+", "Z-"];
        const arraySize = dxt10Header.arraySize;
        const height = dxt10Header.resourceDimension === typedef_1.ResourceDimension.DDS_DIMENSION_TEXTURE1D ? 1 : header.dwHeight;
        for (let i = 0; i < arraySize; i++) {
            let images;
            if (cubeMap) {
                [images, offset] = parseCubeMap(buffer, offset, pixelFormat, header.dwWidth, height, cubeMaps, mipmapCount);
            }
            else if (volume) {
                [images, offset] = parseVolumeTexture(buffer, offset, pixelFormat, header.dwWidth, height, header.dwDepth, mipmapCount);
            }
            else {
                [images, offset] = parseTexture(buffer, offset, pixelFormat, header.dwWidth, height, mipmapCount);
            }
            allImages.push(...images);
        }
        return new DDS(header, dxt10Header, allImages, cubeMap ? 'cubemap' : volume ? 'volume' : 'texture', arraySize, mipmapCount);
    }
}
exports.DDS = DDS;
function extractHeader(headerArray) {
    return {
        dwFlags: headerArray[2],
        dwHeight: headerArray[3],
        dwWidth: headerArray[4],
        dwPitchOrLinearSize: headerArray[5],
        dwDepth: headerArray[6],
        dwMipMapCount: headerArray[7],
        ddspf: {
            dwFlags: headerArray[20],
            dwFourCC: headerArray[21],
            dwRGBBitCount: headerArray[22],
            dwRBitMask: headerArray[23],
            dwGBitMask: headerArray[24],
            dwBBitMask: headerArray[25],
            dwABitMask: headerArray[26],
        },
        dwCaps: headerArray[27],
        dwCaps2: headerArray[28],
    };
}
function extractDxt10Header(dxt10HeaderArray) {
    return {
        dxgiFormat: dxt10HeaderArray[0],
        resourceDimension: dxt10HeaderArray[1],
        miscFlag: dxt10HeaderArray[2],
        arraySize: dxt10HeaderArray[3],
        miscFlags2: dxt10HeaderArray[4],
    };
}
function parseTexture(buffer, offset, pixelFormat, width, height, mipmapCount) {
    const result = [];
    offset = pushSurface(result, buffer, offset, width, height, pixelFormat, "Main image");
    for (let i = 0; i < mipmapCount; i++) {
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
        offset = pushSurface(result, buffer, offset, width, height, pixelFormat, `Mipmap #${i + 1}`);
    }
    return [result, offset];
}
function parseCubeMap(buffer, offset, pixelFormat, width, height, cubeMaps, mipmapCount) {
    const result = [];
    for (const cubeMap of cubeMaps) {
        offset = pushSurface(result, buffer, offset, width, height, pixelFormat, cubeMap);
        for (let i = 0; i < mipmapCount; i++) {
            width = Math.max(1, Math.floor(width / 2));
            height = Math.max(1, Math.floor(height / 2));
            offset = pushSurface(result, buffer, offset, width, height, pixelFormat, `Mipmap of ${cubeMap} #${i + 1}`);
        }
    }
    return [result, offset];
}
function parseVolumeTexture(buffer, offset, pixelFormat, width, height, depth, mipmapCount) {
    const result = [];
    for (let i = 0; i < depth; i++) {
        offset = pushSurface(result, buffer, offset, width, height, pixelFormat, `Main image depth #${i + 1}`);
    }
    for (let i = 0; i < mipmapCount; i++) {
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
        depth = Math.max(1, Math.floor(depth / 2));
        for (let j = 0; j < depth; j++) {
            offset = pushSurface(result, buffer, offset, width, height, pixelFormat, `Mipmap of #${i + 1} depth #${i + 1}`);
        }
    }
    return [result, offset];
}
function pushSurface(surfaces, buffer, offset, width, height, pixelFormat, name) {
    const length = (0, pixelformat_1.getImageSizeInBytes)(pixelFormat, width, height);
    const end = offset + length;
    if (end > buffer.byteLength) {
        throw new common_1.UserError(`Image ${name} (start ${offset}, end ${end}) exceeds buffer size ${buffer.byteLength}`);
    }
    surfaces.push(new surface_1.Surface(buffer, offset, length, name, width, height, pixelFormat));
    return end;
}
//# sourceMappingURL=dds.js.map