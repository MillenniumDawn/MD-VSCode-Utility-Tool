import { loadEntrypoint } from './setup';
import * as assert from 'assert';
import { FocusTree } from '../../previewdef/focustree/schema';

// focustree.ts reads window.focusTrees at module scope and binds its handlers to window load and
// message. Only the exported helpers are under test, so it is loaded with those listeners held back.
(global as any).window.focusTrees = [];

const { initialShowPoint } = loadEntrypoint(
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
