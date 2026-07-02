import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getTechnologyTrees, isSpecialProjectTech, Technology } from '../previewdef/technology/schema';

function technologiesById(source: string): Record<string, Technology> {
    const trees = getTechnologyTrees(parseHoi4File(source));
    const byId: Record<string, Technology> = {};
    for (const tree of trees) {
        for (const tech of tree.technologies) {
            byId[tech.id] = tech;
        }
    }
    return byId;
}

const sample = [
    'technologies = {',
    '    sp_test_tech = {',
    '        enable_equipments = { sp_test_tech }',
    '        categories = { CAT_sp_aa CAT_aa CAT_Military }',
    '        folder = { name = artillery_folder position = { x = 0 y = 0 } }',
    '    }',
    '    plain_test_tech = {',
    '        enable_equipments = { plain_test_tech }',
    '        categories = { CAT_aa CAT_Military }',
    '        folder = { name = artillery_folder position = { x = 0 y = 1 } }',
    '    }',
    '    no_category_tech = {',
    '        enable_equipments = { no_category_tech }',
    '        folder = { name = artillery_folder position = { x = 1 y = 0 } }',
    '    }',
    '}',
].join('\n');

describe('previewdef/technology/schema', () => {
    describe('getTechnologies categories parsing', () => {
        it('parses the categories block into a string array (preserving case)', () => {
            const byId = technologiesById(sample);
            assert.deepStrictEqual(byId['sp_test_tech'].categories, ['CAT_sp_aa', 'CAT_aa', 'CAT_Military']);
            assert.deepStrictEqual(byId['plain_test_tech'].categories, ['CAT_aa', 'CAT_Military']);
        });

        it('yields an empty categories array when the block is absent', () => {
            const byId = technologiesById(sample);
            assert.deepStrictEqual(byId['no_category_tech'].categories, []);
        });

        it('sets isSpecialProject true for a CAT_sp_* category', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['sp_test_tech'].isSpecialProject, true);
        });

        it('sets isSpecialProject false without a CAT_sp_* category', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['plain_test_tech'].isSpecialProject, false);
            assert.strictEqual(byId['no_category_tech'].isSpecialProject, false);
        });
    });

    describe('isSpecialProjectTech', () => {
        it('matches the CAT_sp_ prefix case-insensitively', () => {
            assert.strictEqual(isSpecialProjectTech(['CAT_sp_aa']), true);
            assert.strictEqual(isSpecialProjectTech(['CAT_sp_arty', 'CAT_arty']), true);
            assert.strictEqual(isSpecialProjectTech(['cat_sp_r_arty']), true);
        });

        it('does not match ordinary categories', () => {
            assert.strictEqual(isSpecialProjectTech([]), false);
            assert.strictEqual(isSpecialProjectTech(['CAT_aa', 'CAT_Military']), false);
            assert.strictEqual(isSpecialProjectTech(['CAT_special']), false);
        });
    });
});
