import * as assert from 'assert';
import * as path from 'path';
import { PNG } from 'pngjs';
import {
    decodeImageToPng,
    decodeImageToPngSync,
    _setImageWorkerPathForTest,
    _terminateImageWorkerForTest,
} from '../util/image/imagedecoder';
// Imported only so tsc emits the worker file into this test's outDir; it is import-safe on the main
// thread (its message handler attaches only when actually run as a worker_threads worker).
import '../util/image/imageworker';

const TGA = require('tga') as typeof import('tga');

// A tiny 2x2 RGBA TGA built with the same library the converter uses. Pixel indices are r,g,b,a.
function makeTga(): Buffer {
    const rgba = [
        255, 0, 0, 255,   0, 255, 0, 255,
        0, 0, 255, 255,   255, 255, 0, 128,
    ];
    return TGA.createTgaBuffer(2, 2, rgba as unknown as [], false);
}

// A tiny uncompressed A8R8G8B8 (DDPF_RGB|DDPF_ALPHA, 32bpp) DDS. Header is 32 little-endian int32s
// followed by width*height*4 bytes of pixel data.
function makeDds(width: number, height: number): Buffer {
    const bytesPerRow = (32 * width + 7) >>> 3;
    const pixelBytes = bytesPerRow * height;
    const buf = Buffer.alloc(128 + pixelBytes);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const setInt = (intIndex: number, value: number) => dv.setInt32(intIndex * 4, value, true);
    setInt(0, 0x20534444);              // DDS magic 'DDS '
    setInt(1, 124);                     // dwSize
    setInt(2, 0x1 | 0x2 | 0x4 | 0x1000); // dwFlags: CAPS|HEIGHT|WIDTH|PIXELFORMAT
    setInt(3, height);
    setInt(4, width);
    setInt(5, bytesPerRow);             // dwPitchOrLinearSize
    setInt(19, 32);                     // ddspf.dwSize
    setInt(20, 0x40 | 0x1);             // ddspf.dwFlags: DDPF_RGB | DDPF_ALPHA
    setInt(22, 32);                     // dwRGBBitCount
    setInt(23, 0x00ff0000);             // R mask
    setInt(24, 0x0000ff00);             // G mask
    setInt(25, 0x000000ff);             // B mask
    dv.setUint32(26 * 4, 0xff000000, true); // A mask
    setInt(27, 0x1000);                 // dwCaps: DDSCAPS_TEXTURE (no mipmap)
    for (let p = 0; p < pixelBytes; p++) {
        buf[128 + p] = (p * 37) & 0xff;
    }
    return buf;
}

function assertValidPng(pngBuffer: Buffer, width: number, height: number): void {
    assert.ok(pngBuffer.length > 0, 'pngBuffer should be non-empty');
    assert.strictEqual(pngBuffer[0], 0x89, 'PNG signature byte 0');
    assert.strictEqual(pngBuffer[1], 0x50, 'PNG signature byte 1');
    assert.strictEqual(pngBuffer[2], 0x4e, 'PNG signature byte 2');
    assert.strictEqual(pngBuffer[3], 0x47, 'PNG signature byte 3');
    const decoded = PNG.sync.read(pngBuffer);
    assert.strictEqual(decoded.width, width);
    assert.strictEqual(decoded.height, height);
    assert.strictEqual(decoded.data.length, width * height * 4);
}

describe('util/image/imagedecoder', () => {
    describe('decodeImageToPngSync (fallback path)', () => {
        it('decodes a TGA buffer to a PNG with correct dimensions', () => {
            const result = decodeImageToPngSync(makeTga(), 'tga');
            assert.strictEqual(result.width, 2);
            assert.strictEqual(result.height, 2);
            assertValidPng(result.pngBuffer, 2, 2);
        });

        it('decodes an uncompressed DDS buffer to a PNG with correct dimensions', () => {
            const result = decodeImageToPngSync(makeDds(4, 4), 'dds');
            assert.strictEqual(result.width, 4);
            assert.strictEqual(result.height, 4);
            assertValidPng(result.pngBuffer, 4, 4);
        });

        it('throws for a malformed DDS buffer (behavior preserved for getImage catch)', () => {
            assert.throws(() => decodeImageToPngSync(Buffer.alloc(8), 'dds'));
        });
    });

    describe('decodeImageToPng (worker path, real worker file)', () => {
        before(() => {
            // Point the decoder at the worker file compiled into this test's outDir.
            _setImageWorkerPathForTest(path.resolve(__dirname, '../util/image/imageworker.js'));
        });

        after(async () => {
            await _terminateImageWorkerForTest();
        });

        it('round-trips a TGA decode through the worker, matching the sync result', async () => {
            const tga = makeTga();
            const viaWorker = await decodeImageToPng(tga, 'tga');
            const viaSync = decodeImageToPngSync(tga, 'tga');
            assert.strictEqual(viaWorker.width, viaSync.width);
            assert.strictEqual(viaWorker.height, viaSync.height);
            assert.ok(viaWorker.pngBuffer.equals(viaSync.pngBuffer), 'worker PNG should equal sync PNG');
            assertValidPng(viaWorker.pngBuffer, 2, 2);
        });

        it('round-trips a DDS decode through the worker, matching the sync result', async () => {
            const dds = makeDds(4, 4);
            const viaWorker = await decodeImageToPng(dds, 'dds');
            const viaSync = decodeImageToPngSync(dds, 'dds');
            assert.strictEqual(viaWorker.width, viaSync.width);
            assert.strictEqual(viaWorker.height, viaSync.height);
            assert.ok(viaWorker.pngBuffer.equals(viaSync.pngBuffer), 'worker PNG should equal sync PNG');
        });

        it('routes concurrent jobs back to the right callers (id matching)', async () => {
            const tga = makeTga();
            const dds = makeDds(4, 4);
            const [a, b, c] = await Promise.all([
                decodeImageToPng(tga, 'tga'),
                decodeImageToPng(dds, 'dds'),
                decodeImageToPng(tga, 'tga'),
            ]);
            assert.strictEqual(a.width, 2);
            assert.strictEqual(b.width, 4);
            assert.strictEqual(c.width, 2);
            assert.ok(a.pngBuffer.equals(c.pngBuffer), 'same input should yield identical PNG');
        });

        it('rejects a malformed DDS via the worker without killing the worker', async () => {
            await assert.rejects(decodeImageToPng(Buffer.alloc(8), 'dds'));
            // Worker survives a decode error: a subsequent valid decode still succeeds.
            const ok = await decodeImageToPng(makeTga(), 'tga');
            assert.strictEqual(ok.width, 2);
        });
    });
});
