import {
	CustomMap,
	DetailValue,
	Enum,
	SchemaDef,
	HOIPartial,
	emptyMap,
} from "../../../hoiformat/schema";
import { Country, WorldMapWarning } from "../definitions";
import { readFileFromModOrHOI4AsJson } from "../../../util/fileloader";
import { error } from "../../../util/debug";
import {
	FolderLoader,
	FileLoader,
	Loader,
	LoadResult,
	LoadResultOD,
	mergeInLoadResult,
	convertColor,
	fileLoadFailureWarning,
} from "./common";
import { localize } from "../../../util/i18n";
import {
	FOLDER_LOAD_CONCURRENCY,
	LoaderSession,
} from "../../../util/loader/loader";
import { mapLimit } from "../../../util/common";
import flatMap from "lodash/flatMap";
import { Tag, countryTagsFolder, loadCountryTagsFile } from "../../../util/countrytags";

interface CountryFile {
	color: DetailValue<Enum>;
}

interface ColorsFile extends CustomMap<ColorForCountry> {}

interface ColorForCountry {
	color: DetailValue<Enum>;
}

const countryFileSchema: SchemaDef<CountryFile> = {
	color: {
		_innerType: "enum",
		_type: "detailvalue",
	},
};

const colorsFileSchema: SchemaDef<ColorsFile> = {
	_innerType: {
		color: {
			_innerType: "enum",
			_type: "detailvalue",
		},
	},
	_type: "map",
};

export class CountriesLoader extends Loader<Country[]> {
	private countryTagsLoader: CountryTagsLoader;
	private countryLoaders: Record<string, CountryLoader> = {};
	private colorsLoader: ColorsLoader;

	constructor() {
		super();
		this.countryTagsLoader = new CountryTagsLoader();
		this.colorsLoader = new ColorsLoader();
		this.countryTagsLoader.onProgress((e) => this.onProgressEmitter.fire(e));
		this.colorsLoader.onProgress((e) => this.onProgressEmitter.fire(e));
	}

	public async shouldReloadImpl(session: LoaderSession): Promise<boolean> {
		if (
			(await this.countryTagsLoader.shouldReload(session)) ||
			(await this.colorsLoader.shouldReload(session))
		) {
			return true;
		}

		return (
			await mapLimit(
				Object.values(this.countryLoaders),
				FOLDER_LOAD_CONCURRENCY,
				(l) => l.shouldReload(session),
			)
		).some((v) => v);
	}

	protected async loadImpl(
		session: LoaderSession,
	): Promise<LoadResult<Country[]>> {
		await this.fireOnProgressEvent(
			localize("worldmap.progress.loadingcountries", "Loading countries..."),
		);

		const tagsResult = await this.countryTagsLoader.load(session);
		const countryTags = tagsResult.result;
		const newCountryLoaders: Record<string, CountryLoader> = {};

		for (const tag of countryTags) {
			let countryLoader = this.countryLoaders[tag.tag];
			if (!countryLoader) {
				countryLoader = new CountryLoader(tag.tag, "common/" + tag.file);
				countryLoader.disableTelemetry = true;
				countryLoader.onProgress((e) => this.onProgressEmitter.fire(e));
			}

			newCountryLoaders[tag.tag] = countryLoader;
		}

		this.countryLoaders = newCountryLoaders;

		// A tag whose country file is missing rejects before loadCountry gets to catch it; that
		// tag is skipped and listed as a warning rather than costing the map every other country.
		const failureWarnings: WorldMapWarning[] = [];
		const countriesResult = (
			await mapLimit(countryTags, FOLDER_LOAD_CONCURRENCY, async (tag) => {
				const countryLoader = newCountryLoaders[tag.tag]!;
				try {
					return await countryLoader.load(session);
				} catch (e) {
					session.throwIfCancelled();
					error(e);
					failureWarnings.push(fileLoadFailureWarning(countryLoader.file, e));
					return undefined;
				}
			})
		).filter(
			(r): r is LoadResult<Country | undefined> => r !== undefined,
		);
		const colorsFileResult = await this.colorsLoader.load(session);

		const countries = countriesResult
			.map((r) => r.result)
			.filter((c): c is Country => c !== undefined);

		await applyColorFromColorTxt(countries, colorsFileResult.result);

		const allResults = [tagsResult, colorsFileResult, ...countriesResult];

		return {
			result: countries,
			dependencies: mergeInLoadResult(allResults, "dependencies"),
			warnings: [
				...mergeInLoadResult(allResults, "warnings"),
				...failureWarnings,
			],
		};
	}

	protected extraMeasurements(result: LoadResult<Country[]>) {
		return {
			...super.extraMeasurements(result),
			fileCount: Object.keys(this.countryLoaders).length,
		};
	}

	public toString() {
		return "[CountriesLoader]";
	}
}

class CountryLoader extends FileLoader<Country | undefined> {
	constructor(
		private tag: string,
		file: string,
	) {
		super(file);
	}

	protected async loadFromFile(): Promise<LoadResultOD<Country | undefined>> {
		return { result: await loadCountry(this.tag, this.file), warnings: [] };
	}

	public toString() {
		return `[CountryLoader: ${this.file}]`;
	}
}

class CountryTagsLoader extends FolderLoader<Tag[], Tag[]> {
	constructor() {
		super(countryTagsFolder, CountryTagLoader);
	}

	protected mergeLoadedFiles(
		fileResults: LoadResult<Tag[]>[],
	): Promise<LoadResult<Tag[]>> {
		return Promise.resolve<LoadResult<Tag[]>>({
			result: flatMap(fileResults, (r) => r.result),
			dependencies: [this.folder + "/*"],
			warnings: mergeInLoadResult(fileResults, "warnings"),
		});
	}

	public toString() {
		return `[CountryTagsLoader]`;
	}
}

class CountryTagLoader extends FileLoader<Tag[]> {
	protected async loadFromFile(): Promise<LoadResultOD<Tag[]>> {
		return { result: await loadCountryTagsFile(this.file), warnings: [] };
	}

	public toString() {
		return `[CountryTagLoader: ${this.file}]`;
	}
}

class ColorsLoader extends FileLoader<HOIPartial<ColorsFile>> {
	constructor() {
		super("common/countries/colors.txt");
	}

	protected async loadFromFile(): Promise<
		LoadResultOD<HOIPartial<ColorsFile>>
	> {
		try {
			return {
				result: await readFileFromModOrHOI4AsJson<ColorsFile>(
					this.file,
					colorsFileSchema,
				),
				warnings: [],
			};
		} catch (e) {
			error(e);
			return {
				result: { _map: emptyMap(), _token: undefined },
				warnings: [],
			};
		}
	}

	public toString() {
		return `[Colors]`;
	}
}

async function loadCountry(
	tag: string,
	countryFile: string,
): Promise<Country | undefined> {
	try {
		const data = await readFileFromModOrHOI4AsJson<CountryFile>(
			countryFile,
			countryFileSchema,
		);

		return {
			tag,
			color: convertColor(data.color),
		};
	} catch (e) {
		error(e);
		return undefined;
	}
}

async function applyColorFromColorTxt(
	countries: Country[],
	colorsFile: HOIPartial<ColorsFile>,
): Promise<void> {
	for (const country of countries) {
		const colorIncolors = colorsFile._map[country.tag];
		if (colorIncolors?._value.color) {
			country.color = convertColor(colorIncolors?._value.color);
		}
	}
}
