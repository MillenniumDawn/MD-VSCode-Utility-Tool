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
	private cachedFrames: Array<Image | undefined> | undefined = undefined;
	private framesList: Image[] | undefined = undefined;
	private basePng: PNG | undefined = undefined;
	private frameScratch: PNG | undefined = undefined;
	private materializedFrames = 0;
	readonly noOfFrames: number;
	constructor(
		readonly id: string,
		readonly image: Image,
		noOfFrames: number,
	) {
		this.noOfFrames = effectiveFrameCount(noOfFrames, image.width);
	}

	// An index or a visit such as map encodes that frame only. Reading length encodes nothing.
	public get frames(): Image[] {
		if (this.framesList) {
			return this.framesList;
		}

		if (this.noOfFrames === 1) {
			return (this.framesList = [this.image]);
		}

		this.basePng = pngRead(this.image.pngBuffer);
		this.cachedFrames = new Array<Image | undefined>(this.noOfFrames);
		// The materialize path only ever stores Image, so the hole-array target presents as Image[].
		const list: Array<Image | undefined> = new Proxy(this.cachedFrames, {
			get: (target, property, receiver) => {
				if (
					typeof property === "string" &&
					this.isFrameIndex(target, property)
				) {
					return this.materialize(Number(property), target);
				}
				if (property === "length") {
					return target.length;
				}
				return Reflect.get(target, property, receiver);
			},
			// Array methods such as map skip holes, and a sparse array would turn a visit into a
			// no-op, so an in-range index reports as present even while it is still a hole.
			has: (target, property) =>
				(typeof property === "string" && this.isFrameIndex(target, property)) ||
				Reflect.has(target, property),
		});
		return (this.framesList = list as Image[]);
	}

	// A frame index in canonical decimal form: array indexing for "0", a miss for "10.5" or "01".
	private isFrameIndex(
		target: Array<Image | undefined>,
		property: string,
	): boolean {
		const index = Number(property);
		return (
			String(index) === property &&
			Number.isInteger(index) &&
			index >= 0 &&
			index < target.length
		);
	}

	private materialize(
		index: number,
		frames: Array<Image | undefined>,
	): Image {
		const cached = frames[index];
		if (cached !== undefined) {
			return cached;
		}

		const png = this.basePng ?? pngRead(this.image.pngBuffer);
		const frameWidth = this.width;
		const framePng =
			this.frameScratch ??
			(this.frameScratch = new PNG({
				width: frameWidth,
				height: png.height,
			}));
		png.bitblt(framePng, index * frameWidth, 0, frameWidth, png.height, 0, 0);
		const frame = new Image(
			PNG.sync.write(framePng),
			frameWidth,
			png.height,
			this.image.path,
		);
		frames[index] = frame;
		this.materializedFrames++;
		// The decoded strip and the scratch PNG are only needed while frames are still missing.
		if (this.materializedFrames >= this.noOfFrames) {
			this.basePng = undefined;
			this.frameScratch = undefined;
		}
		return frame;
	}

	// The base image plus every frame actually split off it. The decoded strip and its scratch
	// buffer stay until every frame is read, so the cache weighs those too. A single-frame sprite's
	// frames array is just [image], so it is not counted twice.
	public get retainedBytes(): number {
		let bytes = this.image.retainedBytes;
		if (this.basePng) {
			bytes += this.basePng.data.length;
		}
		if (this.frameScratch) {
			bytes += this.frameScratch.data.length;
		}
		if (this.noOfFrames > 1 && this.cachedFrames) {
			for (const frame of this.cachedFrames) {
				if (frame !== undefined) {
					bytes += frame.retainedBytes;
				}
			}
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

	constructor(
		id: string,
		image: Image,
		noOfFrames: number,
		readonly size: NumberPosition,
		readonly borderSize: NumberPosition,
	) {
		super(id, image, noOfFrames);
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
