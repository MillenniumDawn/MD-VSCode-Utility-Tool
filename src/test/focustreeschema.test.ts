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
});
