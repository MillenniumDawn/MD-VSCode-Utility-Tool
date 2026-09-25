/// <reference types="mocha" />
import * as assert from "assert";
import {
	gridBoxContentOffset,
	renderGridBoxCommon,
	renderGridBoxConnection,
	renderLineConnections,
} from "../util/hoi4gui/gridboxcommon";
import { StyleTable } from "../util/styletable";
import { toNumberLike } from "../hoiformat/schema";

function makeStyleTable(): StyleTable {
	return new StyleTable();
}

describe("util/hoi4gui/gridboxcommon", () => {
	describe("renderGridBoxConnection", () => {
		it("renders horizontal line when y equal", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 0, y: 10 },
				{ x: 100, y: 10 },
				"1px solid red",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1.5,
				"a",
				"b",
			);
			assert.ok(html.includes('data-conn-from="a"'));
			assert.ok(st.toRawCss().includes("border-top: 1px solid red"));
			assert.ok(html.includes('style="left: 0px; top: 10px; width: 100px; height: 1px;"'));
		});

		it("renders vertical line when x equal", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 10, y: 0 },
				{ x: 10, y: 100 },
				"2px dashed blue",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1.5,
			);
			assert.ok(html.includes('data-conn-type="child"'));
			assert.ok(st.toRawCss().includes("border-left: 2px dashed blue"));
			assert.ok(html.includes('style="left: 10px; top: 0px; width: 1px; height: 100px;"'));
		});

		it("keeps geometry out of the stylesheet and shares one border rule between lines", () => {
			const st = makeStyleTable();
			const first = renderGridBoxConnection(
				{ x: 0, y: 10 },
				{ x: 100, y: 10 },
				"1px solid red",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1.5,
			);
			const second = renderGridBoxConnection(
				{ x: 0, y: 60 },
				{ x: 40, y: 60 },
				"1px solid red",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1.5,
			);
			const css = st.toRawCss();
			assert.strictEqual((css.match(/border-top: 1px solid red/g) || []).length, 1);
			assert.ok(!css.includes("left:"));
			assert.ok(!css.includes("gridbox-connection-0"));
			const borderClass = /st-gridbox-connection-[\w]+/.exec(first)?.[0];
			assert.ok(borderClass);
			assert.ok(second.includes(borderClass!));
			assert.ok(second.includes('style="left: 0px; top: 60px; width: 40px; height: 1px;"'));
		});

		it("swaps parent geometry but keeps parent type label", () => {
			const stParent = makeStyleTable();
			const stChild = new StyleTable();
			const a = { x: 0, y: 0 };
			const b = { x: 100, y: 100 };
			const parent = renderGridBoxConnection(
				a,
				b,
				"1px solid green",
				"parent",
				"up",
				{ width: 50, height: 50 },
				undefined,
				stParent,
				1,
			);
			const child = renderGridBoxConnection(
				b,
				a,
				"1px solid green",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				stChild,
				1,
			);
			assert.ok(parent.includes('data-conn-type="parent"'));
			assert.ok(child.includes('data-conn-type="child"'));
			assert.strictEqual(stParent.toRawCss(), stChild.toRawCss());
		});

		it("renders L-shaped connection for diagonal in up format", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 0, y: 0 },
				{ x: 100, y: 100 },
				"1px solid black",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1,
			);
			const divs = (html.match(/<div/g) || []).length;
			assert.strictEqual(divs, 2);
			assert.ok(html.includes('data-conn-type="child"'));
			assert.ok(st.toRawCss().includes("border"));
		});

		it("handles left format with two segments", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 0, y: 0 },
				{ x: 50, y: 80 },
				"1px solid black",
				"child",
				"left",
				{ width: 50, height: 50 },
				undefined,
				st,
				1,
			);
			assert.ok(html.includes("data-conn-from"));
			assert.ok(st.toRawCss().includes("border"));
		});

		it("escapes quotes in style", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 0, y: 10 },
				{ x: 10, y: 10 },
				'1px solid \"red\"',
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1,
			);
			assert.ok(html.includes("&quot;"));
		});
	});

	describe("renderLineConnections", () => {
		it("skips missing target", () => {
			const st = makeStyleTable();
			const items: any = {
				a: {
					id: "a",
					gridX: 0,
					gridY: 0,
					connections: [
						{
							target: "missing",
							targetType: "child",
							style: "1px solid black",
						},
					],
				},
			};
			const html = renderLineConnections(
				items,
				"up",
				{ width: 50, height: 50 },
				{ width: 200, height: 200 },
				st,
				1,
			);
			assert.strictEqual(html, "");
		});

		it("renders connection for existing target", () => {
			const st = makeStyleTable();
			const items: any = {
				a: {
					id: "a",
					gridX: 0,
					gridY: 0,
					connections: [
						{ target: "b", targetType: "child", style: "1px solid black" },
					],
				},
				b: { id: "b", gridX: 1, gridY: 0, connections: [] },
			};
			const html = renderLineConnections(
				items,
				"up",
				{ width: 50, height: 50 },
				{ width: 200, height: 200 },
				st,
				1,
			);
			assert.ok(html.includes('data-conn-from="a"'));
			assert.ok(html.includes('data-conn-to="b"'));
		});

		it("moves the ends of a parent connection by the connection offsets", () => {
			const items: any = {
				child: {
					id: "child",
					gridX: 0,
					gridY: 1,
					connections: [{ target: "parent", targetType: "parent", style: "1px solid black" }],
				},
				parent: { id: "parent", gridX: 0, gridY: 0, connections: [] },
			};
			const plain = renderLineConnections(items, "up", { width: 50, height: 50 }, { width: 50, height: 200 }, makeStyleTable(), 1);
			assert.ok(plain.includes("left: 25px; top: 25px; width: 1px; height: 50px;"));
			const moved = renderLineConnections(
				items,
				"up",
				{ width: 50, height: 50 },
				{ width: 50, height: 200 },
				makeStyleTable(),
				1,
				{ parent: { x: 0, y: 10 }, child: { x: 0, y: -5 } },
			);
			assert.ok(moved.includes("left: 25px; top: 35px; width: 1px; height: 35px;"));
		});

		it("returns empty for no items", () => {
			const st = makeStyleTable();
			const html = renderLineConnections(
				{},
				"up",
				{ width: 50, height: 50 },
				{ width: 200, height: 200 },
				st,
				1,
			);
			assert.strictEqual(html, "");
		});
	});

	describe("gridBoxContentOffset", () => {
		// The focus tree's grid: one 96x130 slot wide and of no height.
		const slot = { width: 96, height: 130 };
		const grid = { width: 96, height: 0 };
		const items = [
			{ gridX: 0, gridY: 0 },
			{ gridX: 1, gridY: 2 },
			{ gridX: -1, gridY: 1 },
		];

		it("reaches past the grid corner by the extent each format lays out towards", () => {
			assert.deepStrictEqual(gridBoxContentOffset(items, "up", slot, grid), { x: -96, y: 0 });
			assert.deepStrictEqual(gridBoxContentOffset(items, "down", slot, grid), { x: -96, y: -390 });
			assert.deepStrictEqual(gridBoxContentOffset(items, "left", slot, grid), { x: 0, y: -195 });
			assert.deepStrictEqual(gridBoxContentOffset(items, "right", slot, grid), { x: -192, y: -195 });
		});

		it("is zero when every item is inside the grid", () => {
			assert.deepStrictEqual(gridBoxContentOffset([{ gridX: 2, gridY: 3 }], "up", slot, grid), { x: 0, y: 0 });
			assert.deepStrictEqual(gridBoxContentOffset([], "down", slot, grid), { x: 0, y: 0 });
		});
	});

	describe("renderGridBoxCommon", () => {
		it("renders gridbox with items and line connections", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(0), y: toNumberLike(0) },
				size: { width: toNumberLike(200), height: toNumberLike(200) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
				format: { _name: "up" },
				_token: { start: 0, end: 10 },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				items: {
					a: {
						id: "a",
						gridX: 0,
						gridY: 0,
						connections: [
							{ target: "b", targetType: "child", style: "1px solid black" },
						],
					},
					b: { id: "b", gridX: 1, gridY: 0, connections: [] },
				},
			});
			assert.ok(html.includes('data-gridbox-item="a"'));
			assert.ok(html.includes('data-gridbox-item="b"'));
			assert.ok(html.includes('data-conn-from="a"'));
		});

		it("positions each item through its style attribute, not a one-off rule", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(0), y: toNumberLike(0) },
				size: { width: toNumberLike(200), height: toNumberLike(200) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
				format: { _name: "up" },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				items: {
					a: { id: "a", gridX: 1, gridY: 2, connections: [] },
				},
			});
			assert.ok(/data-gridbox-item="a"[^>]*style="left: 125px; top: 100px; width: 50px; height: 50px;"/.test(html));
			assert.ok(!st.toRawCss().includes("gridbox-item"));
		});

		it("renders empty gridbox at exact position", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(10), y: toNumberLike(10) },
				size: { width: toNumberLike(100), height: toNumberLike(100) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
				_token: { start: 0, end: 5 },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				items: {},
			});
			assert.ok(html.includes('start="0"'));
			assert.ok(st.toRawCss().includes("left: 10px"));
			assert.ok(st.toRawCss().includes("width: 100px"));
		});

		it("supports control lineRenderMode", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(0), y: toNumberLike(0) },
				size: { width: toNumberLike(200), height: toNumberLike(200) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
				format: { _name: "up" },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				items: {
					a: {
						id: "a",
						gridX: 0,
						gridY: 0,
						connections: [
							{ target: "b", targetType: "child", style: "1px solid black" },
						],
					},
					b: { id: "b", gridX: 2, gridY: 2, connections: [] },
				},
				lineRenderMode: "control",
				onRenderLineBox: async () => "<span>box</span>",
			});
			assert.ok(html.includes("data-cell-x="));
			assert.ok(/data-cell-x="0"[^>]*style="left: \d+px; top: 0px; width: 50px; height: 50px;"/.test(html));
			assert.ok(!st.toRawCss().includes("gridbox-connection"));
		});

		it("escapes ids containing a quote", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(0), y: toNumberLike(0) },
				size: { width: toNumberLike(200), height: toNumberLike(200) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
				format: { _name: "up" },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			const evilId = 'a" onclick="alert(1)';
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				id: evilId,
				items: {
					[evilId]: {
						id: evilId,
						htmlId: "focus_" + evilId,
						gridX: 0,
						gridY: 0,
						connections: [
							{ target: "b", targetType: "child", style: "1px solid black" },
						],
					},
					b: { id: "b", gridX: 1, gridY: 0, connections: [] },
				},
			});
			assert.ok(!html.includes('onclick="alert(1)"'));
			assert.ok(html.includes('data-gridbox-item="a&quot; onclick=&quot;alert(1)"'));
			assert.ok(html.includes('id="focus_a&quot; onclick=&quot;alert(1)"'));
			assert.ok(html.includes('data-conn-from="a&quot; onclick=&quot;alert(1)"'));
		});

		it("escapes a quote in a connection target id", () => {
			const st = makeStyleTable();
			const html = renderGridBoxConnection(
				{ x: 0, y: 10 },
				{ x: 100, y: 10 },
				"1px solid red",
				"child",
				"up",
				{ width: 50, height: 50 },
				undefined,
				st,
				1.5,
				"a",
				'b" onclick="alert(1)',
			);
			assert.ok(!html.includes('onclick="alert(1)"'));
			assert.ok(html.includes('data-conn-to="b&quot; onclick=&quot;alert(1)"'));
		});

		it("invokes onRenderItem", async () => {
			const st = makeStyleTable();
			const gridBox: any = {
				position: { x: toNumberLike(0), y: toNumberLike(0) },
				size: { width: toNumberLike(100), height: toNumberLike(100) },
				slotsize: { width: toNumberLike(50), height: toNumberLike(50) },
			};
			const parentInfo = {
				size: { width: 1920, height: 1080 },
				orientation: "upper_left" as const,
			};
			let called = false;
			const html = await renderGridBoxCommon(gridBox, parentInfo, {
				styleTable: st,
				items: { a: { id: "a", gridX: 0, gridY: 0, connections: [] } },
				onRenderItem: async (item) => {
					called = true;
					assert.strictEqual(item.id, "a");
					return "<em>content</em>";
				},
			});
			assert.ok(called);
			assert.ok(html.includes("<em>content</em>"));
		});
	});
});
