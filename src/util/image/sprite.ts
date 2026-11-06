import type * as vscode from "vscode";
import { PNG } from "pngjs";
import { NumberPosition } from "../common";
import { pngToPng } from "./converter";

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

// noofframes comes straight from the .gfx file: 0 would make the frame width Infinity, and more
// frames than the texture has columns would cut zero-width frames that pngjs refuses to blit.
export function effectiveFrameCount(
	noOfFrames: number,
	imageWidth: number,
): number {
	const frames = Math.floor(noOfFrames);
	if (!Number.isFinite(frames) || frames < 1) {
		return 1;
	}
	return Math.min(frames, Math.max(1, Math.floor(imageWidth)));
}

export class Sprite {
	private readonly cachedFrames: Array<Image | undefined> = [];
	readonly noOfFrames: number;
	constructor(
		readonly id: string,
		readonly image: Image,
		noOfFrames: number,
	) {
		this.noOfFrames = effectiveFrameCount(noOfFrames, image.width);
	}

	// Cuts one frame off the strip the first time it is asked for. The strip is decoded again for
	// each new frame rather than kept: decoded, it outweighs every frame cut from it.
	public frame(index: number): Image | undefined {
		if (!Number.isInteger(index) || index < 0 || index >= this.noOfFrames) {
			return undefined;
		}
		if (this.noOfFrames === 1) {
			return this.image;
		}
		const cached = this.cachedFrames[index];
		if (cached) {
			return cached;
		}
		const png = pngRead(this.image.pngBuffer);
		const frame = extractImageFromPng(png, index * this.width, 0, this.width, png.height, this.image.path);
		this.cachedFrames[index] = frame;
		return frame;
	}

	// The base image plus every frame cut from it. A single-frame sprite's frame is the image
	// itself, so it is not counted twice.
	public get retainedBytes(): number {
		let bytes = this.image.retainedBytes;
		for (const frame of this.cachedFrames) {
			bytes += frame?.retainedBytes ?? 0;
		}
		return bytes;
	}

	public get width(): number {
		return Math.floor(this.image.width / this.noOfFrames);
	}

	public get height(): number {
		return this.image.height;
	}
}

export class CorneredTileSprite extends Sprite {
	private cachedTiles: Record<number, Image[]> = {};
	readonly borderSize: NumberPosition;

	constructor(
		id: string,
		image: Image,
		noOfFrames: number,
		readonly size: NumberPosition,
		borderSize: NumberPosition,
	) {
		super(id, image, noOfFrames);
		this.borderSize = {
			x: normalizeBorderSize(borderSize.x),
			y: normalizeBorderSize(borderSize.y),
		};
	}

	public override get retainedBytes(): number {
		let bytes = super.retainedBytes;
		for (const tiles of Object.values(this.cachedTiles)) {
			for (const tile of tiles) {
				bytes += tile.retainedBytes;
			}
		}
		return bytes;
	}

	public getTiles(frameId: number = 0): Image[] {
		if (frameId < 0 || frameId >= this.noOfFrames) {
			frameId = 0;
		}

		const cached = this.cachedTiles[frameId];
		if (cached) {
			return cached;
		}

		const frame = this.frame(frameId);
		if (frame === undefined) {
			return [];
		}
		const sizeX = frame.width;
		const sizeY = frame.height;
		const backPng = pngRead(frame.pngBuffer);

		const borderX = sourceBorderSize(this.borderSize.x, sizeX);
		const borderY = sourceBorderSize(this.borderSize.y, sizeY);

		const path = this.image.path;
		const xPos = [0, borderX, sizeX - borderX, sizeX];
		const yPos = [0, borderY, sizeY - borderY, sizeY];
		const tiles: Image[] = [];
		for (let y = 0; y < 3; y++) {
			for (let x = 0; x < 3; x++) {
				tiles.push(
					extractImageFromPng(
						backPng,
						xPos[x]!,
						yPos[y]!,
						xPos[x + 1]! - xPos[x]!,
						yPos[y + 1]! - yPos[y]!,
						path,
					),
				);
			}
		}

		this.cachedTiles[frameId] = tiles;
		return tiles;
	}
}

function normalizeBorderSize(border: number): number {
	return Number.isFinite(border) ? Math.max(0, Math.floor(border)) : 0;
}

function sourceBorderSize(border: number, dimension: number): number {
	// The source must retain a center tile; the destination uses the declared border independently.
	return border * 2 >= dimension ? Math.max(0, Math.floor(dimension / 2 - 1)) : border;
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
	const result = pngToPng(buffer);
	Object.setPrototypeOf(result, PNG.prototype);
	return result;
}
