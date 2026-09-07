import { CustomMap, SchemaDef } from "../hoiformat/schema";
import { listFilesFromModOrHOI4, readFileFromModOrHOI4AsJson } from "./fileloader";
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
// cache every one of them would re-walk and re-parse the whole folder. A short life collapses those
// repeated reads while staying fresh enough that an edit shows up within a couple of seconds,
// mirroring `equipmentArchetypeCache` in previewdef/technology/loader.ts.
const countryTagListCache = new PromiseCache<CountryTagList>({
	factory: () => loadCountryTagsUncached(),
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
