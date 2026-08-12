import * as assert from "assert";
import { renderIcon } from "../util/hoi4gui/icon";
import { StyleTable } from "../util/styletable";
import { toNumberLike } from "../hoiformat/schema";

function styleTable(): StyleTable {
	return new StyleTable();
}

function parent() {
	return {
		size: { width: 1920, height: 1080 },
		orientation: "upper_left" as const,
	};
}

describe("util/hoi4gui/icon", () => {
	it("returns empty when no sprite resolves", async () => {
		const icon: any = {
			position: { x: toNumberLike(10), y: toNumberLike(20) },
			size: { width: toNumberLike(100), height: toNumberLike(100) },
			spritetype: "missing_sprite",
			_token: { start: 0, end: 5 },
		};
		const html = await renderIcon(icon, parent(), {
			styleTable: styleTable(),
			getSprite: async () => undefined,
		});
		assert.strictEqual(html, "");
	});

	it("renders sprite when resolved", async () => {
		const table = styleTable();
		const icon: any = {
			position: { x: toNumberLike(10), y: toNumberLike(20) },
			size: { width: toNumberLike(100), height: toNumberLike(100) },
			spritetype: "my_sprite",
			scale: 1,
			_token: { start: 5, end: 10 },
		};
		const fakeImage: any = {
			uri: "file:///fake.png",
			width: 32,
			height: 32,
			frames: [{ x: 0, y: 0, width: 32, height: 32, uri: "file:///fake.png" }],
			width2: 32,
		};
		const fakeSprite: any = {
			width: 32,
			height: 32,
			image: fakeImage,
			frames: fakeImage.frames,
			uri: "file:///fake.png",
		};
		const html = await renderIcon(icon, parent(), {
			styleTable: table,
			getSprite: async () => fakeSprite,
		});
		assert.ok(table.toRawCss().includes("left: 10px"));
		assert.ok(table.toRawCss().includes("width: 32px"));
		assert.ok(html.includes('start="5"'));
	});

	it("applies centerposition offset", async () => {
		const table = styleTable();
		const icon: any = {
			position: { x: toNumberLike(100), y: toNumberLike(100) },
			spritetype: "my_sprite",
			centerposition: toNumberLike(1),
			_token: { start: 0, end: 1 },
		};
		const fakeSprite: any = {
			width: 20,
			height: 20,
			uri: "file:///a.png",
			frames: [{ x: 0, y: 0, width: 20, height: 20, uri: "file:///a.png" }],
		};
		await renderIcon(icon, parent(), {
			styleTable: table,
			getSprite: async () => fakeSprite,
		});
		// 100 - 10 (half width) = 90
		assert.ok(table.toRawCss().includes("left: 90px"));
	});

	it("uses quadtexturesprite fallback", async () => {
		const icon: any = {
			position: { x: toNumberLike(0), y: toNumberLike(0) },
			quadtexturesprite: "quad_sprite",
			_token: { start: 0, end: 1 },
		};
		let calledWith: string | undefined;
		const fakeSprite: any = {
			width: 10,
			height: 10,
			uri: "file:///q.png",
			frames: [],
		};
		const html = await renderIcon(icon, parent(), {
			styleTable: styleTable(),
			getSprite: async (name) => {
				calledWith = name;
				return fakeSprite;
			},
		});
		assert.strictEqual(calledWith, "quad_sprite");
		assert.ok(html.length > 0);
	});
});
