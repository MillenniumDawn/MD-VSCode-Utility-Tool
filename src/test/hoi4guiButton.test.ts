import * as assert from "assert";
import { renderButton } from "../util/hoi4gui/button";
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

describe("util/hoi4gui/button", () => {
	it("returns empty when sprite missing", async () => {
		const btn: any = {
			spritetype: "missing",
			_token: { start: 0, end: 5 },
		};
		const html = await renderButton(btn, parent(), {
			styleTable: st(),
			getSprite: async () => undefined,
		});
		assert.strictEqual(html, "");
	});

	it("renders button with sprite and text", async () => {
		const table = st();
		const fakeSprite: any = {
			width: 40,
			height: 20,
			frames: [{ uri: "file:///fake.png", width: 40, height: 20 }],
			id: "s1",
		};
		const btn: any = {
			position: { x: toNumberLike(10), y: toNumberLike(20) },
			spritetype: "my_sprite",
			buttontext: "Click me",
			_token: { start: 1, end: 2 },
		};
		const html = await renderButton(btn, parent(), {
			styleTable: table,
			getSprite: async () => fakeSprite,
		});
		assert.ok(html.includes('start="1"'));
		assert.ok(table.toRawCss().includes("left: 10px"));
		assert.ok(table.toRawCss().includes("width: 40px"));
		assert.ok(html.includes("Click me") || html.includes("Click"));
	});

	it("applies centerposition offset", async () => {
		const table = st();
		const fakeSprite: any = {
			width: 20,
			height: 20,
			frames: [{ uri: "file:///a.png", width: 20, height: 20 }],
			id: "s2",
		};
		const btn: any = {
			position: { x: toNumberLike(100), y: toNumberLike(100) },
			spritetype: "my_sprite",
			centerposition: toNumberLike(1),
			_token: { start: 0, end: 1 },
		};
		await renderButton(btn, parent(), {
			styleTable: table,
			getSprite: async () => fakeSprite,
		});
		assert.ok(table.toRawCss().includes("left: 90px"));
	});

	it("uses quadtexturesprite fallback", async () => {
		const table = st();
		const fakeSprite: any = {
			width: 10,
			height: 10,
			frames: [{ uri: "file:///q.png", width: 10, height: 10 }],
			id: "q1",
		};
		let called: string | undefined;
		const btn: any = {
			quadtexturesprite: "quad_sprite",
			_token: { start: 0, end: 1 },
		};
		const html = await renderButton(btn, parent(), {
			styleTable: table,
			getSprite: async (name) => {
				called = name;
				return fakeSprite;
			},
		});
		assert.strictEqual(called, "quad_sprite");
		assert.ok(html.length > 0);
	});
});
