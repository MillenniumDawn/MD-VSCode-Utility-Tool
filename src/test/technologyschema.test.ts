import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getTechnologyTrees, isSpecialProjectTech, Technology } from '../previewdef/technology/schema';
import { getSubTechnologySpriteNames } from '../previewdef/technology/contentbuilder';

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
    '    sp_test_tech = {',                              // sp_ id + CAT_sp_* => special project
    '        enable_equipments = { sp_test_tech }',
    '        categories = { CAT_sp_aa CAT_aa CAT_Military }',
    '        folder = { name = artillery_folder position = { x = 0 y = 0 } }',
    '    }',
    '    plain_test_tech = {',                           // ordinary tech, ordinary categories
    '        enable_equipments = { plain_test_tech }',
    '        categories = { CAT_aa CAT_Military }',
    '        folder = { name = artillery_folder position = { x = 0 y = 1 } }',
    '    }',
    '    no_category_tech = {',                          // no categories block at all
    '        enable_equipments = { no_category_tech }',
    '        folder = { name = artillery_folder position = { x = 1 y = 0 } }',
    '    }',
    '    arty_upgrade_3 = {',                            // CAT_sp_* but a NON-sp id => not a special project
    '        enable_equipments = { arty_upgrade_3 }',
    '        categories = { CAT_sp_arty CAT_sp_r_arty CAT_arty }',
    '        folder = { name = artillery_folder position = { x = 1 y = 1 } }',
    '    }',
    '    sp_no_cat_tech = {',                            // sp_ id but no CAT_sp_* category => not a special project
    '        enable_equipments = { sp_no_cat_tech }',
    '        categories = { CAT_special_forces }',
    '        folder = { name = artillery_folder position = { x = 2 y = 0 } }',
    '    }',
    '}',
].join('\n');

describe('previewdef/technology/schema', () => {
    describe('getTechnologies categories parsing', () => {
        it('parses the categories block into a string array (preserving case)', () => {
            const byId = technologiesById(sample);
            assert.deepStrictEqual(byId['sp_test_tech'].categories, ['CAT_sp_aa', 'CAT_aa', 'CAT_Military']);
            assert.deepStrictEqual(byId['plain_test_tech'].categories, ['CAT_aa', 'CAT_Military']);
            assert.deepStrictEqual(byId['arty_upgrade_3'].categories, ['CAT_sp_arty', 'CAT_sp_r_arty', 'CAT_arty']);
        });

        it('yields an empty categories array when the block is absent', () => {
            const byId = technologiesById(sample);
            assert.deepStrictEqual(byId['no_category_tech'].categories, []);
        });

        it('sets isSpecialProject true for an sp_ id carrying a CAT_sp_* category', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['sp_test_tech'].isSpecialProject, true);
        });

        it('sets isSpecialProject false for ordinary and category-less techs', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['plain_test_tech'].isSpecialProject, false);
            assert.strictEqual(byId['no_category_tech'].isSpecialProject, false);
        });

        it('sets isSpecialProject false for a CAT_sp_* category on a non-sp id (regression)', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['arty_upgrade_3'].isSpecialProject, false);
        });

        it('sets isSpecialProject false for an sp_ id without a CAT_sp_* category', () => {
            const byId = technologiesById(sample);
            assert.strictEqual(byId['sp_no_cat_tech'].isSpecialProject, false);
        });
    });

    describe('isSpecialProjectTech', () => {
        it('is true only for an sp_ id with a CAT_sp_ category, case-insensitively', () => {
            assert.strictEqual(isSpecialProjectTech('SP_Anti_Air_0', ['CAT_sp_aa', 'CAT_aa']), true);
            assert.strictEqual(isSpecialProjectTech('SP_arty_1', ['CAT_sp_arty', 'CAT_arty']), true);
            assert.strictEqual(isSpecialProjectTech('sp_r_arty_0', ['cat_sp_r_arty']), true);
        });

        it('is false when the CAT_sp_ category rides a non-sp id (Arty_upgrade / nsb_Arty_upgrade regression)', () => {
            assert.strictEqual(isSpecialProjectTech('Arty_upgrade_3', ['CAT_sp_arty', 'CAT_sp_r_arty']), false);
            assert.strictEqual(isSpecialProjectTech('nsb_Arty_upgrade_4', ['CAT_sp_arty']), false);
        });

        it('is false for an sp_ id with no CAT_sp_ category', () => {
            assert.strictEqual(isSpecialProjectTech('sp_double_shot_rifle_tech', []), false);
            assert.strictEqual(isSpecialProjectTech('SP_Anti_Air_0', ['CAT_aa', 'CAT_Military']), false);
        });

        it('is false for ordinary techs', () => {
            assert.strictEqual(isSpecialProjectTech('plain', []), false);
            assert.strictEqual(isSpecialProjectTech('plain', ['CAT_aa', 'CAT_Military']), false);
        });
    });

    describe('getSubTechnologySpriteNames', () => {
        it('returns exactly the pre-change try-list for a non-special-project sub-tech', () => {
            assert.deepStrictEqual(getSubTechnologySpriteNames('artillery_folder', false), [
                'GFX_subtechnology_artillery_folder_available_item_bg',
                'GFX_subtechnology_available_item_bg',
            ]);
        });

        it('prepends the special-project variant, in order, keeping the non-SP tail intact', () => {
            assert.deepStrictEqual(getSubTechnologySpriteNames('artillery_folder', true), [
                'GFX_subtechnology_artillery_folder_special_project_available_item_bg',
                'GFX_subtechnology_artillery_folder_available_item_bg',
                'GFX_subtechnology_available_item_bg',
            ]);
        });

        it('SP list is the non-SP list with exactly one SP variant prepended', () => {
            const nonSp = getSubTechnologySpriteNames('infantry_folder', false);
            const sp = getSubTechnologySpriteNames('infantry_folder', true);
            assert.deepStrictEqual(sp.slice(1), nonSp);
            assert.strictEqual(sp[0], 'GFX_subtechnology_infantry_folder_special_project_available_item_bg');
        });
    });
});
