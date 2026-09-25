import * as assert from "assert";
import * as vscode from "vscode";
import { PNG } from "pngjs";
import {
	Image,
	Sprite,
	CorneredTileSprite,
	effectiveFrameCount,
} from "../util/image/sprite";

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

describe("util/image/sprite frames", () => {
	// Each column carries its own x in the red channel, so a frame's pixels say where they came from.
	function makeColumnImage(width: number, height: number): Image {
		const png = new PNG({ width, height });
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				png.data[idx] = x;
				png.data[idx + 1] = 0;
				png.data[idx + 2] = 0;
				png.data[idx + 3] = 255;
			}
		}
		return new Image(
			PNG.sync.write(png),
			width,
			height,
			vscode.Uri.file("gfx/interface/test.png"),
		);
	}

	function columns(image: Image): number[] {
		const png = PNG.sync.read(image.pngBuffer);
		const result: number[] = [];
		for (let x = 0; x < png.width; x++) {
			result.push(png.data[x * 4]!);
		}
		return result;
	}

	it("floors the frame width when the texture does not divide evenly", () => {
		const sprite = new Sprite("s", makeColumnImage(10, 2), 3);
		assert.strictEqual(sprite.width, 3);

		const frames = sprite.frames;
		assert.strictEqual(frames.length, 3);
		assert.deepStrictEqual(frames.map((frame) => frame.width), [3, 3, 3]);
		assert.deepStrictEqual(columns(frames[1]!), [3, 4, 5]);
		assert.deepStrictEqual(columns(frames[2]!), [6, 7, 8]);
	});

	it("treats noofframes = 0 as a single frame", () => {
		const image = makeColumnImage(4, 2);
		const sprite = new Sprite("s", image, 0);
		assert.strictEqual(sprite.noOfFrames, 1);
		assert.strictEqual(sprite.width, 4);
		assert.deepStrictEqual(sprite.frames, [image]);
	});

	it("caps noofframes at the texture width", () => {
		const sprite = new Sprite("s", makeColumnImage(4, 2), 20);
		assert.strictEqual(sprite.noOfFrames, 4);
		assert.strictEqual(sprite.width, 1);
		assert.deepStrictEqual(
			sprite.frames.map((frame) => columns(frame)),
			[[0], [1], [2], [3]],
		);
	});

	it("normalizes a degenerate frame count", () => {
		assert.strictEqual(effectiveFrameCount(NaN, 10), 1);
		assert.strictEqual(effectiveFrameCount(-3, 10), 1);
		assert.strictEqual(effectiveFrameCount(Infinity, 10), 1);
		assert.strictEqual(effectiveFrameCount(2.7, 10), 2);
		assert.strictEqual(effectiveFrameCount(5, 0), 1);
	});
});
