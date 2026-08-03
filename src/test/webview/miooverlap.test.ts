import './setup';
import * as assert from 'assert';
import { GridBoxItem } from '../../util/hoi4gui/gridboxcommon';

// miopreview.ts reads window.mios at module scope, so it has to exist before the import runs.
(global as any).window.mios = [];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findOverlaps } = require('../../../webviewsrc/miopreview') as typeof import('../../../webviewsrc/miopreview');

function item(id: string, gridX: number, gridY: number): GridBoxItem {
    return { id, gridX, gridY, connections: [] };
}

describe('webview/miopreview findOverlaps', () => {
    it('returns nothing when every trait has its own slot', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 0, 0), item('b', 1, 0), item('c', 0, 1)]), []);
    });

    it('reports a cell holding two traits', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 3, 2), item('b', 3, 2)]), [{ x: 3, y: 2, count: 2 }]);
    });

    it('counts every trait stacked on the same cell', () => {
        assert.deepStrictEqual(
            findOverlaps([item('a', 1, 1), item('b', 1, 1), item('c', 1, 1)]),
            [{ x: 1, y: 1, count: 3 }]);
    });

    it('reports each colliding cell separately and leaves clean cells out', () => {
        const overlaps = findOverlaps([
            item('a', 0, 0), item('b', 0, 0),
            item('c', 2, 0),
            item('d', 4, 5), item('e', 4, 5),
        ]);

        assert.deepStrictEqual(overlaps, [{ x: 0, y: 0, count: 2 }, { x: 4, y: 5, count: 2 }]);
    });

    it('does not confuse a shared x or a shared y with a collision', () => {
        assert.deepStrictEqual(findOverlaps([item('a', 2, 0), item('b', 2, 1), item('c', 3, 1)]), []);
    });

    it('handles negative columns, which the preview supports', () => {
        assert.deepStrictEqual(findOverlaps([item('a', -1, 0), item('b', -1, 0)]), [{ x: -1, y: 0, count: 2 }]);
    });

    it('returns nothing for an empty tree', () => {
        assert.deepStrictEqual(findOverlaps([]), []);
    });
});
