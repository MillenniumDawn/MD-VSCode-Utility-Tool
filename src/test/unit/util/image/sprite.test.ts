import * as assert from "assert";
import type * as vscode from "vscode";
import { PNG } from "pngjs";
import {
	Image,
	Sprite,
	CorneredTileSprite,
	effectiveFrameCount,
} from "../../../../util/image/sprite";

// A sprite only carries the path along, so any value stands in for it.
const texturePath = { path: "/gfx/interface/test.png" } as vscode.Uri;

function makeImage(width: number, height: number): Image {
	const png = new PNG({ width, height });
	png.data.fill(0x7f);
	return new Image(PNG.sync.write(png), width, height, texturePath);
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
		return new Image(PNG.sync.write(png), width, height, texturePath);
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
		assert.strictEqual(sprite.height, 2);

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

	function tileSprite(image: Image, frames: number, border: number): CorneredTileSprite {
		return new CorneredTileSprite("s", image, frames, { x: image.width, y: image.height }, { x: border, y: border });
	}

	function sizes(tiles: Image[]): string[] {
		return tiles.map((tile) => `${tile.width}x${tile.height}`);
	}

	it("cuts a frame into corners, edges and a middle, row by row", () => {
		const tiles = tileSprite(makeColumnImage(8, 6), 1, 2).getTiles();
		assert.deepStrictEqual(sizes(tiles), ["2x2", "4x2", "2x2", "2x2", "4x2", "2x2", "2x2", "4x2", "2x2"]);
		assert.deepStrictEqual(tiles.slice(0, 3).map(columns), [[0, 1], [2, 3, 4, 5], [6, 7]]);
	});

	it("shrinks a border that would leave no middle", () => {
		assert.deepStrictEqual(
			sizes(tileSprite(makeColumnImage(6, 4), 1, 3).getTiles()).slice(0, 3),
			["2x1", "2x1", "2x1"],
		);
		// One pixel has no room for a border at all.
		assert.deepStrictEqual(
			sizes(tileSprite(makeColumnImage(1, 1), 1, 1).getTiles()),
			["0x0", "1x0", "0x0", "0x1", "1x1", "0x1", "0x0", "1x0", "0x0"],
		);
	});

	it("cuts the tiles of the frame asked for, and of the first frame for one the sprite does not have", () => {
		const sprite = tileSprite(makeColumnImage(8, 4), 2, 1);
		const first = sprite.getTiles(0);
		assert.deepStrictEqual(columns(sprite.getTiles(1)[1]!), [5, 6]);
		assert.deepStrictEqual(columns(first[1]!), [1, 2]);
		for (const frame of [2, 7, -1]) {
			assert.strictEqual(sprite.getTiles(frame), first, `frame ${frame}`);
		}
		// Between two frames there is nothing to cut.
		assert.deepStrictEqual(sprite.getTiles(0.5), []);
	});
});
