import { TechnologyTree } from "./schema";
import { getGfxIndexVersion, getIndexedGfxNames } from "../../util/gfxindex";
import { countryTagsExpiryToken, loadCountryTags } from "../../util/countrytags";
import { PromiseCache } from "../../util/cache";
import { gfxIndex } from "../../util/featureflags";

// The game draws a technology with the icon its country ships when there is one, falling back to
// the generic icon otherwise. The preview offers that as a country dropdown, so it has to answer
// "which countries have their own art for the technologies in this folder?" -- which means reading
// the sprite namespace once and splitting each name on the tags the game itself declares.
//
// Splitting on declared tags, rather than on "three characters then an underscore", is what keeps
// ordinary sprite names out of the list: a name like GFX_APC_1_medium is not a country's APC_1, it
// is the generic icon for the technology APC_1, and only the tag list can tell the two apart.

/**
 * globalState key for the country the reader picked in the tech-tree toolbar. It lives there rather
 * than in the webview's own state because that state dies with the panel; see util/previewoptions.
 */
export const technologyCountryOption = "technology.country";

const gfxPrefix = "GFX_";

// The two generic names getTechnologySprite already resolves. A country's sprite is one of these
// with the tag in front, so nothing here invents a third naming convention.
const iconSuffixes = ["_medium", ""];

/**
 * Technology id -> the country tags that ship art for it, sorted.
 *
 * `tags` is what the game declares, and splitting each sprite name on those rather than on a shape
 * is the whole point: an ordinary sprite whose name happens to start with three capitals is not a
 * country's anything, and only the tag list can tell the two apart.
 */
export function buildTechnologyTagMap(
	tags: Set<string>,
	names: string[],
): Record<string, string[]> {
	if (tags.size === 0 || names.length === 0) {
		return {};
	}

	const map: Record<string, Set<string>> = {};
	for (const name of names) {
		if (!name.startsWith(gfxPrefix)) {
			continue;
		}

		const rest = name.slice(gfxPrefix.length);
		const separator = rest.indexOf("_");
		if (separator <= 0) {
			continue;
		}

		const tag = rest.slice(0, separator);
		if (!tags.has(tag)) {
			continue;
		}

		// Both readings are recorded rather than the first that fits: a technology genuinely named
		// `<something>_medium` is addressed by the bare form, and only the caller knows which ids
		// are real technologies, so an id that turns out not to be one is simply never asked for.
		const named = rest.slice(separator + 1);
		for (const suffix of iconSuffixes) {
			if (suffix !== "" && !named.endsWith(suffix)) {
				continue;
			}
			const id = suffix === "" ? named : named.slice(0, -suffix.length);
			if (id === "") {
				continue;
			}
			(map[id] ??= new Set<string>()).add(tag);
		}
	}

	const result: Record<string, string[]> = {};
	for (const id of Object.keys(map)) {
		result[id] = [...(map[id] ?? [])].sort();
	}

	return result;
}

/**
 * The map is built from two independent sources, so its expiry token has a part for each -- the same
 * shape as `spriteCacheExpiryToken` composing a gfx file with the image behind it.
 *
 * The sprite namespace has no file to stat, so it reports a version counter instead. The setting is
 * a part of the token in its own right: turning the index off makes `getIndexedGfxNames` answer `[]`
 * without any mutation moving that counter.
 */
export async function technologyTagMapExpiryToken(): Promise<string> {
	return `${gfxIndex ? getGfxIndexVersion() : "off"}|${await countryTagsExpiryToken()}`;
}

// Reads the whole sprite namespace, so it is empty when the gfx index is off -- which is also when
// the country icons themselves would not resolve, since that is where getSpriteByGfxName looks them
// up. One tech-tree render asks per folder and a workspace holds many previews; without a cache each
// of them would walk the namespace again.
//
// `life` is a TTL since the last *access*, so on its own it could never expire an entry a render
// reads every few seconds; the token above is what makes an edit reach the dropdown.
const technologyTagMapCache = new PromiseCache<Record<string, string[]>>({
	factory: async () => {
		const [{ tags }, names] = await Promise.all([
			loadCountryTags(),
			getIndexedGfxNames(),
		]);
		return buildTechnologyTagMap(tags, names);
	},
	expireWhenChange: () => technologyTagMapExpiryToken(),
	life: 3 * 1000,
	maxSize: 1,
});

/**
 * The tags worth offering for each folder: those that ship art for a technology drawn in that
 * folder. A technology placed in two folders counts in both, and a folder whose technologies have
 * no country art keeps an empty list rather than being dropped, so the page can always look the
 * folder up.
 */
export function technologyTagsByFolder(
	technologyTrees: TechnologyTree[],
	folders: string[],
	tagMap: Record<string, string[]>,
): Record<string, string[]> {
	const result: Record<string, string[]> = {};

	for (const folder of folders) {
		const tags = new Set<string>();
		for (const tree of technologyTrees) {
			for (const technology of tree.technologies) {
				if (!(folder in technology.folders)) {
					continue;
				}
				for (const tag of tagMap[technology.id] ?? []) {
					tags.add(tag);
				}
			}
		}

		result[folder] = [...tags].sort();
	}

	return result;
}

export async function getCountryTagsByFolder(
	technologyTrees: TechnologyTree[],
	folders: string[],
): Promise<Record<string, string[]>> {
	return technologyTagsByFolder(
		technologyTrees,
		folders,
		await technologyTagMapCache.get(""),
	);
}
