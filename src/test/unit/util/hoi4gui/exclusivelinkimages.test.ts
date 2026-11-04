import * as assert from "assert";
import { mock } from "node:test";
import type * as vscode from "vscode";
import { PNG } from "pngjs";
import { defaultExclusiveLinkSprites } from "../../../../util/hoi4gui/exclusivelink";
import { loadExclusiveLinkImages } from "../../../../util/hoi4gui/exclusivelinkimages";
import * as imagecache from "../../../../util/image/imagecache";
import { Image, Sprite } from "../../../../util/image/sprite";

const texturePath = { path: "/gfx/interface/focus_link_exclusive.dds" } as vscode.Uri;

// Each column carries its own x in the red channel, so a frame says where it was cut from.
function columnSprite(id: string, width: number, frames: number): Sprite {
	const png = new PNG({ width, height: 1 });
	for (let x = 0; x < width; x++) {
		png.data[x * 4] = x;
		png.data[x * 4 + 3] = 255;
	}
	return new Sprite(id, new Image(PNG.sync.write(png), width, 1, texturePath), frames);
}

function firstColumn(image: Image): number {
	return PNG.sync.read(image.pngBuffer).data[0]!;
}

describe("util/hoi4gui/exclusivelinkimages", () => {
	afterEach(() => mock.restoreAll());

	it("cuts left, mid and right from one shared strip", async () => {
		const sprites: Record<string, Sprite> = {
			GFX_focus_exclusive_line1: columnSprite("line", 4, 1),
			GFX_focus_link_exclusive: columnSprite("link", 6, 3),
		};
		const lookups = mock.method(imagecache, "getSpriteByGfxName", async (name: string) => sprites[name]);

		const images = await loadExclusiveLinkImages();
		assert.ok(images);
		assert.strictEqual(images.line, sprites.GFX_focus_exclusive_line1!.image);
		assert.deepStrictEqual([images.left, images.mid, images.right].map(firstColumn), [2, 0, 4]);
		assert.strictEqual(lookups.mock.callCount(), 2);
	});

	it("draws no link when the strip has no such frame", async () => {
		mock.method(imagecache, "getSpriteByGfxName", async () => columnSprite("link", 6, 3));
		assert.strictEqual(await loadExclusiveLinkImages({ ...defaultExclusiveLinkSprites, rightFrame: 3 }), undefined);
	});
});
