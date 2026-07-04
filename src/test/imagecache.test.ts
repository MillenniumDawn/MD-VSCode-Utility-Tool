import * as assert from 'assert';
import { PNG } from 'pngjs';
import { readPngHeaderDimensions } from '../util/image/imagecache';

function makePng(width: number, height: number): Buffer {
    const png = new PNG({ width, height });
    png.data.fill(0);
    return PNG.sync.write(png);
}

describe('util/image/imagecache', () => {
    describe('readPngHeaderDimensions', () => {
        it('reads width/height from the IHDR chunk of a valid PNG', () => {
            const buffer = makePng(3, 5);
            const result = readPngHeaderDimensions(buffer);
            assert.deepStrictEqual(result, { width: 3, height: 5 });
        });

        it('agrees with a full PNG.sync.read decode', () => {
            const buffer = makePng(16, 9);
            const decoded = PNG.sync.read(buffer);
            const result = readPngHeaderDimensions(buffer);
            assert.deepStrictEqual(result, { width: decoded.width, height: decoded.height });
        });

        it('returns undefined for a non-PNG buffer without throwing', () => {
            const buffer = Buffer.from('not a png, just some plain text bytes here');
            assert.strictEqual(readPngHeaderDimensions(buffer), undefined);
        });

        it('returns undefined for a buffer shorter than the IHDR chunk', () => {
            const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
            assert.strictEqual(readPngHeaderDimensions(buffer), undefined);
        });

        it('returns undefined when the signature matches but the chunk type does not', () => {
            const buffer = makePng(3, 5);
            buffer.write('BAD!', 12, 'ascii');
            assert.strictEqual(readPngHeaderDimensions(buffer), undefined);
        });
    });
});
