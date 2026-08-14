import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { convertFocusFileNodeToJson, getFocusTreeWithFocusFile, FocusTree, FocusWarning } from '../previewdef/focustree/schema';

const filePath = 'common/national_focus/test.txt';

function focusBlock(id: string, x: number, y: number, extra: string = ''): string {
    return `focus = { id = ${id} x = ${x} y = ${y} ${extra}}`;
}

function treeWithFocuses(...focuses: string[]): string {
    return `focus_tree = {
    id = test_tree
    ${focuses.join('\n    ')}
}`;
}

function treesOf(content: string): FocusTree[] {
    const file = convertFocusFileNodeToJson(parseHoi4File(content), {});
    return getFocusTreeWithFocusFile(file, [], filePath, {});
}

function warningsOf(content: string): FocusWarning[] {
    const trees = treesOf(content);
    assert.ok(trees.length > 0);
    return trees[0].warnings;
}

function warningTexts(content: string): string[] {
    return warningsOf(content).map(w => w.text);
}

describe('previewdef/focustree layout warnings', () => {
    it('parses a prerequisite block with multiple focuses as one OR group', () => {
        const trees = treesOf(treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'prerequisite = { focus = focus_b focus = focus_c }'),
            focusBlock('focus_b', 0, 1),
            focusBlock('focus_c', 2, 1),
        ));
        assert.deepStrictEqual(trees[0].focuses.focus_a.prerequisite, [['focus_b', 'focus_c']]);
    });

    it('reports no warnings for a clean tree', () => {
        const content = treeWithFocuses(
            focusBlock('focus_b', 0, 0),
            focusBlock('focus_a', 0, 1, 'prerequisite = { focus = focus_b }'),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('warns when a prerequisite is positioned below its dependent', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'prerequisite = { focus = focus_b }'),
            focusBlock('focus_b', 0, 1),
        );
        assert.deepStrictEqual(warningTexts(content), [
            'Prerequisite focus_b of focus focus_a is not positioned above it.',
        ]);
    });

    it('warns when a prerequisite is on the same row as its dependent', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'prerequisite = { focus = focus_b }'),
            focusBlock('focus_b', 2, 0),
        );
        assert.deepStrictEqual(warningTexts(content), [
            'Prerequisite focus_b of focus focus_a is not positioned above it.',
        ]);
    });

    it('reports no prerequisite warning when one option of an OR group is above', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 2, 'prerequisite = { focus = focus_b focus = focus_c }'),
            focusBlock('focus_b', 0, 0),
            focusBlock('focus_c', 2, 3),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('warns when no option of an OR-group prerequisite is above', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'prerequisite = { focus = focus_b focus = focus_c }'),
            focusBlock('focus_b', 0, 2),
            focusBlock('focus_c', 2, 2),
        );
        assert.deepStrictEqual(warningTexts(content), [
            'Prerequisite focus_b, focus_c of focus focus_a is not positioned above it.',
        ]);
    });

    it('ignores prerequisites defined outside the tree', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'prerequisite = { focus = focus_elsewhere }'),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('warns when mutually exclusive focuses do not share an X', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'mutually_exclusive = { focus = focus_b }'),
            focusBlock('focus_b', 2, 1),
        );
        const warnings = warningsOf(content);
        assert.strictEqual(warnings.length, 1);
        assert.strictEqual(warnings[0].source, 'focus_a');
        assert.deepStrictEqual(warnings[0].relatedSources, ['focus_b']);
        assert.strictEqual(warnings[0].text, 'Mutually exclusive focuses focus_a and focus_b are not on the same X position.');
    });

    it('reports no warning for mutually exclusive focuses sharing an X', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'mutually_exclusive = { focus = focus_b }'),
            focusBlock('focus_b', 0, 1),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('warns once when the exclusivity is declared on both focuses', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'mutually_exclusive = { focus = focus_b }'),
            focusBlock('focus_b', 2, 1, 'mutually_exclusive = { focus = focus_a }'),
        );
        assert.strictEqual(warningsOf(content).length, 1);
    });

    it('warns when two focuses on the same row are one apart', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0),
            focusBlock('focus_b', 1, 0),
        );
        const warnings = warningsOf(content);
        assert.strictEqual(warnings.length, 1);
        assert.strictEqual(warnings[0].source, 'focus_a');
        assert.deepStrictEqual(warnings[0].relatedSources, ['focus_b']);
        assert.strictEqual(warnings[0].text, 'Focuses focus_a and focus_b are less than 2 apart on the same row, so their icons overlap.');
    });

    it('warns when two focuses share the same position', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0),
            focusBlock('focus_b', 0, 0),
        );
        assert.strictEqual(warningTexts(content).length, 1);
    });

    it('reports no warning for focuses two apart on the same row', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0),
            focusBlock('focus_b', 2, 0),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('reports no warning for focuses stacked on the same column', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0),
            focusBlock('focus_b', 0, 1),
        );
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('checks positions resolved through relative_position_id', () => {
        const content = treeWithFocuses(
            focusBlock('focus_base', 0, -6),
            focusBlock('focus_a', 0, 5, 'relative_position_id = focus_base prerequisite = { focus = focus_b }'),
            focusBlock('focus_b', 0, 0),
        );
        // focus_a resolves to y = 5 - 6 = -1, so the raw check (focus_b at y=0 is above y=5)
        // would pass; the resolved check must flag it.
        assert.deepStrictEqual(warningTexts(content), [
            'Prerequisite focus_b of focus focus_a is not positioned above it.',
        ]);
    });

    it('checks X resolved through relative_position_id for exclusivity', () => {
        const clean = treeWithFocuses(
            focusBlock('focus_base', -6, 0),
            focusBlock('focus_a', 5, 0, 'relative_position_id = focus_base mutually_exclusive = { focus = focus_b }'),
            focusBlock('focus_b', -1, 1),
        );
        // focus_a resolves to x = 5 - 6 = -1, matching focus_b.
        assert.deepStrictEqual(warningTexts(clean), []);

        const broken = treeWithFocuses(
            focusBlock('focus_base', -6, 0),
            focusBlock('focus_a', 5, 0, 'relative_position_id = focus_base mutually_exclusive = { focus = focus_b }'),
            focusBlock('focus_b', 0, 1),
        );
        assert.deepStrictEqual(warningTexts(broken), [
            'Mutually exclusive focuses focus_a and focus_b are not on the same X position.',
        ]);
    });

    it('reports overlap for negative coordinates', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', -1, 0),
            focusBlock('focus_b', 0, 0),
        );
        assert.deepStrictEqual(warningTexts(content), [
            'Focuses focus_a and focus_b are less than 2 apart on the same row, so their icons overlap.',
        ]);
    });

    it('reports all three layout warnings in one tree', () => {
        const content = treeWithFocuses(
            focusBlock('dep', 0, 0, 'prerequisite = { focus = req }'),
            focusBlock('req', 0, 2),
            focusBlock('ex_a', 0, 3, 'mutually_exclusive = { focus = ex_b }'),
            focusBlock('ex_b', 2, 4),
            focusBlock('ov_a', 0, 5),
            focusBlock('ov_b', 1, 5),
        );
        assert.deepStrictEqual(warningTexts(content), [
            'Prerequisite req of focus dep is not positioned above it.',
            'Mutually exclusive focuses ex_a and ex_b are not on the same X position.',
            'Focuses ov_a and ov_b are less than 2 apart on the same row, so their icons overlap.',
        ]);
    });

    it('terminates and warns on a circular relative_position_id chain', () => {
        const content = treeWithFocuses(
            focusBlock('focus_a', 0, 0, 'relative_position_id = focus_b prerequisite = { focus = focus_c }'),
            focusBlock('focus_b', 0, 1, 'relative_position_id = focus_a'),
            focusBlock('focus_c', 0, 5),
        );
        // The cycle is cut (a + b), so focus_a resolves to (0, 1) and focus_c at y=5 is below it.
        const texts = warningTexts(content);
        assert.ok(texts.includes('Prerequisite focus_c of focus focus_a is not positioned above it.'));
    });

    it('reports no layout warnings for shared_focus blocks', () => {
        const content = `shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}
shared_focus = {
    id = SH_b
    focus = { id = sh_b1 x = 0 y = 0 }
}`;
        // The schema drops the nested focuses, leaving one position-less entry per block at (0,0);
        // those must not be compared against each other as if they were real focuses.
        assert.deepStrictEqual(warningTexts(content), []);
    });

    it('reports no layout warnings for joint_focus blocks', () => {
        const content = `joint_focus = {
    focus = { id = j_a x = 0 y = 0 }
    focus = { id = j_b x = 1 y = 0 }
}`;
        const texts = warningTexts(content);
        // The id-less joint pseudo focus keeps its pre-existing focusnoid warning; the layout
        // checks must not add anything on top.
        assert.strictEqual(texts.length, 1);
        assert.ok(!texts.some(t =>
            t.includes('not positioned above') || t.includes('same X position') || t.includes('less than 2 apart')));
    });

    it('skips shared focuses merged into the tree from another file', () => {
        const sharedFile = convertFocusFileNodeToJson(parseHoi4File(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}`), {});
        const sharedTrees = getFocusTreeWithFocusFile(sharedFile, [], 'common/national_focus/shared.txt', {});

        const flags = require('../util/featureflags') as { useConditionInFocus: boolean };
        flags.useConditionInFocus = true;
        try {
            const mainContent = treeWithFocuses(
                focusBlock('m1', 0, 0),
                focusBlock('m2', 0, 1),
            ).replace('id = test_tree', 'id = test_tree\n    shared_focus = SH_a');
            // The merge only looks at sharedFocusTrees, so drive it through the same path the loader uses.
            const mainFile = convertFocusFileNodeToJson(parseHoi4File(mainContent), {});
            const merged = getFocusTreeWithFocusFile(mainFile, sharedTrees, filePath, {});
            const main = merged.find(t => t.id === 'test_tree');
            assert.ok(main?.focuses['SH_a'], 'shared focus must be merged for this test to be meaningful');
            // SH_a sits at (0,0) like m1, but it lives in another file, so no overlap warning.
            assert.deepStrictEqual((main?.warnings ?? []).map(w => w.text), []);
        } finally {
            flags.useConditionInFocus = false;
        }
    });
});
