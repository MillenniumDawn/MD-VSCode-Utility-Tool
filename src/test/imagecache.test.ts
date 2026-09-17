import * as assert from 'assert';
import * as vscode from 'vscode';
import { PNG } from 'pngjs';
import { _clearImageCachesForTest, getGfxSpriteMap, readPngHeaderDimensions } from '../util/image/imagecache';
import { clearDlcZipCache } from '../util/fileloader';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

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

    // The icon fallback scan probes every .gfx under interface/ for each icon it cannot place. The
    // map cache used to hold 64 of them, fewer than the tree has, so the first file was gone again
    // by the time the next icon reached it. 150 files: past that limit and past the 100-entry
    // content cache, so a map that fell out of either would show up as a second read.
    describe('getGfxSpriteMap', () => {
        const fileCount = 150;
        let readsByFile: Map<string, number>;

        function gfxFile(index: number): string {
            return `interface/scan_${index}.gfx`;
        }

        beforeEach(() => {
            readsByFile = new Map();
            stubVscode({
                now: () => 4000,
                stat: async () => ({ type: vscode.FileType.File, mtime: 1, ctime: 0, size: 0 }),
                readFile: async (uri: any) => {
                    const p = String(uri.path ?? uri.fsPath ?? '').replace(/\\/g, '/');
                    const file = p.substring(p.indexOf('interface/'));
                    readsByFile.set(file, (readsByFile.get(file) ?? 0) + 1);
                    const index = /scan_(\d+)\.gfx$/.exec(file)?.[1];
                    return Buffer.from(
                        `spriteTypes = {\n\tspriteType = { name = "GFX_sprite_${index}" texturefile = "gfx/${index}.dds" }\n}`,
                    );
                },
                workspaceFolders: [
                    { uri: { fsPath: '/ws', path: '/ws', scheme: 'file', toString: () => 'file:///ws' } },
                ],
            });
        });

        afterEach(async () => {
            restoreVscodeStubs();
            _clearImageCachesForTest();
            await clearDlcZipCache();
        });

        it('keeps every map of a tree larger than the old limits', async () => {
            for (let i = 0; i < fileCount; i++) {
                const map = await getGfxSpriteMap(gfxFile(i));
                assert.strictEqual(map[`GFX_sprite_${i}`]?.texturefile, `gfx/${i}.dds`);
            }
            for (let i = 0; i < fileCount; i++) {
                await getGfxSpriteMap(gfxFile(i));
            }
            for (let i = 0; i < fileCount; i++) {
                assert.strictEqual(readsByFile.get(gfxFile(i)), 1, `${gfxFile(i)} was read again`);
            }
        });

        it('hands out one shared map per file', async () => {
            const first = await getGfxSpriteMap(gfxFile(0));
            const second = await getGfxSpriteMap(gfxFile(0));
            assert.strictEqual(second, first);
        });
    });
});
