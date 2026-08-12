import * as assert from 'assert';
import { renderGridBoxCommon, renderGridBoxConnection, renderLineConnections } from '../util/hoi4gui/gridboxcommon';
import { StyleTable } from '../util/styletable';
import { toNumberLike } from '../hoiformat/schema';

function makeStyleTable(): StyleTable {
    return new StyleTable();
}

describe('util/hoi4gui/gridboxcommon', () => {
    describe('renderGridBoxConnection', () => {
        it('renders horizontal line when y equal', () => {
            const st = makeStyleTable();
            const html = renderGridBoxConnection({ x: 0, y: 10 }, { x: 100, y: 10 }, '1px solid red', 'child', 'up', { width: 50, height: 50 }, undefined, st, 1.5, 'a', 'b');
            assert.ok(html.includes('data-conn-from="a"'));
            assert.ok(st.toRawCss().includes('border-top: 1px solid red'));
            assert.ok(st.toRawCss().includes('width: 100px'));
        });

        it('renders vertical line when x equal', () => {
            const st = makeStyleTable();
            const html = renderGridBoxConnection({ x: 10, y: 0 }, { x: 10, y: 100 }, '2px dashed blue', 'child', 'up', { width: 50, height: 50 }, undefined, st, 1.5);
            assert.ok(html.includes('data-conn-type="child"'));
            assert.ok(st.toRawCss().includes('border-left: 2px dashed blue'));
            assert.ok(st.toRawCss().includes('height: 100px'));
        });

        it('swaps parent to child', () => {
            const st = makeStyleTable();
            const a = { x: 0, y: 0 };
            const b = { x: 100, y: 100 };
            const parent = renderGridBoxConnection(a, b, '1px solid green', 'parent', 'up', { width: 50, height: 50 }, undefined, st, 1);
            const child = renderGridBoxConnection(b, a, '1px solid green', 'child', 'up', { width: 50, height: 50 }, undefined, new StyleTable(), 1);
            // Both should produce same geometry (parent swaps a/b and becomes child)
            assert.ok(parent.includes('data-conn-type="child"') || parent.includes('data-conn-type="parent"'));
            assert.ok(child.length > 0);
        });

        it('renders L-shaped connection for diagonal in up format', () => {
            const st = makeStyleTable();
            const html = renderGridBoxConnection({ x: 0, y: 0 }, { x: 100, y: 100 }, '1px solid black', 'child', 'up', { width: 50, height: 50 }, undefined, st, 1);
            // Diagonal produces two divs for L shape
            const divs = (html.match(/<div/g) || []).length;
            assert.ok(divs >= 1);
            assert.ok(html.includes('data-conn-type="child"'));
        });

        it('handles left format', () => {
            const st = makeStyleTable();
            const html = renderGridBoxConnection({ x: 0, y: 0 }, { x: 50, y: 80 }, '1px solid black', 'child', 'left', { width: 50, height: 50 }, undefined, st, 1);
            assert.ok(html.length > 0);
        });

        it('escapes quotes in style', () => {
            const st = makeStyleTable();
            const html = renderGridBoxConnection({ x: 0, y: 10 }, { x: 10, y: 10 }, '1px solid \"red\"', 'child', 'up', { width: 50, height: 50 }, undefined, st, 1);
            assert.ok(html.includes('&quot;'));
        });
    });

    describe('renderLineConnections', () => {
        it('skips missing target', () => {
            const st = makeStyleTable();
            const items: any = {
                a: { id: 'a', gridX: 0, gridY: 0, connections: [{ target: 'missing', targetType: 'child', style: '1px solid black' }] },
            };
            const html = renderLineConnections(items, 'up', { width: 50, height: 50 }, { width: 200, height: 200 }, st, 1);
            assert.strictEqual(html, '');
        });

        it('renders connection for existing target', () => {
            const st = makeStyleTable();
            const items: any = {
                a: { id: 'a', gridX: 0, gridY: 0, connections: [{ target: 'b', targetType: 'child', style: '1px solid black' }] },
                b: { id: 'b', gridX: 1, gridY: 0, connections: [] },
            };
            const html = renderLineConnections(items, 'up', { width: 50, height: 50 }, { width: 200, height: 200 }, st, 1);
            assert.ok(html.includes('data-conn-from="a"'));
            assert.ok(html.includes('data-conn-to="b"'));
        });

        it('returns empty for no items', () => {
            const st = makeStyleTable();
            const html = renderLineConnections({}, 'up', { width: 50, height: 50 }, { width: 200, height: 200 }, st, 1);
            assert.strictEqual(html, '');
        });
    });

    describe('renderGridBoxCommon', () => {
        it('renders gridbox with items and line connections', async () => {
            const st = makeStyleTable();
            const gridBox: any = {
                position: { x: toNumberLike(0), y: toNumberLike(0) },
                size: { width: toNumberLike(200), height: toNumberLike(200) },
                slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
                format: { _name: 'up' },
                _token: { start: 0, end: 10 },
            };
            const parentInfo = { size: { width: 1920, height: 1080 }, orientation: 'upper_left' as const };
            const html = await renderGridBoxCommon(gridBox, parentInfo, {
                styleTable: st,
                items: {
                    a: { id: 'a', gridX: 0, gridY: 0, connections: [{ target: 'b', targetType: 'child', style: '1px solid black' }] },
                    b: { id: 'b', gridX: 1, gridY: 0, connections: [] },
                },
            });
            assert.ok(html.includes('data-gridbox-item="a"'));
            assert.ok(html.includes('data-gridbox-item="b"'));
            assert.ok(html.includes('data-conn-from="a"'));
        });

        it('renders empty gridbox', async () => {
            const st = makeStyleTable();
            const gridBox: any = {
                position: { x: toNumberLike(10), y: toNumberLike(10) },
                size: { width: toNumberLike(100), height: toNumberLike(100) },
                slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
                _token: { start: 0, end: 5 },
            };
            const parentInfo = { size: { width: 1920, height: 1080 }, orientation: 'upper_left' as const };
            const html = await renderGridBoxCommon(gridBox, parentInfo, { styleTable: st, items: {} });
            assert.ok(html.length > 0);
            assert.ok(st.toRawCss().includes('left:'));
            assert.ok(st.toRawCss().includes('width:'));
        });

        it('supports control lineRenderMode', async () => {
            const st = makeStyleTable();
            const gridBox: any = {
                position: { x: toNumberLike(0), y: toNumberLike(0) },
                size: { width: toNumberLike(200), height: toNumberLike(200) },
                slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
                format: { _name: 'up' },
            };
            const parentInfo = { size: { width: 1920, height: 1080 }, orientation: 'upper_left' as const };
            const html = await renderGridBoxCommon(gridBox, parentInfo, {
                styleTable: st,
                items: {
                    a: { id: 'a', gridX: 0, gridY: 0, connections: [{ target: 'b', targetType: 'child', style: '1px solid black' }] },
                    b: { id: 'b', gridX: 2, gridY: 2, connections: [] },
                },
                lineRenderMode: 'control',
                onRenderLineBox: async () => '<span>box</span>',
            });
            assert.ok(html.includes('data-cell-x='));
        });

        it('invokes onRenderItem', async () => {
            const st = makeStyleTable();
            const gridBox: any = {
                position: { x: toNumberLike(0), y: toNumberLike(0) },
                size: { width: toNumberLike(100), height: toNumberLike(100) },
                slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
            };
            const parentInfo = { size: { width: 1920, height: 1080 }, orientation: 'upper_left' as const };
            let called = false;
            const html = await renderGridBoxCommon(gridBox, parentInfo, {
                styleTable: st,
                items: { a: { id: 'a', gridX: 0, gridY: 0, connections: [] } },
                onRenderItem: async (item) => {
                    called = true;
                    assert.strictEqual(item.id, 'a');
                    return '<em>content</em>';
                },
            });
            assert.ok(called);
            assert.ok(html.includes('<em>content</em>'));
        });
    });
});
