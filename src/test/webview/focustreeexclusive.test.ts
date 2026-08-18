import './setup';
import * as assert from 'assert';
import { GridBoxItem, GridBoxConnection } from '../../util/hoi4gui/gridboxcommon';
import { exclusiveLinkClass } from '../../previewdef/focustree/exclusivelinkstyles';

// Same reason as focustreewarnings.test.ts: focustree.ts registers a load handler that walks the
// real shell DOM and crashes against the empty jsdom document.
const windowAddEventListener = (global as any).window.addEventListener.bind((global as any).window);
(global as any).window.addEventListener = (type: string, listener: any) => {
	if (type !== "load") {
		windowAddEventListener(type, listener);
	}
};
(global as any).window.focusTrees = [];

const { applyExclusiveLinkStyle } =
    require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree');

function item(id: string, gridX: number, gridY: number, connections: GridBoxConnection[] = []): GridBoxItem {
    return { id, gridX, gridY, connections };
}

function exclusiveTo(target: string): GridBoxConnection {
    return { target, targetType: 'related', style: '1px solid red', classNames: 'inbranch_x' };
}

describe('webview/focustree applyExclusiveLinkStyle', () => {
    it('gives a same row pair the textured link instead of the plain line', () => {
        const a = item('a', 0, 3, [exclusiveTo('b')]);
        applyExclusiveLinkStyle([a, item('b', 2, 3)]);

        const conn = a.connections[0]!;
        assert.strictEqual(conn.style, 'none');
        assert.ok(conn.classNames?.includes(exclusiveLinkClass));
        // The branch visibility classes must survive, or the link stops hiding with its branch.
        assert.ok(conn.classNames?.includes('inbranch_x'));
    });

    it('leaves a pair on different rows on the plain line', () => {
        const a = item('a', 0, 3, [exclusiveTo('b')]);
        applyExclusiveLinkStyle([a, item('b', 2, 4)]);

        const conn = a.connections[0]!;
        assert.strictEqual(conn.style, '1px solid red');
        assert.ok(!conn.classNames?.includes(exclusiveLinkClass));
    });

    it('leaves a link to a focus that is not rendered alone', () => {
        const a = item('a', 0, 3, [exclusiveTo('hidden')]);
        applyExclusiveLinkStyle([a]);

        assert.strictEqual(a.connections[0]!.style, '1px solid red');
    });

    it('draws a mutual pair once instead of twice on top of itself', () => {
        const a = item('a', 0, 3, [exclusiveTo('b')]);
        const b = item('b', 2, 3, [exclusiveTo('a')]);
        applyExclusiveLinkStyle([a, b]);

        assert.strictEqual(a.connections.length + b.connections.length, 1);
        const conn = (a.connections[0] ?? b.connections[0])!;
        assert.ok(conn.classNames?.includes(exclusiveLinkClass));
    });

    it('does not touch prerequisite connections', () => {
        const a = item('a', 0, 3, [{ target: 'b', targetType: 'parent', style: '1px solid #88aaff' }]);
        applyExclusiveLinkStyle([a, item('b', 2, 3)]);

        const conn = a.connections[0]!;
        assert.strictEqual(conn.style, '1px solid #88aaff');
        assert.strictEqual(conn.classNames, undefined);
    });
});
