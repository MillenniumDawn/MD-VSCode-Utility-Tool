import * as assert from "assert";
import { renderInstantTextBox } from "../util/hoi4gui/instanttextbox";
import { StyleTable } from "../util/styletable";
import { toNumberLike } from "../hoiformat/schema";

function st() {
	return new StyleTable();
}
function parent() {
	return {
		size: { width: 1920, height: 1080 },
		orientation: "upper_left" as const,
	};
}

describe("util/hoi4gui/instanttextbox", () => {
	it("renders textbox with position and size from maxwidth/maxheight", async () => {
		const table = st();
		const tb: any = {
			position: { x: toNumberLike(10), y: toNumberLike(20) },
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			text: "Hello",
			_token: { start: 0, end: 5 },
		};
		const html = await renderInstantTextBox(tb, parent(), {
			styleTable: table,
		});
		assert.ok(html.includes('start="0"'));
		assert.ok(table.toRawCss().includes("left: 10px"));
		assert.ok(table.toRawCss().includes("width: 100px"));
		assert.ok(html.includes("Hello"));
	});

	it("escapes html in text", async () => {
		const tb: any = {
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			text: "<b>hi</b>",
			_token: { start: 0, end: 1 },
		};
		const html = await renderInstantTextBox(tb, parent(), { styleTable: st() });
		assert.ok(html.includes("&lt;b&gt;"));
		assert.ok(!html.includes("<b>hi</b>"));
	});

	it("handles centre vs center format normalization", async () => {
		const tb: any = {
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			text: "hi",
			format: { _name: "centre" },
			_token: { start: 0, end: 1 },
		};
		const table = st();
		await renderInstantTextBox(tb, parent(), { styleTable: table });
		assert.ok(table.toRawCss().includes("text-align: center"));
	});

	it("applies bordersize padding", async () => {
		const tb: any = {
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			text: "hi",
			bordersize: { x: toNumberLike(5), y: toNumberLike(10) },
			_token: { start: 0, end: 1 },
		};
		const table = st();
		await renderInstantTextBox(tb, parent(), { styleTable: table });
		assert.ok(table.toRawCss().includes("padding: 10px 5px"));
	});

	it("renders empty when text missing", async () => {
		const tb: any = {
			maxwidth: toNumberLike(100),
			maxheight: toNumberLike(50),
			_token: { start: 0, end: 1 },
		};
		const html = await renderInstantTextBox(tb, parent(), { styleTable: st() });
		assert.ok(html.includes('start="0"'));
		// empty text renders as empty or single space
		assert.ok(html.length > 0);
	});
});
