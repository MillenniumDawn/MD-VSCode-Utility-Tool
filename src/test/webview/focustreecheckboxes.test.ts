import { loadEntrypoint } from './setup';
import * as assert from 'assert';

// focustree.ts reads window.focusTrees at module scope and binds its handlers to window load and
// message. Only the exported helpers are under test, so it is loaded with those listeners held back.
(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { collectCompletedFocusIds } = focustree;

describe('webview/focustree collectCompletedFocusIds', () => {
    it('collects every id named by an unscoped has_completed_focus condition', () => {
        const ids = collectCompletedFocusIds([
            { scopeName: '', nodeContent: 'has_completed_focus = ENG_first' },
            { scopeName: '', nodeContent: 'has_completed_focus = ENG_second' },
            { scopeName: '', nodeContent: 'has_completed_focus = ENG_first' },
        ]);

        assert.deepStrictEqual([...ids].sort(), ['ENG_first', 'ENG_second']);
    });

    it('ignores scoped conditions and unrelated content', () => {
        const ids = collectCompletedFocusIds([
            { scopeName: 'ENG', nodeContent: 'has_completed_focus = ENG_scoped' },
            { scopeName: '', nodeContent: 'has_focus_tree = ENG_tree' },
            { scopeName: '', nodeContent: 'has_completed_focus=ENG_no_spaces' },
            { scopeName: '', nodeContent: 'NOT = { has_completed_focus = ENG_nested }' },
            { scopeName: '', nodeContent: 'has_completed_focus = ENG_kept' },
        ]);

        assert.deepStrictEqual([...ids], ['ENG_kept']);
    });

    it('returns an empty set when nothing is referenced', () => {
        assert.strictEqual(collectCompletedFocusIds([]).size, 0);
    });
});
