import * as fileloader from "../../util/fileloader";
import * as imagecache from "../../util/image/imagecache";
import { resolveConfiguredGfxFiles, ConfiguredGfxEntry } from "../../util/configuredgfxfiles";
import { getConfiguration } from "../../util/vsccommon";
import { Logger, describeParseFailure } from "../../util/logger";

// Where the icons come from. A .gfx file belongs to the first of these that has it: the mod's own
// copy replaces the parent mod's, which replaces the game's.
export type IconSource = "mod" | "parent" | "vanilla";

export interface CatalogIcon {
	name: string;
	gfxFile: string;
	texture: string;
	source: IconSource;
	frames: number;
	// A `_shine` sprite is the animated highlight drawn over a focus icon, never an icon itself.
	shine: boolean;
	// Offsets of the sprite's name in its .gfx file, for opening the definition.
	start?: number;
	end?: number;
}

export interface CatalogGfxFile {
	path: string;
	source: IconSource;
	count: number;
}

export interface CatalogData {
	icons: CatalogIcon[];
	gfxFiles: CatalogGfxFile[];
}

const goalsGfx = "interface/goals.gfx";
const settingName = "mdHoi4Utilities.focusIconCatalogGfxFiles";
const descriptorName = "focus_icon_gfx in the .mod file";
const sourceOrder: Record<IconSource, number> = { mod: 0, parent: 1, vanilla: 2 };

/** A .gfx under interface/ is taken for a focus icon file when its name mentions goals or focuses. */
export function isFocusGfxFile(path: string): boolean {
	const file = path.replace(/\\+/g, "/").split("/").pop() ?? "";
	return /\.gfx$/i.test(file) && /goal|focus/i.test(file);
}

/** The .gfx files the catalog reads: the game's goals.gfx, every focus-named file, then what the mod configured. */
export async function listCatalogGfxFiles(): Promise<string[]> {
	const configured: ConfiguredGfxEntry[] = [
		...(getConfiguration().focusIconCatalogGfxFiles ?? []).map(entry => ({ entry, source: settingName })),
		...(await fileloader.getDescriptorFocusIconGfx()).map(entry => ({ entry, source: descriptorName })),
	];
	const listed = (await fileloader.listFilesFromModOrHOI4("interface", { recursively: true }))
		.map(file => "interface/" + file.replace(/\\+/g, "/"))
		.filter(isFocusGfxFile);
	const files = [goalsGfx, ...listed, ...await resolveConfiguredGfxFiles(goalsGfx, configured)];
	const seen = new Set<string>();
	return files.filter(file => {
		const key = file.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/** Which source supplies the copy of a file the game loads, or undefined when none has it. */
export async function sourceOfFile(path: string): Promise<IconSource | undefined> {
	if (await fileloader.getFilePathFromModOrHOI4(path, { hoi4: false, parent: false })) {
		return "mod";
	}
	if (await fileloader.getFilePathFromModOrHOI4(path, { workspace: false, hoi4: false })) {
		return "parent";
	}
	if (await fileloader.getFilePathFromModOrHOI4(path, { mod: false })) {
		return "vanilla";
	}
	return undefined;
}

/**
 * Every sprite the catalog files define, once per name. The mod's files are read before the parent
 * mods' and those before the game's, so a name defined twice shows the copy that wins.
 */
export async function loadFocusIconCatalog(): Promise<CatalogData> {
	const files: { path: string; source: IconSource }[] = [];
	for (const path of await listCatalogGfxFiles()) {
		const source = await sourceOfFile(path);
		if (source !== undefined) {
			files.push({ path, source });
		}
	}
	files.sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source]);

	const icons = new Map<string, CatalogIcon>();
	const gfxFiles: CatalogGfxFile[] = [];
	for (const { path, source } of files) {
		let count = 0;
		try {
			const sprites = await imagecache.getGfxSpriteMap(path);
			for (const sprite of Object.values(sprites)) {
				if (typeof sprite.name !== "string" || typeof sprite.texturefile !== "string" || icons.has(sprite.name)) {
					continue;
				}
				icons.set(sprite.name, {
					name: sprite.name,
					gfxFile: path,
					texture: sprite.texturefile.replace(/\\+/g, "/"),
					source,
					frames: sprite.noofframes,
					shine: /_shine$/i.test(sprite.name),
					start: sprite.token?.start,
					end: sprite.token?.end,
				});
				count++;
			}
		} catch (e) {
			Logger.error(`Focus icon catalog: cannot read ${path}: ${describeParseFailure(e)}`);
		}
		gfxFiles.push({ path, source, count });
	}

	return {
		icons: [...icons.values()].sort((a, b) => a.name.localeCompare(b.name)),
		gfxFiles: gfxFiles.filter(file => file.count > 0),
	};
}

/** The first frame of an icon's texture as a data URI, or undefined when the texture cannot be read. */
export async function loadIconImageUri(icon: CatalogIcon): Promise<string | undefined> {
	const image = await imagecache.getImageByPath(icon.texture);
	if (image === undefined) {
		return undefined;
	}
	if (icon.frames > 1) {
		return new imagecache.Sprite(icon.name, image, icon.frames).frame(0)?.uri;
	}
	return image.uri;
}
