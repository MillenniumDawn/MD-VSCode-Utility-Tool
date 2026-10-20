import * as assert from 'assert';
import * as vscode from 'vscode';
import { _clearImageCachesForTest, getGfxSpriteMap } from '../util/image/imagecache';
import { clearDlcZipCache } from '../util/fileloader';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

describe('util/image/imagecache', () => {
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
