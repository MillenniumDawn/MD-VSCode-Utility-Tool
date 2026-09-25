import { loadEntrypoint, resetWebviewState } from './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';
import { setState } from '../../../webviewsrc/util/common';

// focustree.ts reads window.focusTrees at module scope and binds its handlers to window load and
// message. Only the exported helpers are under test, so it is loaded with those listeners held back.
(global as any).window.focusTrees = [];

const { initialShowPoint, scrollToInitialShowPosition } = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

function tree(initialShowPosition: FocusTree['initialShowPosition']): FocusTree {
    return {
        id: 'test_tree',
        focuses: {},
        inlayWindowRefs: [],
        inlayWindows: [],
        inlayConditionExprs: [],
        allowBranchOptions: [],
        conditionExprs: [],
        isSharedFocues: false,
        warnings: [],
        ...(initialShowPosition ? { initialShowPosition } : {}),
    };
}

const origin = { x: 50, y: 50 };
const spacing = { x: 96, y: 130 };
const center = { x: 130, y: 32 };

describe('webview/focustree initial show position', () => {
    it('centres on the grid slot of the x/y form, moved by national_focus_center', () => {
        const point = initialShowPoint(tree({ x: 80, y: 1 }), {}, origin, spacing, center);
        assert.deepStrictEqual(point, { x: 50 + 80 * 96 + 130, y: 50 + 130 + 32 });
    });

    it('centres on where the named focus was resolved, relative_position_id and all', () => {
        const point = initialShowPoint(tree({ focus: 'TST_child', x: 0, y: 0 }), { TST_child: { x: 7, y: 3 } }, origin, spacing, center);
        assert.deepStrictEqual(point, { x: 50 + 7 * 96 + 130, y: 50 + 3 * 130 + 32 });
    });

    it('falls back to the x/y when the named focus was not drawn', () => {
        const point = initialShowPoint(tree({ focus: 'TST_hidden', x: 2, y: 0 }), {}, origin, spacing, center);
        assert.deepStrictEqual(point, { x: 50 + 2 * 96 + 130, y: 50 + 32 });
    });

    it('uses the origin the render shifted for focuses left of zero', () => {
        const shifted = { x: 50 + 3 * 96, y: 50 };
        const point = initialShowPoint(tree({ x: -3, y: 0 }), {}, shifted, spacing, center);
        assert.deepStrictEqual(point, { x: 50 + 130, y: 50 + 32 });
    });

    it('gives nothing without a centre or without an initial_show_position', () => {
        assert.strictEqual(initialShowPoint(tree({ x: 1, y: 1 }), {}, origin, spacing, undefined), undefined);
        assert.strictEqual(initialShowPoint(tree(undefined), {}, origin, spacing, center), undefined);
    });
});

describe('webview/focustree scrollToInitialShowPosition', () => {
    const win = window as any;
    const originalScroll = win.scroll;
    let scrolls: [number, number][];

    beforeEach(() => {
        resetWebviewState();
        document.body.innerHTML = '<div id="focustreeplaceholder"></div>';
        win.gridBox = { slotsize: { height: { _value: 130 } } };
        win.xGridSize = 96;
        win.focusTreeCenter = { x: 130, y: 32 };
        scrolls = [];
        win.scroll = (x: number, y: number) => scrolls.push([x, y]);
    });

    afterEach(() => {
        win.scroll = originalScroll;
        delete win.gridBox;
        delete win.xGridSize;
        delete win.focusTreeCenter;
        document.body.innerHTML = '';
        resetWebviewState();
    });

    // No render has run in this suite, so grid slot (0, 0) sits at the placeholder's top left.
    function expectedScroll(x: number, y: number, scale: number): [number, number] {
        return [Math.max(0, x * scale - window.innerWidth / 2), Math.max(0, y * scale - window.innerHeight / 2)];
    }

    it('scrolls the initial_show_position slot to the middle of the viewport', () => {
        assert.strictEqual(scrollToInitialShowPosition(tree({ x: 80, y: 6 })), true);
        assert.deepStrictEqual(scrolls, [expectedScroll(80 * 96 + 130, 6 * 130 + 32, 1)]);
    });

    it('scales the point by the saved zoom', () => {
        setState({ scale: 0.5 });
        assert.strictEqual(scrollToInitialShowPosition(tree({ x: 80, y: 6 })), true);
        assert.deepStrictEqual(scrolls, [expectedScroll(80 * 96 + 130, 6 * 130 + 32, 0.5)]);
    });

    it('does not scroll when the gui layout declares no centre', () => {
        delete win.focusTreeCenter;
        assert.strictEqual(scrollToInitialShowPosition(tree({ x: 80, y: 6 })), false);
        assert.deepStrictEqual(scrolls, []);
    });

    it('does not scroll without a tree, a grid box or the placeholder', () => {
        assert.strictEqual(scrollToInitialShowPosition(undefined), false);
        document.body.innerHTML = '';
        assert.strictEqual(scrollToInitialShowPosition(tree({ x: 80, y: 6 })), false);
        delete win.gridBox;
        assert.strictEqual(scrollToInitialShowPosition(tree({ x: 80, y: 6 })), false);
        assert.deepStrictEqual(scrolls, []);
    });
});
