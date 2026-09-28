import uniq from "lodash/uniq";
import { getFilePathFromModOrHOI4 } from "./fileloader";
import { listGfxFilesFromConfiguredRoots } from "./guiwindowindex";
import { Logger } from "./logger";

export interface ConfiguredGfxEntry {
	entry: string;
	// Where the entry was configured, named in the warning when it does not exist.
	source: string;
}

/**
 * The .gfx files a preview looks sprites up in, in order: the game's own file, then what the mod
 * configured (a setting, a descriptor list). An entry that is not a .gfx file is a folder scanned for
 * them. Only files that exist are returned, so a mod without a given file never gets a "Cannot parse"
 * error for it; a configured one that is missing is reported once, naming where it was configured.
 */
export async function resolveConfiguredGfxFiles(vanillaFile: string, configured: ConfiguredGfxEntry[]): Promise<string[]> {
	const files = await getFilePathFromModOrHOI4(vanillaFile) ? [vanillaFile] : [];
	for (const { entry, source } of configured) {
		if (typeof entry !== "string" || entry.trim() === "") {
			continue;
		}
		const path = entry.trim().replace(/\\+/g, "/");
		if (!path.toLowerCase().endsWith(".gfx")) {
			files.push(...await listGfxFilesFromConfiguredRoots([path], source));
		} else if (await getFilePathFromModOrHOI4(path)) {
			files.push(path);
		} else {
			Logger.warn(`${source}: "${entry}" is not in the mod, its parent mods or the game install -- check the path`);
		}
	}
	return uniq(files);
}
