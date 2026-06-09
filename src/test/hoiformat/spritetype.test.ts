import * as assert from 'assert';
import { parseHoi4File } from '../../hoiformat/hoiparser';
import { getSpriteTypes } from '../../hoiformat/spritetype';

function child(node: any, name: string): any {
    const found = (node.value as any[]).find(n => n.name === name);
    assert.ok(found, `expected a child named ${name}`);
    return found;
}

describe('hoiformat/spritetype', () => {
    describe('getSpriteTypes', () => {
        it('extracts a single spritetype with default noofframes = 1', () => {
            const root = parseHoi4File([
                'spritetypes = {',
                '    spritetype = {',
                '        name = "GFX_button_normal"',
                '        texturefile = "gfx/button.dds"',
                '    }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            assert.strictEqual(types.length, 1);
            assert.strictEqual(types[0].name, 'GFX_button_normal');
            assert.strictEqual((types[0] as any).texturefile, 'gfx/button.dds');
            assert.strictEqual((types[0] as any).noofframes, 1);
        });

        it('respects an explicit noofframes value', () => {
            const root = parseHoi4File([
                'spritetypes = {',
                '    spritetype = {',
                '        name = "GFX_anim"',
                '        texturefile = "gfx/anim.dds"',
                '        noofframes = 8',
                '    }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            assert.strictEqual(types.length, 1);
            assert.strictEqual((types[0] as any).noofframes, 8);
        });

        it('extracts frameanimatedspritetype and textspritetype alongside spritetype', () => {
            const root = parseHoi4File([
                'spritetypes = {',
                '    spritetype = { name = "GFX_a" texturefile = "a.dds" }',
                '    frameanimatedspritetype = { name = "GFX_b" texturefile = "b.dds" noofframes = 3 }',
                '    textspritetype = { name = "GFX_c" texturefile = "c.dds" }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            const names = types.map(t => t.name).sort();
            assert.deepStrictEqual(names, ['GFX_a', 'GFX_b', 'GFX_c']);
        });

        it('extracts corneredtilespritetype with size, bordersize and tilingCenter defaults', () => {
            const root = parseHoi4File([
                'spritetypes = {',
                '    corneredtilespritetype = {',
                '        name = "GFX_tile"',
                '        texturefile = "gfx/tile.dds"',
                '    }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            assert.strictEqual(types.length, 1);
            const tile = types[0] as any;
            assert.strictEqual(tile.name, 'GFX_tile');
            assert.deepStrictEqual(tile.size, { x: 100, y: 100 });
            assert.deepStrictEqual(tile.bordersize, { x: 0, y: 0 });
            assert.strictEqual(tile.tilingCenter, false);
        });

        it('reads explicit size and bordersize, but the camelCase tilingCenter schema key is case-mismatched', () => {
            // Known limitation: the convertObject helper lowercases child names for
            // matching, but the cornered-tile schema defines `tilingCenter` in
            // camelCase. So `tilingCenter = yes` in the file does not match the
            // schema key `tilingCenter` (which was lowercased to `tilingcenter` at
            // access time) and falls back to the default `false`. The size and
            // bordersize blocks are nested object schemas, not flat keys, and they
            // match correctly.
            const root = parseHoi4File([
                'spritetypes = {',
                '    corneredtilespritetype = {',
                '        name = "GFX_tile"',
                '        texturefile = "gfx/tile.dds"',
                '        size = { x = 32 y = 24 }',
                '        bordersize = { x = 4 y = 4 }',
                '        tilingCenter = yes',
                '    }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            const tile = types[0] as any;
            assert.deepStrictEqual(tile.size, { x: 32, y: 24 });
            assert.deepStrictEqual(tile.bordersize, { x: 4, y: 4 });
            // Document the actual behaviour: tilingCenter falls back to the default
            // because of the case-mismatch between the schema key and the child name.
            assert.strictEqual(tile.tilingCenter, false);
        });

        it('skips sprites missing either name or texturefile', () => {
            const root = parseHoi4File([
                'spritetypes = {',
                '    spritetype = { name = "GFX_keep" texturefile = "k.dds" }',
                '    spritetype = { texturefile = "noname.dds" }',
                '    spritetype = { name = "GFX_notexture" }',
                '}',
            ].join('\n'));

            const types = getSpriteTypes(root);
            assert.deepStrictEqual(types.map(t => t.name), ['GFX_keep']);
        });

        it('returns an empty list when the file has no spritetypes', () => {
            const root = parseHoi4File('unrelated = { foo = 1 }');
            assert.deepStrictEqual(getSpriteTypes(root), []);
        });
    });
});
