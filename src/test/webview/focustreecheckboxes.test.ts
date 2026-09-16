import './setup';
import * as assert from 'assert';

// focustree.ts (and initCommon) register a load handler that walks the real shell DOM and
// crashes against the empty jsdom document. Swallow load registrations for the duration of the
// require; only the exported helper is under test.
//
// Restored immediately afterwards, and not left in place: every webview test file shares one jsdom
// window, so a patch that outlived this require would strip the load handler off whichever module
// happened to be required next.
const originalAddEventListener = (global as any).window.addEventListener;
const windowAddEventListener = originalAddEventListener.bind((global as any).window);
(global as any).window.addEventListener = (type: string, listener: any) => {
	if (type !== "load") {
		windowAddEventListener(type, listener);
	}
};
(global as any).window.focusTrees = [];

let focustree: typeof import('../../../webviewsrc/focustree');
try {
    focustree = require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree');
} finally {
    (global as any).window.addEventListener = originalAddEventListener;
}

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
