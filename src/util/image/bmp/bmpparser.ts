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
/** The DIB header has to reach the bits-per-pixel field: BITMAPINFOHEADER and later do. */
const MIN_DIB_HEADER_LENGTH = 16;
/** BITMAPINFOHEADER carries a compression field at this offset; the shorter core header does not. */
const DIB_COMPRESSION_OFFSET = 16;
const BI_RGB = 0;
const VALID_BITS_PER_PIXEL = new Set([1, 4, 8, 16, 24, 32]);

export function parseBmp(buffer: ArrayBuffer, byteOffset: number): BMP {
    const uint8Buffer = new Uint8Array(buffer, byteOffset);
    if (uint8Buffer[0] !== 0x42 || uint8Buffer[1] !== 0x4D) {
        throw new UserError("Bmp not starts with 'BM'");
    }

    const available = buffer.byteLength - byteOffset;
    if (available < FILE_HEADER_LENGTH + 4) {
        throw new UserError("BMP header is truncated");
    }

    const fileHeader = new DataView(buffer, byteOffset, FILE_HEADER_LENGTH + 4);
    const dataOffset = byteOffset + fileHeader.getUint32(10, true);

    // The field is a byte count, so it is used as one. The width, height and depth every reader
    // here needs sit inside the first 16 bytes; a header that stops short of them is not one.
    const dibHeaderLength = fileHeader.getUint32(FILE_HEADER_LENGTH, true);
    if (dibHeaderLength < MIN_DIB_HEADER_LENGTH) {
        throw new UserError(`BMP header of ${dibHeaderLength} bytes is not supported`);
    }
    if (available < FILE_HEADER_LENGTH + dibHeaderLength) {
        throw new UserError("BMP header is truncated");
    }
    const dibHeader = new DataView(buffer, FILE_HEADER_LENGTH + byteOffset, dibHeaderLength);

    const width = dibHeader.getInt32(4, true);
    // Signed: a negative height is a top-down image. The map readers walk rows bottom-up, as
    // the game's own files are, so a top-down file is refused rather than read upside down.
    const height = dibHeader.getInt32(8, true);
    if (height < 0) {
        throw new UserError("Top-down BMP (negative height) is not supported");
    }
    const bitsPerPixel = dibHeader.getUint16(14, true);
    assertImageDimensions(width, height, "BMP");
    if (!VALID_BITS_PER_PIXEL.has(bitsPerPixel)) {
        throw new UserError(`BMP bits-per-pixel value ${bitsPerPixel} is not valid`);
    }
    if (dibHeaderLength >= DIB_COMPRESSION_OFFSET + 4) {
        const compression = dibHeader.getUint32(DIB_COMPRESSION_OFFSET, true);
        if (compression !== BI_RGB) {
            throw new UserError(`Compressed BMP (compression ${compression}) is not supported`);
        }
    }

    // Rows are padded to four bytes. Plain arithmetic rather than shifts: the product is bounded
    // by the dimension check above, and a shift would wrap it to a signed 32-bit value anyway.
    const bytesPerRow = Math.ceil(Math.ceil(width * bitsPerPixel / 8) / 4) * 4;
    const dataEnd = dataOffset + bytesPerRow * height;
    if (dataEnd > buffer.byteLength) {
        throw new UserError(
            `BMP pixel data (start ${dataOffset}, end ${dataEnd}) exceeds buffer size ${buffer.byteLength}`,
        );
    }

    return { width, height, bitsPerPixel, bytesPerRow, data: new Uint8Array(buffer, dataOffset, bytesPerRow * height) };
}
