import { UserError } from '../../common';
import { assertImageDimensions } from '../imagelimits';

export interface BMP {
    width: number;
    height: number;
    bitsPerPixel: number;
    bytesPerRow: number;
    data: Uint8Array;
}

const FILE_HEADER_LENGTH = 0xE;

export function parseBmp(buffer: ArrayBuffer, byteOffset: number): BMP {
    const uint8Buffer = new Uint8Array(buffer, byteOffset);
    if (uint8Buffer[0] !== 0x42 || uint8Buffer[1] !== 0x4D) {
        throw new UserError("Bmp not starts with 'BM'");
    }

    const available = buffer.byteLength - byteOffset;
    if (available < FILE_HEADER_LENGTH + 4) {
        throw new UserError("BMP header is truncated");
    }

    const bmpHeader = new DataView(buffer, 2 + byteOffset, 4 << 2);
    const dataOffset = byteOffset + bmpHeader.getUint32(2 << 2, true);

    const dibHeaderLength = bmpHeader.getUint32(3 << 2, true) << 2;
    if (dibHeaderLength < 16 || available < FILE_HEADER_LENGTH + dibHeaderLength) {
        throw new UserError("BMP header is truncated");
    }
    const dibHeader = new DataView(buffer, FILE_HEADER_LENGTH + byteOffset, dibHeaderLength);

    const width = dibHeader.getUint32(1 << 2, true);
    const height = dibHeader.getUint32(2 << 2, true);
    const bitsPerPixel = dibHeader.getUint16(7 << 1, true);
    assertImageDimensions(width, height, "BMP");

    const bytesPerRow = ((width * bitsPerPixel + 7 >> 3) + 3) & 0xFFFFFFFC;
    const dataEnd = dataOffset + bytesPerRow * height;
    if (dataEnd > buffer.byteLength) {
        throw new UserError(
            `BMP pixel data (start ${dataOffset}, end ${dataEnd}) exceeds buffer size ${buffer.byteLength}`,
        );
    }

    return {
        width,
        height,
        bitsPerPixel,
        bytesPerRow,
        data: new Uint8Array(buffer, dataOffset, bytesPerRow * height),
    };
}
