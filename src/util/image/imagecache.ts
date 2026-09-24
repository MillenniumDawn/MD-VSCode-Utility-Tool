import * as vscode from "vscode";
import { PNG } from "pngjs";
import { parseHoi4File } from "../../hoiformat/hoiparser";
import {
	getSpriteTypes,
	SpriteType,
	CorneredTileSpriteType,
} from "../../hoiformat/spritetype";
import {
	readFileFromModOrHOI4,
	hoiFileExpiryToken,
	expiryToken,
} from "../fileloader";
import { PromiseCache } from "../cache";
import { decodeImageToPng } from "./imagedecoder";
import { Sprite, Image, CorneredTileSprite } from "./sprite";
import { localize } from "../i18n";
import { debug, error } from "../debug";
import { UserError } from "../common";
import { describeParseFailure } from "../indexHalf";
import { Logger } from "../logger";
import { getGfxContainerFile } from "../gfxindex";
import { gfxIndex } from "../featureflags";
export { Sprite, Image };

// Decoded PNG buffers are the heaviest thing in memory; bound the image and sprite caches by
// total bytes (least-recently-accessed eviction) so large texture packs can't grow them without
// limit. An entry weighs everything it retains -- the PNG buffer, the memoized data URI, and for
// a sprite its split frames and tiles -- and is re-weighed on access, since those are built
// lazily after the entry is cached. (Entry sizes vary ~1000x for images, so a count cap alone
// would not bound their RAM; the gfx map cache keeps one.)
const imageCacheMaxBytes = 128 * 1024 * 1024;
const imageCache = new PromiseCache<Image | undefined>({
	expireWhenChange: hoiFileExpiryToken,
	factory: getImage,
	life: 10 * 60 * 1000,
	maxBytes: imageCacheMaxBytes,
	weigher: (image) => image?.retainedBytes ?? 0,
});

// A sprite's weight includes its base image, which also sits in imageCache: the sprite keeps it
// alive after imageCache evicts it, so the two caps overlap rather than add.
const spriteCacheMaxBytes = 128 * 1024 * 1024;
const spriteCache = new PromiseCache<Sprite | undefined>({
	expireWhenChange: spriteCacheExpiryToken,
	factory: getSpriteByKey,
	life: 10 * 60 * 1000,
	maxSize: 128,
	maxBytes: spriteCacheMaxBytes,
	weigher: (sprite) => sprite?.retainedBytes ?? 0,
});

type GfxMap = Record<string, SpriteType | CorneredTileSpriteType>;

// Sized to hold every .gfx under interface/ across the mod, the game and its DLCs: the icon
// fallback scan and the inlay sprite scan each walk that whole list, and with a cap below its
// length the first file was evicted before the scan reached the last, so every icon parsed the
// tree again. The maps are small (a name and a texture path per sprite; the whole tree of
// Millennium Dawn plus vanilla is ~80k sprites, ~25 MB) but not fixed in size, so a byte limit
// backs the count. A map's weight is fixed when it is built, so it is computed once there.
const gfxMapWeights = new WeakMap<GfxMap, number>();
const gfxMapCache = new PromiseCache<GfxMap>({
	expireWhenChange: hoiFileExpiryToken,
	factory: loadGfxMap,
	life: 10 * 60 * 1000,
	maxSize: 1024,
	maxBytes: 64 * 1024 * 1024,
	weigher: (gfxMap) => gfxMapWeights.get(gfxMap) ?? 0,
});

/**
 * The sprites a .gfx file defines, by name. Shared with the icon resolution, so a scan that
 * reads a file here leaves it warm for the sprites drawn from it later in the same render. The
 * map is shared and read-only; a file that fails to parse yields an empty map.
 */
export function getGfxSpriteMap(gfxFilePath: string): Promise<Readonly<GfxMap>> {
	return gfxMapCache.get(gfxFilePath);
}

