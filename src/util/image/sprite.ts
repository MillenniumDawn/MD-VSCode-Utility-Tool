import * as vscode from "vscode";
import { PNG } from "pngjs";
import { NumberPosition } from "../common";

export class Image {
	private cachedUri: string | undefined = undefined;
	constructor(
		readonly pngBuffer: Buffer,
		readonly width: number,
		readonly height: number,
		readonly path: vscode.Uri,
	) {}

	// Computed once and reused: the base64 data URI is ~33% larger than the PNG buffer, but the
	// GFX preview re-renders every sprite on each edit, so re-encoding the unchanged ones was the
	// hot path (per keystroke for a texture atlas). Memoizing on the instance is safe because Image
	// is immutable and the image cache keys instances by file path + change token, so a texture that
	// changes produces a fresh instance with a fresh buffer rather than a stale URI. The URI counts
	// towards the image cache's byte cap through retainedBytes, so memoizing it stays bounded.
	public get uri(): string {
		if (this.cachedUri === undefined) {
			this.cachedUri = toDataUrl(this.pngBuffer);
		}
		return this.cachedUri;
	}

	// Bytes this image keeps alive: the PNG buffer plus the memoized data URI once it exists. The
	// caches weigh entries by this, and re-weigh on access, so the URI is counted from the render
	// that materializes it.
	public get retainedBytes(): number {
		return this.pngBuffer.length + (this.cachedUri?.length ?? 0);
	}
}

export class Sprite {
	private cachedFrames: Image[] | undefined = undefined;
	constructor(
		readonly id: string,
		readonly image: Image,
		readonly noOfFrames: number,
	) {}

	public get frames(): Image[] {
		if (this.cachedFrames) {
			return this.cachedFrames;
		}

		if (this.noOfFrames === 1) {
			return (this.cachedFrames = [this.image]);
		}

		const png = pngRead(this.image.pngBuffer);
		const frameWidth = this.width;
		const framePng = new PNG({ width: frameWidth, height: png.height });
		const result: Image[] = [];
		const path = this.image.path;

		for (var i = 0; i < this.noOfFrames; i++) {
			png.bitblt(framePng, i * frameWidth, 0, frameWidth, png.height, 0, 0);
			result.push(
				new Image(PNG.sync.write(framePng), frameWidth, png.height, path),
			);
		}

		return (this.cachedFrames = result);
	}

	// The base image plus every per-frame image split off it. A single-frame sprite's frames array
	// is just [image], so it is not counted twice.
	public get retainedBytes(): number {
		let bytes = this.image.retainedBytes;
		if (this.noOfFrames > 1 && this.cachedFrames) {
			for (const frame of this.cachedFrames) {
				bytes += frame.retainedBytes;
			}
		}
		return bytes;
	}

	public get width(): number {
		return this.image.width / this.noOfFrames;
	}

	public get height(): number {
		return this.image.height;
	}
}

export class CorneredTileSprite extends Sprite {
	private cachedTiles: Record<number, Image[]> = {};

	constructor(
		id: string,
		image: Image,
		noOfFrames: number,
		readonly size: NumberPosition,
		readonly borderSize: NumberPosition,
	) {
		super(id, image, noOfFrames);
	}

	public get retainedBytes(): number {
		let bytes = super.retainedBytes;
		for (const tiles of Object.values(this.cachedTiles)) {
			for (const tile of tiles) {
				bytes += tile.retainedBytes;
			}
		}
		return bytes;
	}

	public getTiles(frameId: number = 0): Image[] {
		if (frameId > this.noOfFrames) {
			frameId = 0;
		}

		const cached = this.cachedTiles[frameId];
		if (cached) {
			return cached;
		}

		if (frameId < 0 || frameId >= this.frames.length) {
			frameId = 0;
		}
		const frame = this.frames[frameId];
		if (frame === undefined) {
			return [];
		}
		const sizeX = frame.width;
		const sizeY = frame.height;
		const backPng = pngRead(frame.pngBuffer);

		let borderX = this.borderSize.x;
		let borderY = this.borderSize.y;
		if (borderX * 2 >= sizeX) {
			borderX = Math.max(0, Math.floor(sizeX / 2 - 1));
		}
		if (borderY * 2 >= sizeY) {
			borderY = Math.max(0, Math.floor(sizeY / 2 - 1));
		}

		const path = this.image.path;
		const xPos = [0, borderX, sizeX - borderX, sizeX];
		const yPos = [0, borderY, sizeY - borderY, sizeY];
		const tiles: Image[] = [];
		for (let y = 0; y < 3; y++) {
			for (let x = 0; x < 3; x++) {
				tiles.push(
					extractImageFromPng(
						backPng,
						xPos[x] ?? 0,
						yPos[y] ?? 0,
						(xPos[x + 1] ?? 0) - (xPos[x] ?? 0),
						(yPos[y + 1] ?? 0) - (yPos[y] ?? 0),
						path,
					),
				);
			}
		}

		this.cachedTiles[frameId] = tiles;
		return tiles;
	}
}

function toDataUrl(buffer: Buffer): string {
	return "data:image/png;base64," + buffer.toString("base64");
}

function extractImageFromPng(
	png: PNG,
	x: number,
	y: number,
	w: number,
	h: number,
	path: vscode.Uri,
): Image {
	const resultPng = new PNG({ width: w, height: h });
	if (w > 0 && h > 0) {
		png.bitblt(resultPng, x, y, w, h, 0, 0);
	}
	return new Image(PNG.sync.write(resultPng), w, h, path);
}

function pngRead(buffer: Buffer): PNG {
	const result = PNG.sync.read(buffer);
	Object.setPrototypeOf(result, PNG.prototype);
	return result;
}
