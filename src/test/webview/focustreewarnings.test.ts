import './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';
import { GridBoxItem } from '../../util/hoi4gui/gridboxcommon';
import { warningBadgeClass, warningBoxClass } from '../../previewdef/focustree/warningstyles';

// focustree.ts (and initCommon) register a load handler that walks the real shell DOM and
// crashes against the empty jsdom document. Swallow load registrations for the duration of the
// require; only the exported helper is under test.
//
// Restored immediately afterwards, and not left in place: every webview test file shares one jsdom
// window, so a patch that outlived this require would strip the load handler off whichever module
// happened to be required next -- which is how that module's own rendering suite stops rendering.
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

const { warningFocusIdsFor, warningCellCountsFor, applyWarningMarkers } = focustree;

function focusNode(id: string, title: string): HTMLElement {
    const node = document.createElement('div');
    node.id = 'focus_' + id;
    const navigator = document.createElement('div');
    navigator.className = 'navigator';
    navigator.title = title;
    node.appendChild(navigator);
    document.body.appendChild(node);
    return node;
}

function badgeTextOf(node: HTMLElement): string | null {
    const marker = node.querySelector('.' + warningBoxClass);
    return marker?.querySelector('.' + warningBadgeClass)?.textContent ?? null;
}

function gridItem(id: string, gridX: number, gridY: number): GridBoxItem {
    return { id, gridX, gridY, connections: [] };
}

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

describe('webview/focustree warningCellCountsFor', () => {
    it('counts every warned focus sharing a grid slot', () => {
        const counts = warningCellCountsFor([
            gridItem('a', 3, 4),
            gridItem('b', 3, 4),
            gridItem('c', 3, 4),
        ], new Set(['a', 'b', 'c']));
        assert.deepStrictEqual(counts, { a: 3, b: 3, c: 3 });
    });

    it('ignores unwarned focuses sharing the slot', () => {
        const counts = warningCellCountsFor([
            gridItem('a', 1, 1),
            gridItem('shared', 1, 1),
        ], new Set(['a']));
        assert.deepStrictEqual(counts, { a: 1 });
    });

    it('keeps focuses on distinct slots at one', () => {
        const counts = warningCellCountsFor([
            gridItem('a', 0, 0),
            gridItem('b', 1, 0),
            gridItem('c', 0, 1),
        ], new Set(['a', 'b', 'c']));
        assert.deepStrictEqual(counts, { a: 1, b: 1, c: 1 });
    });

    it('omits warned focuses that are not rendered', () => {
        const counts = warningCellCountsFor([gridItem('a', 0, 0)], new Set(['a', 'hidden']));
        assert.deepStrictEqual(counts, { a: 1 });
    });

    it('returns nothing when no focus is warned', () => {
        assert.deepStrictEqual(warningCellCountsFor([gridItem('a', 0, 0)], new Set()), {});
    });
});

describe('webview/focustree applyWarningMarkers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('gives every focus named by a warning a marker and a hover explanation', () => {
        const a = focusNode('a', 'a\n(0, 0)');
        const b = focusNode('b', 'b\n(1, 0)');
        applyWarningMarkers(
            treeWithWarnings([
                { text: 'Prerequisite b of focus a is not positioned above it.', source: 'a', relatedSources: ['b'] },
            ]),
            [gridItem('a', 0, 0), gridItem('b', 1, 0)],
        );

        // Both ends of the pair are marked, not only the focus the warning is filed under.
        assert.strictEqual(badgeTextOf(a), '⚠');
        assert.strictEqual(badgeTextOf(b), '⚠');
        for (const node of [a, b]) {
            const title = (node.querySelector('.navigator') as HTMLElement).title;
            assert.ok(title.startsWith(node.id.replace('focus_', '')));
            assert.ok(title.includes('⚠ Prerequisite b of focus a is not positioned above it.'));
        }
    });

    it('shows how many focuses are stacked on the same slot', () => {
        const a = focusNode('a', 'a\n(2, 3)');
        const b = focusNode('b', 'b\n(2, 3)');
        applyWarningMarkers(
            treeWithWarnings([{ text: 'Focuses a, b share the same position.', source: 'a', relatedSources: ['b'] }]),
            [gridItem('a', 2, 3), gridItem('b', 2, 3)],
        );

        assert.strictEqual(badgeTextOf(a), '⚠×2');
        assert.strictEqual(badgeTextOf(b), '⚠×2');
    });

    it('leaves focuses without a warning alone', () => {
        const a = focusNode('a', 'a\n(0, 0)');
        const clean = focusNode('clean', 'clean\n(5, 5)');
        applyWarningMarkers(
            treeWithWarnings([{ text: 'something', source: 'a' }]),
            [gridItem('a', 0, 0), gridItem('clean', 5, 5)],
        );

        assert.ok(a.querySelector('.' + warningBoxClass));
        assert.strictEqual(clean.querySelector('.' + warningBoxClass), null);
        assert.strictEqual((clean.querySelector('.navigator') as HTMLElement).title, 'clean\n(5, 5)');
    });

    it('marks nothing when the tree has no warnings', () => {
        const a = focusNode('a', 'a\n(0, 0)');
        applyWarningMarkers(treeWithWarnings([]), [gridItem('a', 0, 0)]);
        assert.strictEqual(a.querySelector('.' + warningBoxClass), null);
    });

    it('skips a warned focus that is not currently rendered', () => {
        applyWarningMarkers(treeWithWarnings([{ text: 'hidden branch', source: 'gone' }]), []);
        assert.strictEqual(document.querySelector('.' + warningBoxClass), null);
    });
});