// Diagnostic counters for profiling focus-tree icon resolution (plan Stap 1). They separate
// "searching" cost (index misses + fallback-scan iterations) from "conversion" cost (DDS/TGA->PNG
// decodes, offloaded to a worker with a sync fallback). Reset before a render and dumped after,
// behind the debug() flag.
export const iconResolveStats = {
	indexMiss: 0,
	scanIterations: 0,
	gfxMapParses: 0,
	imageDecodes: 0,
	imageDecodeMs: 0,
};

// Negative-scan memo for the index-off fallback path: remembers that a given icon name was not
// found in a given gfxFilePath set, so the same unresolved icon doesn't re-scan (and re-miss) the
// whole list for every focus that references it. Only negatives are stored; positive sprites go
// through spriteCache (which has proper file-change expiry). Cleared per render via
// resetIconResolveStats so a newly added gfx file is picked up on the next preview.
const negativeScanMemo = new Set<string>();

export function resetIconResolveStats(): void {
	iconResolveStats.indexMiss = 0;
	iconResolveStats.scanIterations = 0;
	iconResolveStats.gfxMapParses = 0;
	iconResolveStats.imageDecodes = 0;
	iconResolveStats.imageDecodeMs = 0;
	negativeScanMemo.clear();
}

// Test-only: drop the image/sprite/gfx-map caches and the negative-scan memo so a headless loader
// test starts clean (the module-level caches otherwise persist across tests in one process).
export function _clearImageCachesForTest(): void {
	imageCache.clear();
	spriteCache.clear();
	gfxMapCache.clear();
	negativeScanMemo.clear();
}

export function getImageByPath(
	relativePath: string,
): Promise<Image | undefined> {
	return imageCache.get(relativePath);
}

export async function getSpriteByGfxName(
	name: string,
	gfxFilePath: string | string[],
): Promise<Sprite | undefined> {
	const pathFromIndex = await getGfxContainerFile(name);
	if (pathFromIndex) {
		return await spriteCache.get(pathFromIndex + "?" + name);
	}

	iconResolveStats.indexMiss++;

	// When the gfx index is enabled it is authoritative: a miss means the sprite is defined in no
	// indexed gfx file. The `gfxFilePath` fallback list is itself derived from index hits, so
	// scanning it cannot find the sprite either. Return undefined immediately instead of re-parsing
	// every gfx file for each unresolved focus icon. (plan Stap 2)
	if (gfxIndex) {
		return undefined;
	}

	if (Array.isArray(gfxFilePath)) {
		const memoKey = name + " " + gfxFilePath.join(" ");
		if (negativeScanMemo.has(memoKey)) {
			return undefined;
		}
		for (const path of gfxFilePath) {
			iconResolveStats.scanIterations++;
			const result = await spriteCache.get(path + "?" + name);
			if (result !== undefined) {
				return result;
			}
		}
		// Remember the miss so the same icon doesn't re-scan the whole list for every focus.
		negativeScanMemo.add(memoKey);
		return undefined;
	} else {
		return await spriteCache.get(gfxFilePath + "?" + name);
	}
}

async function spriteCacheExpiryToken(
	key: string,
	spritePromise: Promise<Sprite | undefined>,
): Promise<string> {
	const [gfxFilePath = ""] = key.split("?");
	const gfxToken = await hoiFileExpiryToken(gfxFilePath);
	const sprite = await spritePromise;
	if (sprite) {
		return `${gfxToken}:${expiryToken(sprite.image.path)}`;
	}
	return gfxToken;
}

function getSpriteByKey(key: string): Promise<Sprite | undefined> {
	const [gfxFilePath = "", name = ""] = key.split("?");
	return getSpriteByGfxNameImpl(name, gfxFilePath);
}

