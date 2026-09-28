import * as assert from "assert";
import { renderStandaloneWindow } from "../util/hoi4gui/window";
import { StyleTable } from "../util/styletable";
import { toNumberLike } from "../hoiformat/schema";

function windowAt(x?: number, y?: number): any {
	return {
		name: "test_window",
		position: x === undefined || y === undefined ? undefined : { x: toNumberLike(x), y: toNumberLike(y) },
		size: { width: toNumberLike(400), height: toNumberLike(200) },
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
}

describe("util/hoi4gui/window", () => {
	it("sizes a window at a positive offset to include that offset", async () => {
		const rendered = await renderStandaloneWindow(windowAt(300, 50), new StyleTable(), []);
		assert.strictEqual(rendered.width, 700);
		assert.strictEqual(rendered.height, 250);
	});

	it("sizes a window without a position to its own size", async () => {
		const rendered = await renderStandaloneWindow(windowAt(), new StyleTable(), []);
		assert.strictEqual(rendered.width, 400);
		assert.strictEqual(rendered.height, 200);
	});

	it("clamps a window at a negative offset to the origin", async () => {
		const rendered = await renderStandaloneWindow(windowAt(-50, -20), new StyleTable(), []);
		assert.strictEqual(rendered.width, 400);
		assert.strictEqual(rendered.height, 200);
	});

	it("draws what onRenderChild returns in place of a child, and the default for the rest", async () => {
		const window = windowAt();
		window.icontype = [
			{ name: "slot", _index: 0, _token: { start: 10, end: 12 } },
			{ name: "plain", _index: 1, _token: { start: 13, end: 15 } },
		];
		const seen: string[] = [];
		const rendered = await renderStandaloneWindow(window, new StyleTable(), [], {
			onRenderChild: async (type, child) => {
				seen.push(`${type}:${child.name}`);
				return child.name === "slot" ? "<i>slot</i>" : undefined;
			},
		});
		assert.deepStrictEqual(seen.sort(), ["icon:plain", "icon:slot"]);
		assert.ok(rendered.html.includes("<i>slot</i>"));
	});

	it("names the .gui file on every element that carries offsets into it", async () => {
		const rendered = await renderStandaloneWindow(windowAt(), new StyleTable(), [], { file: "interface/a.gui" });
		assert.ok(/file="interface\/a\.gui" start="0"/.test(rendered.html));
	});
});
