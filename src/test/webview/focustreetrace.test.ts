import './setup';
import * as assert from 'assert';
import { GridBoxItem, renderLineConnections } from '../../util/hoi4gui/gridboxcommon';
import { StyleTable } from '../../util/styletable';
import { traceDimClass, traceLineClass } from '../../previewdef/focustree/tracestyles';

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

const { applyPrerequisiteTrace } = focustree;

function item(id: string, gridX: number, gridY: number, connections: GridBoxItem['connections']): GridBoxItem {
    return { id, gridX, gridY, connections };
}

/**
 * Renders through the real connection renderer rather than hand-written markup, so the test breaks
 * if the data-conn-* attributes the trace selects on ever change shape.
 *
 * Layout: `child` sits one row below `parentA` and `parentB` and lists both as prerequisites, which
 * makes each of those a two-div elbow. `child` is also mutually exclusive with `sibling` on its own
 * row, and `grandchild` below it takes `child` as its prerequisite.
 */
function renderTree(): HTMLElement {
    const items: Record<string, GridBoxItem> = {
        parentA: item('parentA', 0, 0, []),
        parentB: item('parentB', 4, 0, []),
        sibling: item('sibling', 3, 1, []),
        child: item('child', 1, 1, [
            { target: 'parentA', targetType: 'parent', style: '1px solid #88aaff' },
            { target: 'parentB', targetType: 'parent', style: '1px solid #88aaff' },
            { target: 'sibling', targetType: 'related', style: '1px solid red' },
        ]),
        grandchild: item('grandchild', 1, 2, [
            { target: 'child', targetType: 'parent', style: '1px solid #88aaff' },
        ]),
    };

    const root = document.createElement('div');
    root.innerHTML = renderLineConnections(
        items,
        'up',
        { width: 96, height: 130 },
        { width: 0, height: 0 },
        new StyleTable(),
        0.5,
    );
    document.body.appendChild(root);
    return root;
}

function classesOf(root: HTMLElement, from: string, to: string): string[][] {
    const found = root.querySelectorAll(`[data-conn-from="${from}"][data-conn-to="${to}"]`);
    const result: string[][] = [];
    for (let i = 0; i < found.length; i++) {
        const element = found[i] as HTMLElement;
        result.push([traceLineClass, traceDimClass].filter(c => element.classList.contains(c)));
    }
    return result;
}

describe('webview/focustree applyPrerequisiteTrace', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('lights every div of an elbow edge the traced focus owns', () => {
        const root = renderTree();
        applyPrerequisiteTrace(root, 'child');

        for (const parent of ['parentA', 'parentB']) {
            const edge = classesOf(root, 'child', parent);
            // A diagonal prerequisite is drawn as two divs; both halves have to light up or the
            // line reads as broken.
            assert.strictEqual(edge.length, 2, `expected an elbow towards ${parent}`);
            for (const classes of edge) {
                assert.deepStrictEqual(classes, [traceLineClass]);
            }
        }
    });

    it('dims the traced focus mutually exclusive link', () => {
        const root = renderTree();
        applyPrerequisiteTrace(root, 'child');

        const edge = classesOf(root, 'child', 'sibling');
        assert.ok(edge.length > 0);
        for (const classes of edge) {
            assert.deepStrictEqual(classes, [traceDimClass]);
        }
    });

    it('dims edges that only point at the traced focus', () => {
        const root = renderTree();
        applyPrerequisiteTrace(root, 'child');

        // grandchild -> child is grandchild's prerequisite, not child's, so it dims like any other
        // line. Tracing is deliberately one focus's own prerequisites, not its neighbourhood.
        const edge = classesOf(root, 'grandchild', 'child');
        assert.ok(edge.length > 0);
        for (const classes of edge) {
            assert.deepStrictEqual(classes, [traceDimClass]);
        }
    });

    it('leaves nothing behind when the trace is cleared', () => {
        const root = renderTree();
        applyPrerequisiteTrace(root, 'child');
        applyPrerequisiteTrace(root, undefined);

        assert.strictEqual(root.querySelectorAll('.' + traceLineClass).length, 0);
        assert.strictEqual(root.querySelectorAll('.' + traceDimClass).length, 0);
    });

    it('switches cleanly from one traced focus to another', () => {
        const root = renderTree();
        applyPrerequisiteTrace(root, 'child');
        applyPrerequisiteTrace(root, 'grandchild');

        for (const classes of classesOf(root, 'grandchild', 'child')) {
            assert.deepStrictEqual(classes, [traceLineClass]);
        }
        for (const classes of classesOf(root, 'child', 'parentA')) {
            assert.deepStrictEqual(classes, [traceDimClass]);
        }
    });
});
