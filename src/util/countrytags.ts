import { CustomMap, SchemaDef } from "../hoiformat/schema";
import {
	hoiFilesExpiryToken,
	listFilesFromModOrHOI4,
	readFileFromModOrHOI4AsJson,
} from "./fileloader";
import { error } from "./debug";
import { PromiseCache } from "./cache";

// `common/country_tags/*.txt` maps a tag to the country file that defines it. Two features read
// it now -- the world map, which needs the file behind each tag, and the technology preview, which
// only needs the set of tags -- so the reader lives here rather than in either of them.

interface CountryTagsFile extends CustomMap<string> {}

const countryTagsFileSchema: SchemaDef<CountryTagsFile> = {
	_innerType: "string",
	_type: "map",
};

export type Tag = { tag: string; file: string };

export const countryTagsFolder = "common/country_tags";

/** Tags declared in one country_tags file. `dynamic_tags` is a directive, not a country. */
export async function loadCountryTagsFile(countryTagsFile: string): Promise<Tag[]> {
	try {
		const data = await readFileFromModOrHOI4AsJson<CountryTagsFile>(
			countryTagsFile,
			countryTagsFileSchema,
		);
		const result: Tag[] = [];

		for (const tag of Object.values(data._map)) {
			if (!tag._value || tag._key === "dynamic_tags") {
				continue;
			}
			result.push({
				tag: tag._key,
				file: tag._value,
			});
		}

		return result;
	} catch (e) {
		error(e);
		return [];
	}
}

export interface CountryTagList {
	tags: Set<string>;
	files: string[];
}

// A tech-tree render asks for this once per folder, and a workspace holds many previews; without a
// cache every one of them would re-walk and re-parse the whole folder.
//
// `life` alone could never refresh it. That is a TTL since the last *access* and `get` pushes it
// forward on every hit, so an entry a render reads at least once every three seconds outlives every
// edit -- including the forced session a dependencyChanged render runs. The expiry token is what
// actually expires it: the files this load recorded, each with its mtime, which for a file open in
// the editor is Date.now() and so always looks changed.
const countryTagListCache = new PromiseCache<CountryTagList>({
	factory: () => loadCountryTagsUncached(),
	// Built from the cached value's own `files` rather than from a fresh listing: the listing itself
	// goes through a TTL-only cache, and asking it here on every check would keep that entry warm
	// forever without discovering a new file either. See loadCountryTagsUncached.
	expireWhenChange: (_key, cached) =>
		cached.then(
			(value) => hoiFilesExpiryToken(value.files),
			// A load that rejected is already gone from the cache; answering instead of re-throwing
			// keeps its rejection from surfacing here as an unhandled one.
			() => "",
		),
	life: 3 * 1000,
	maxSize: 1,
});

/**
 * Every tag the mod or the base game declares, and the files they came from so a caller that reads
 * this can report them as dependencies.
 */
export function loadCountryTags(): Promise<CountryTagList> {
	return countryTagListCache.get("");
}

/**
 * The expiry token for whatever the tag list was last built from, so a cache holding something
 * *derived* from the tags -- previewdef/technology/countryicons -- can compose it into its own.
 *
 * Separate from the option on the cache above because that one must not re-enter the cache it
 * guards.
 */
export async function countryTagsExpiryToken(): Promise<string> {
	return hoiFilesExpiryToken((await loadCountryTags()).files);
}

// The listing goes through fileloader's own short-TTL cache, and the expiry token above is built
// from the files this returned rather than from a fresh listing. So a *newly created*
// country_tags file is not noticed by the token -- it is picked up when three idle seconds drop the
// entry. Creating a file is not a dependency of any open preview and so renders nothing on its own;
// something else has to move first, and there is a gap by then.
async function loadCountryTagsUncached(): Promise<CountryTagList> {
	let relativeFiles: string[];
	try {
		relativeFiles = (await listFilesFromModOrHOI4(countryTagsFolder))
			.filter((f) => f.toLowerCase().endsWith(".txt"))
			.map((f) => `${countryTagsFolder}/${f}`.replace(/\/+/g, "/"));
	} catch (e) {
		error(e);
		return { tags: new Set(), files: [] };
	}

	const fileTags = await Promise.all(relativeFiles.map(loadCountryTagsFile));
	const tags = new Set<string>();
	for (const tag of fileTags.flat()) {
		tags.add(tag.tag);
	}

	return { tags, files: relativeFiles };
}
