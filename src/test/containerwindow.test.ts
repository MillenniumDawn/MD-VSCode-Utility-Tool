import * as assert from "assert";
import {
	renderContainerWindow,
	onRenderChildOrDefault,
} from "../util/hoi4gui/containerwindow";
import { StyleTable } from "../util/styletable";
import { toNumberLike } from "../hoiformat/schema";

function st(): StyleTable {
	return new StyleTable();
}

function parent(): {
	size: { width: number; height: number };
	orientation: "upper_left";
} {
	return { size: { width: 1920, height: 1080 }, orientation: "upper_left" };
}

describe("util/hoi4gui/containerwindow", () => {
	it("renders empty containerwindow", async () => {
		const table = st();
		const cw: any = {
			position: { x: toNumberLike(10), y: toNumberLike(20) },
			size: { width: toNumberLike(200), height: toNumberLike(100) },
			containerwindowtype: [],
			windowtype: [],
			gridboxtype: [],
			icontype: [],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
			_token: { start: 0, end: 5 },
		};
		const html = await renderContainerWindow(cw, parent(), {
			styleTable: table,
		});
		assert.ok(html.includes('start="0"'));
		assert.ok(table.toRawCss().includes("left: 10px"));
		assert.ok(table.toRawCss().includes("width: 200px"));
	});

	it("renders nested containerwindow child with correct token order", async () => {
		const child: any = {
			name: "child",
			_index: 0,
			position: { x: toNumberLike(0), y: toNumberLike(0) },
			size: { width: toNumberLike(50), height: toNumberLike(50) },
			containerwindowtype: [],
			windowtype: [],
			gridboxtype: [],
			icontype: [],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
			_token: { start: 10, end: 20 },
		};
		const cw: any = {
			position: { x: toNumberLike(0), y: toNumberLike(0) },
			size: { width: toNumberLike(200), height: toNumberLike(200) },
			containerwindowtype: [child],
			windowtype: [],
			gridboxtype: [],
			icontype: [],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
			_token: { start: 0, end: 30 },
		};
		const html = await renderContainerWindow(cw, parent(), {
			styleTable: st(),
		});
		const parentIdx = html.indexOf('start="0"');
		const childIdx = html.indexOf('start="10"');
		assert.ok(parentIdx !== -1);
		assert.ok(childIdx !== -1);
		assert.ok(parentIdx < childIdx);
	});

	it("honours ignorePosition and noSize", async () => {
		const table = st();
		const cw: any = {
			position: { x: toNumberLike(100), y: toNumberLike(100) },
			size: { width: toNumberLike(200), height: toNumberLike(200) },
			containerwindowtype: [],
			windowtype: [],
			gridboxtype: [],
			icontype: [],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
		};
		await renderContainerWindow(cw, parent(), {
			styleTable: table,
			ignorePosition: true,
			noSize: true,
		});
		assert.ok(table.toRawCss().includes("left: 0px"));
		assert.ok(table.toRawCss().includes("width: 0px"));
	});

	it("handles margin", async () => {
		const table = st();
		const cw: any = {
			position: { x: toNumberLike(0), y: toNumberLike(0) },
			size: { width: toNumberLike(200), height: toNumberLike(200) },
			margin: { top: toNumberLike(10), left: toNumberLike(5) },
			containerwindowtype: [],
			windowtype: [],
			gridboxtype: [],
			icontype: [],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
		};
		await renderContainerWindow(cw, parent(), { styleTable: table });
		assert.ok(table.toRawCss().includes("left: 5px"));
		assert.ok(table.toRawCss().includes("top: 10px"));
	});

	it("onRenderChildOrDefault prefers override", async () => {
		const child: any = { _index: 1, name: "c" };
		const [idx, html] = await onRenderChildOrDefault(
			async () => "override",
			"containerwindow",
			child,
			parent(),
			async () => "default",
		);
		assert.strictEqual(idx, 1);
		assert.strictEqual(html, "override");
	});

	it("onRenderChildOrDefault falls back to default", async () => {
		const child: any = { _index: 2 };
		const [idx, html] = await onRenderChildOrDefault(
			undefined,
			"icon",
			child,
			parent(),
			async () => "fallback",
		);
		assert.strictEqual(idx, 2);
		assert.strictEqual(html, "fallback");
	});

	it("sorts children by _index", async () => {
		const table = st();
		const onRenderChild: any = async (type: string, child: any) => {
			if (type === "icon") {
				return `<i data-idx="${child._index}"></i>`;
			}
			return undefined;
		};
		const cw: any = {
			position: { x: toNumberLike(0), y: toNumberLike(0) },
			size: { width: toNumberLike(100), height: toNumberLike(100) },
			containerwindowtype: [],
			windowtype: [],
			gridboxtype: [],
			icontype: [
				{
					_index: 2,
					spritetype: "a",
					_token: { start: 0, end: 1 },
				} as any,
				{
					_index: 1,
					spritetype: "b",
					_token: { start: 0, end: 1 },
				} as any,
			],
			instanttextboxtype: [],
			textboxtype: [],
			buttontype: [],
			checkboxtype: [],
			guibuttontype: [],
		};
		const html = await renderContainerWindow(cw, parent(), {
			styleTable: table,
			onRenderChild,
		});
		const idx1 = html.indexOf('data-idx="1"');
		const idx2 = html.indexOf('data-idx="2"');
		assert.ok(idx1 !== -1 && idx2 !== -1);
		assert.ok(idx1 < idx2);
	});
});
