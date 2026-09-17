import * as assert from "assert";
import * as vscode from "vscode";
import { PNG } from "pngjs";
import { Image, Sprite, CorneredTileSprite } from "../util/image/sprite";

function makeImage(width: number, height: number): Image {
	const png = new PNG({ width, height });
	png.data.fill(0x7f);
	return new Image(
		PNG.sync.write(png),
		width,
		height,
		vscode.Uri.file("gfx/interface/test.png"),
	);
}

function sum(images: Image[]): number {
	return images.reduce((total, image) => total + image.pngBuffer.length, 0);
}

describe("util/image/sprite retainedBytes", () => {
	it("weighs an image by its buffer until the data URI is materialized", () => {
		const image = makeImage(4, 4);
		assert.strictEqual(image.retainedBytes, image.pngBuffer.length);

		const uri = image.uri;
		assert.strictEqual(
			image.retainedBytes,
			image.pngBuffer.length + uri.length,
		);
		// Memoized: reading it again does not grow the weight.
		assert.strictEqual(image.uri, uri);
		assert.strictEqual(
			image.retainedBytes,
			image.pngBuffer.length + uri.length,
		);
	});

	it("does not count a single-frame sprite's image twice", () => {
		const image = makeImage(4, 4);
		const sprite = new Sprite("s", image, 1);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes);

		assert.strictEqual(sprite.frames[0], image);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes);
	});

	it("adds the split frames and their URIs to a multi-frame sprite", () => {
		const image = makeImage(8, 4);
		const sprite = new Sprite("s", image, 2);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes);

		const frames = sprite.frames;
		assert.strictEqual(frames.length, 2);
		assert.strictEqual(
			sprite.retainedBytes,
			image.retainedBytes + sum(frames),
		);

		const frame = frames[1]!;
		const uri = frame.uri;
		assert.strictEqual(
			sprite.retainedBytes,
			image.retainedBytes + sum(frames) + uri.length,
		);
	});

	it("adds the nine tiles of a cornered tile sprite once they are cut", () => {
		const image = makeImage(12, 12);
		const sprite = new CorneredTileSprite(
			"s",
			image,
			1,
			{ x: 12, y: 12 },
			{ x: 2, y: 2 },
		);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes);

		const tiles = sprite.getTiles();
		assert.strictEqual(tiles.length, 9);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes + sum(tiles));

		// Cached: asking again does not add a second set.
		assert.strictEqual(sprite.getTiles(), tiles);
		assert.strictEqual(sprite.retainedBytes, image.retainedBytes + sum(tiles));
	});
});
