import * as assert from 'assert';
import { computeContinuousFocusEdit } from '../previewdef/focustree/continuousedit';

function apply(text: string, treeStart: number, x: number, y: number): string | undefined {
    const edit = computeContinuousFocusEdit(text, treeStart, x, y);
    return edit && text.substring(0, edit.start) + edit.newText + text.substring(edit.end);
}

describe('focustree computeContinuousFocusEdit', () => {
    it('replaces an existing continuous_focus_position block', () => {
        const text = 'focus_tree = {\n\tid = a\n\tcontinuous_focus_position = { x = 50 y = 1000 }\n}\n';
        assert.strictEqual(apply(text, 0, 120.4, 880.6),
            'focus_tree = {\n\tid = a\n\tcontinuous_focus_position = { x = 120 y = 881 }\n}\n');
    });

    it('replaces a block written loosely', () => {
        const text = 'focus_tree={id=a continuous_focus_position={x=10\n y = 20.}}';
        assert.strictEqual(apply(text, 0, 1, 2),
            'focus_tree={id=a continuous_focus_position={ x = 1 y = 2 }}');
    });

    it('inserts the key when the tree has none, lined up with its children', () => {
        const text = 'focus_tree = {\n    id = a\n}\n';
        assert.strictEqual(apply(text, 0, 5, 6),
            'focus_tree = {\n    continuous_focus_position = { x = 5 y = 6 }\n    id = a\n}\n');
    });

    it('inserts into an empty tree with a tab indent', () => {
        assert.strictEqual(apply('focus_tree = {}', 0, 5, 6),
            'focus_tree = {\n\tcontinuous_focus_position = { x = 5 y = 6 }}');
    });

    it('edits the tree that starts at the offset, not the first one', () => {
        const first = 'focus_tree = {\n\tid = a\n\tcontinuous_focus_position = { x = 1 y = 1 }\n}\n';
        const text = first + 'FOCUS_TREE = {\n\tid = b\n\tCONTINUOUS_FOCUS_POSITION = { x = 2 y = 2 }\n}\n';
        assert.strictEqual(apply(text, first.length, 7, 8),
            first + 'FOCUS_TREE = {\n\tid = b\n\tCONTINUOUS_FOCUS_POSITION = { x = 7 y = 8 }\n}\n');
    });

    it('gives nothing when no tree starts at the offset any more', () => {
        const text = '\nfocus_tree = {\n\tid = a\n}\n';
        assert.strictEqual(computeContinuousFocusEdit(text, 0, 1, 2), undefined);
    });

    it('gives nothing when the file does not parse', () => {
        assert.strictEqual(computeContinuousFocusEdit('focus_tree = {', 0, 1, 2), undefined);
    });
});
