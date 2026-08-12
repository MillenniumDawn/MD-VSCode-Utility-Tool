import * as assert from "assert";
import { renderSprite, renderBackground, renderCorneredTileSprite } from "../util/hoi4gui/nodecommon";
import { StyleTable } from "../util/styletable";
import { CorneredTileSprite } from "../util/image/sprite";

function st() {
	return new StyleTable();
}

describe("util/hoi4gui/nodecommon", () => {
	describe("renderSprite", () => {
		it("renders sprite with correct position and size", () => {
			const table = st();
			const sprite: any = {
				id: "test",
				width: 32,
				height: 32,
				frames: [{ uri: "file:///a.png", width: 32, height: 32 }],
			};
			renderSprite({ x: 10, y: 20 }, { width: 32, height: 32 }, sprite, 0, 1, {
				styleTable: table,
			});
			assert.ok(table.toRawCss().includes("left: 10px"));
			assert.ok(table.toRawCss().includes("width: 32px"));
			assert.ok(table.toRawCss().includes("background-image"));
		});

		it("falls back to frame 0 when requested frame missing", () => {
			const table = st();
			const sprite: any = {
				id: "test2",
				width: 16,
				height: 16,
				frames: [{ uri: "file:///a.png", width: 16, height: 16 }],
			};
			renderSprite({ x: 0, y: 0 }, { width: 16, height: 16 }, sprite, 5, 1, {
				styleTable: table,
			});
			assert.ok(table.toRawCss().includes("background-image"));
			assert.ok(table.toRawCss().includes("background-size"));
		});

		it("delegates to renderCorneredTileSprite for CorneredTileSprite", () => {
			const table = st();
			const tileSprite: any = {
				id: "corner",
				width: 30,
				height: 30,
				borderSize: { x: 5, y: 5 },
				getTiles: () => Array(9).fill({ uri: "file:///tile.png", width: 10, height: 10 }),
				frames: [{ uri: "file:///corner.png", width: 30, height: 30 }],
			};
			// Make instanceof check pass by setting prototype
			Object.setPrototypeOf(tileSprite, CorneredTileSprite.prototype);
			const html = renderSprite({ x: 0, y: 0 }, { width: 30, height: 30 }, tileSprite, 0, 1, {
				styleTable: table,
			});
			assert.ok(html.includes("corneredtilesprite"));
		});

		it("applies scale", () => {
			const table = st();
			const sprite: any = {
				id: "scaled",
				width: 10,
				height: 10,
				frames: [{ uri: "file:///a.png", width: 10, height: 10 }],
			};
			renderSprite({ x: 0, y: 0 }, { width: 10, height: 10 }, sprite, 0, 2, {
				styleTable: table,
			});
			assert.ok(table.toRawCss().includes("width: 20px"));
		});
	});

	describe("renderCorneredTileSprite", () => {
		it("renders 9 tiles", () => {
			const table = st();
			const sprite: any = {
				id: "ctest",
				width: 30,
				height: 30,
				borderSize: { x: 5, y: 5 },
				getTiles: () => Array(9).fill({ uri: "file:///tile.png", width: 10, height: 10 }),
			};
			Object.setPrototypeOf(sprite, CorneredTileSprite.prototype);
			const html = renderCorneredTileSprite({ x: 0, y: 0 }, { width: 30, height: 30 }, sprite, 0, {
				styleTable: table,
			});
			const divs = (html.match(/<div/g) || []).length;
			assert.ok(divs >= 10); // outer + 9 tiles
		});

		it("handles border larger than size (clamps)", () => {
			const table = st();
			const sprite: any = {
				id: "ctest2",
				width: 10,
				height: 10,
				borderSize: { x: 10, y: 10 },
				getTiles: () => Array(9).fill({ uri: "file:///tile.png", width: 5, height: 5 }),
			};
			Object.setPrototypeOf(sprite, CorneredTileSprite.prototype);
			const html = renderCorneredTileSprite({ x: 0, y: 0 }, { width: 10, height: 10 }, sprite, 0, {
				styleTable: table,
			});
			assert.ok(html.length > 0);
		});
	});

	describe("renderBackground", () => {
		it("returns empty when background undefined", async () => {
			const html = await renderBackground(undefined, { size: { width: 100, height: 100 }, orientation: "upper_left" }, { styleTable: st() });
			assert.strictEqual(html, "");
		});

		it("returns empty when sprite not found", async () => {
			const html = await renderBackground(
				{ spritetype: "missing" } as any,
				{ size: { width: 100, height: 100 }, orientation: "upper_left" },
				{ styleTable: st(), getSprite: async () => undefined },
			);
			assert.strictEqual(html, "");
		});

		it("renders background sprite when found", async () => {
			const table = st();
			const fakeSprite: any = {
				id: "bg",
				width: 100,
				height: 100,
				frames: [{ uri: "file:///bg.png", width: 100, height: 100 }],
			};
			const html = await renderBackground(
				{ spritetype: "bg_sprite" } as any,
				{ size: { width: 200, height: 200 }, orientation: "upper_left" },
				{ styleTable: table, getSprite: async () => fakeSprite },
			);
			assert.ok(html.length > 0);
			assert.ok(html.includes("st-"));
		});
	});
});
