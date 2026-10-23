import * as assert from "assert";
import { toNumberLike } from "../../../../hoiformat/schema";
import { placeSprite, RenderNodeCommonOptions } from "../../../../util/hoi4gui/nodecommon";
import { Sprite } from "../../../../util/image/sprite";
import { StyleTable } from "../../../../util/styletable";

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
