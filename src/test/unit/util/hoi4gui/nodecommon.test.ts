import * as assert from "assert";
import { toNumberLike } from "../../../../hoiformat/schema";
import { placeSprite, renderCorneredTileSprite, RenderNodeCommonOptions } from "../../../../util/hoi4gui/nodecommon";
import { CorneredTileSprite, Image, Sprite } from "../../../../util/image/sprite";
import { StyleTable } from "../../../../util/styletable";
import { PNG } from "pngjs";
import type * as vscode from "vscode";
import { parseHoi4File } from "../../../../hoiformat/hoiparser";
import { getSpriteTypes } from "../../../../hoiformat/spritetype";

const parent = { size: { width: 1920, height: 1080 }, orientation: "upper_left" as const };
const sprite = { width: 40, height: 30 } as Sprite;

function node(fields: Record<string, unknown>) {
	return {
		name: "n",
		position: { x: toNumberLike(100), y: toNumberLike(60) },
		spritetype: "s",
		...fields,
	} as never;
}

function options(getSprite?: RenderNodeCommonOptions["getSprite"]): RenderNodeCommonOptions {
	return { styleTable: new StyleTable(), getSprite };
}

describe("util/hoi4gui/nodecommon placeSprite", () => {
	it("puts the sprite's corner on the position", async () => {
		const placed = await placeSprite(node({}), parent, options(async () => sprite));

		assert.deepStrictEqual(placed, { image: sprite, x: 100, y: 60, scale: 1 });
	});

	it("puts the sprite's middle on the position with centerposition", async () => {
		const placed = await placeSprite(node({ centerposition: true }), parent, options(async () => sprite));

		assert.deepStrictEqual(placed, { image: sprite, x: 80, y: 45, scale: 1 });
	});

	it("passes the node's scale through", async () => {
		const placed = await placeSprite(node({ scale: 2 }), parent, options(async () => sprite));

		assert.strictEqual(placed?.scale, 2);
	});

	it("asks for spritetype before quadtexturesprite, as an icon, under the node's name", async () => {
		const asked: unknown[][] = [];

		await placeSprite(
			node({ spritetype: "first", quadtexturesprite: "second" }),
			parent,
			options(async (...args) => {
				asked.push(args);
				return sprite;
			}),
		);

		assert.deepStrictEqual(asked, [["first", "icon", "n"]]);
	});

	it("falls back to quadtexturesprite", async () => {
		const asked: string[] = [];

		await placeSprite(
			node({ spritetype: undefined, quadtexturesprite: "quad" }),
			parent,
			options(async (name) => {
				asked.push(name);
				return sprite;
			}),
		);

		assert.deepStrictEqual(asked, ["quad"]);
	});

	it("places nothing when no sprite resolves, none is named, or there is no way to look one up", async () => {
		assert.strictEqual(await placeSprite(node({}), parent, options(async () => undefined)), undefined);
		assert.strictEqual(
			await placeSprite(node({ spritetype: undefined }), parent, options(async () => sprite)),
			undefined,
		);
		assert.strictEqual(await placeSprite(node({}), parent, options()), undefined);
	});
});

describe("cornered tile borders from gfx", () => {
	it("cuts and renders a malformed border consistently", () => {
		const [definition] = getSpriteTypes(parseHoi4File(`spriteTypes = {
			corneredTileSpriteType = { name = "GFX_test" texturefile = "gfx/test.png"
				size = { x = 8 y = 6 } borderSize = { x = -2 y = 1.8 } }
		}`));
		assert.ok(definition && "bordersize" in definition);
		const png = new PNG({ width: 8, height: 6 });
		png.data.fill(255);
		const image = new Image(PNG.sync.write(png), 8, 6, { path: "/gfx/test.png" } as vscode.Uri);
		const tile = new CorneredTileSprite(definition.name, image, definition.noofframes, definition.size, definition.bordersize);
		const tiles = tile.getTiles();
		assert.deepStrictEqual(tile.borderSize, { x: 0, y: 1 });
		assert.deepStrictEqual(tiles.map(t => [t.width, t.height]), [
			[0, 1], [8, 1], [0, 1], [0, 4], [8, 4], [0, 4], [0, 1], [8, 1], [0, 1],
		]);
		const table = new StyleTable();
		const html = renderCorneredTileSprite({ x: 0, y: 0 }, { width: 8, height: 6 }, tile, 0, { styleTable: table });
		assert.strictEqual((html.match(/<div/g) ?? []).length, 4);
		assert.match(table.toRawCss(), /background-size: 8px 1px/);
		assert.doesNotMatch(table.toRawCss(), /NaN|Infinity|-[0-9]+px/);
	});

	it("preserves valid destination borders when source or destination is smaller", () => {
		const png = new PNG({ width: 16, height: 16 });
		png.data.fill(255);
		const image = new Image(PNG.sync.write(png), 16, 16, { path: "/gfx/test.png" } as vscode.Uri);
		for (const [border, target, rendered, source] of [[16, 100, 16, 7], [2, 3, 1.5, 2], [2, 100, 2, 2]] as const) {
			const tile = new CorneredTileSprite("s", image, 1, { x: 16, y: 16 }, { x: border, y: border });
			const table = new StyleTable();
			renderCorneredTileSprite({ x: 0, y: 0 }, { width: target, height: target }, tile, 0, { styleTable: table });
			const css = table.toRawCss();
			assert.ok(css.includes(`width: ${rendered}px;`));
			assert.ok(css.includes(`height: ${rendered}px;`));
			assert.ok(css.includes(`background-size: ${source}px ${source}px;`));
		}
	});
});
