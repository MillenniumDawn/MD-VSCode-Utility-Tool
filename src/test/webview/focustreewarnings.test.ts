import './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';

// focustree.ts (and initCommon) register a load handler that walks the real shell DOM and
// crashes against the empty jsdom document. Swallow load registrations; only the exported
// helper is under test.
const windowAddEventListener = (global as any).window.addEventListener.bind((global as any).window);
(global as any).window.addEventListener = (type: string, listener: any) => {
	if (type !== "load") {
		windowAddEventListener(type, listener);
	}
};
(global as any).window.focusTrees = [];

const { warningFocusIdsFor } = require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree');

function treeWithWarnings(warnings: FocusTree['warnings']): FocusTree {
    return { warnings } as FocusTree;
}

function sorted(ids: Set<string>): string[] {
    return [...ids].sort();
}

describe('webview/focustree warningFocusIdsFor', () => {
    it('collects the source and related sources of every warning', () => {
        const ids = warningFocusIdsFor(treeWithWarnings([
            { text: 'pair', source: 'a', relatedSources: ['b'] },
            { text: 'single', source: 'c' },
        ]));
        assert.deepStrictEqual(sorted(ids), ['a', 'b', 'c']);
    });

    it('dedupes ids appearing in several warnings', () => {
        const ids = warningFocusIdsFor(treeWithWarnings([
            { text: 'x', source: 'a', relatedSources: ['b'] },
            { text: 'y', source: 'b', relatedSources: ['a'] },
        ]));
        assert.deepStrictEqual(sorted(ids), ['a', 'b']);
    });

    it('returns an empty set when the tree has no warnings', () => {
        assert.strictEqual(warningFocusIdsFor(treeWithWarnings([])).size, 0);
    });

    it('tolerates warnings without relatedSources', () => {
        const ids = warningFocusIdsFor(treeWithWarnings([
            { text: 'legacy', source: 'a' },
        ]));
        assert.deepStrictEqual(sorted(ids), ['a']);
    });
});