async function getSpriteByGfxNameImpl(
	name: string,
	gfxFilePath: string,
): Promise<Sprite | undefined> {
	const gfxMap = await gfxMapCache.get(gfxFilePath);
	const sprite = gfxMap[name];

	if (sprite === undefined) {
		return undefined;
	}

	const image = await imageCache.get(sprite.texturefile);
	if (image === undefined) {
		return undefined;
	}

	if ("bordersize" in sprite) {
		return new CorneredTileSprite(
			name,
			image,
			sprite.noofframes,
			sprite.size,
			sprite.bordersize,
		);
	}

	return new Sprite(name, image, sprite.noofframes);
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Reads width/height straight from the IHDR chunk (bytes 16-23) without inflating the image.
// Returns undefined if the signature, the IHDR chunk type, or the buffer length don't check out,
// so the caller can fall back to a full PNG.sync.read decode.
export function readPngHeaderDimensions(
	buffer: Buffer,
): { width: number; height: number } | undefined {
	if (buffer.length < 24) {
		return undefined;
	}
	for (let i = 0; i < pngSignature.length; i++) {
		if (buffer[i] !== pngSignature[i]) {
			return undefined;
		}
	}
	if (buffer.toString("ascii", 12, 16) !== "IHDR") {
		return undefined;
	}

	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function getImage(relativePath: string): Promise<Image | undefined> {
	let readFileResult: [Buffer, vscode.Uri] | undefined = undefined;
	try {
		readFileResult = await readFileFromModOrHOI4(relativePath);
	} catch (e) {
		if (!(e instanceof UserError)) {
			error("Failed to get image " + relativePath);
			error(e);
		} else {
			debug(e);
		}

		if (relativePath.length <= 4 || relativePath.endsWith(".dds")) {
			return undefined;
		}

		// in case .png or .tga not exist but .dds exist
		relativePath = relativePath.substr(0, relativePath.length - 4) + ".dds";
	}

	try {
		const [buffer, realPath] =
			readFileResult ?? (await readFileFromModOrHOI4(relativePath));
		let pngBuffer: Buffer;
		let width: number;
		let height: number;

		relativePath = relativePath.toLowerCase();
		const decodeStart = Date.now();
		if (relativePath.endsWith(".dds")) {
			({ pngBuffer, width, height } = await decodeImageToPng(buffer, "dds"));
		} else if (relativePath.endsWith(".tga")) {
			({ pngBuffer, width, height } = await decodeImageToPng(buffer, "tga"));
		} else if (relativePath.endsWith(".png")) {
			// PNG passthrough: the buffer is already PNG, so only its dimensions are read here, straight
			// from the IHDR header bytes rather than a full inflate; PNG.sync.read is the fallback for a
			// header that doesn't check out.
			pngBuffer = buffer;
			const header = readPngHeaderDimensions(buffer);
			if (header) {
				({ width, height } = header);
			} else {
				const png = PNG.sync.read(buffer);
				width = png.width;
				height = png.height;
			}
		} else {
			throw new UserError("Unsupported image type: " + relativePath);
		}
		iconResolveStats.imageDecodes++;
		iconResolveStats.imageDecodeMs += Date.now() - decodeStart;

		return new Image(pngBuffer, width, height, realPath);
	} catch (e) {
		if (!(e instanceof UserError)) {
			error("Failed to get image " + relativePath);
			error(e);
		} else {
			debug(e);
		}
		return undefined;
	}
}

async function loadGfxMap(path: string): Promise<GfxMap> {
	const gfxMap: GfxMap = {};
	let weight = 0;
	try {
		iconResolveStats.gfxMapParses++;
		const [buffer, realPath] = await readFileFromModOrHOI4(path);
		const gfx = buffer.toString("utf-8");
		const node = parseHoi4File(
			gfx,
			localize("infile", "In file {0}:\n", realPath),
		);
		const spriteTypes = getSpriteTypes(node);

		for (const spriteType of spriteTypes) {
			gfxMap[spriteType.name] = spriteType;
			weight += (spriteType.name.length + spriteType.texturefile.length) * 2 + 96;
		}
	} catch (e) {
		// The output channel is the only trace a broken .gfx leaves when the icon fallback scan or
		// the inlay sprite scan reads through this cache (issue #182). This line names the file; the
		// error call adds the stack to the channel and keeps the console/telemetry line.
		Logger.error(`Cannot parse ${path}: ${describeParseFailure(e)}`);
		error(e);
	}

	gfxMapWeights.set(gfxMap, weight);
	return gfxMap;
}
