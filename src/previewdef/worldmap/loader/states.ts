import {
	State,
	Province,
	WorldMapWarning,
	WorldMapWarningSource,
	Region,
	StateCategory,
	Resource,
} from "../definitions";
import {
	Enum,
	SchemaDef,
	CustomMap,
	DetailValue,
} from "../../../hoiformat/schema";
import { readFileFromModOrHOI4AsJson } from "../../../util/fileloader";
import { error } from "../../../util/debug";
import {
	LoadResult,
	FolderLoader,
	mergeInLoadResult,
	convertColor,
} from "./common";
import {
	RegionFolderLoader,
	RegionKind,
	calculateRegionBoundingBox,
	fillRegions,
	sortRegionItems,
	worldMapFileLoader,
} from "./regionloader";
import { Token } from "../../../hoiformat/hoiparser";
import { arrayToMap } from "../../../util/common";
import { DefaultMapLoader } from "./provincemap";
import { localize } from "../../../util/i18n";
import { LoaderSession } from "../../../util/loader/loader";
import flatMap from "lodash/flatMap";
import { ResourceDefinitionLoader } from "./resource";

interface StateFile {
	state: StateDefinition[];
}

interface StateDefinition {
	id: number;
	name: string;
	manpower: number;
	state_category: string;
	history: StateHistory;
	provinces: Enum;
	impassable: boolean;
	impassable_ignored_links: Enum;
	resources: CustomMap<number>;
	_token: Token;
}

interface StateHistory {
	owner: string;
	victory_points: Enum[];
	add_core_of: string[];
}

const stateFileSchema: SchemaDef<StateFile> = {
	state: {
		_innerType: {
			id: "number",
			name: "string",
			manpower: "number",
			state_category: "string",
			history: {
				owner: "string",
				victory_points: {
					_innerType: "enum",
					_type: "array",
				},
				add_core_of: {
					_innerType: "string",
					_type: "array",
				},
			},
			provinces: "enum",
			impassable: "boolean",
			impassable_ignored_links: "enum",
			resources: {
				_innerType: "number",
				_type: "map",
			},
		},
		_type: "array",
	},
};

interface StateCategoryFile {
	state_categories: CustomMap<StateCategoryDefinition>;
}

interface StateCategoryDefinition {
	color: DetailValue<Enum>;
}

const stateCategoryFileSchema: SchemaDef<StateCategoryFile> = {
	state_categories: {
		_innerType: {
			color: {
				_innerType: "enum",
				_type: "detailvalue",
			},
		},
		_type: "map",
	},
};

export type StateNoBoundingBox = Omit<State, keyof Region>;

const stateKind: RegionKind = {
	sourceType: "state",
	idTooLarge: [
		"worldmap.warnings.stateidtoolarge",
		"Max state id is too large: {0}",
	],
	idConflict: [
		"worldmap.warnings.stateidconflict",
		"There're more than one states using state id {0}.",
	],
	notExist: [
		"worldmap.warnings.statenotexist",
		"State with id {0} doesn't exist.",
	],
	subRegionNotExist: [
		"worldmap.warnings.stateprovincenotexist",
		"Province {0} used in state {1} doesn't exist.",
	],
	noValidSubRegions: [
		"worldmap.warnings.statenovalidprovinces",
		"State {0} doesn't have valid provinces.",
	],
};

type StateLoaderResult = { states: State[]; badStatesCount: number };
export class StatesLoader extends RegionFolderLoader<
	StateLoaderResult,
	StateNoBoundingBox[]
> {
	private categoriesLoader: StateCategoriesLoader;

	constructor(
		private defaultMapLoader: DefaultMapLoader,
		private resourcesLoader: ResourceDefinitionLoader,
	) {
		super(
			"history/states",
			worldMapFileLoader("StateLoader", loadState),
			"StatesLoader",
			["worldmap.progress.loadingstates", "Loading states..."],
		);
		this.categoriesLoader = new StateCategoriesLoader();
		this.categoriesLoader.onProgress((e) => this.onProgressEmitter.fire(e));
	}

	protected override dependencyLoaders() {
		return [this.defaultMapLoader, this.categoriesLoader, this.resourcesLoader];
	}

	protected async mergeLoadedFiles(
		fileResults: LoadResult<StateNoBoundingBox[]>[],
		session: LoaderSession,
	): Promise<LoadResult<StateLoaderResult>> {
		const provinceMap = await this.defaultMapLoader.load(session);
		const stateCategories = await this.categoriesLoader.load(session);
		const resources = arrayToMap(
			(await this.resourcesLoader.load(session)).result,
			"name",
		);

		await this.fireOnProgressEvent(
			localize(
				"worldmap.progress.mapprovincestostates",
				"Mapping provinces to states...",
			),
		);

		const warnings = mergeInLoadResult(
			[stateCategories, ...fileResults],
			"warnings",
		);
		const { provinces, width, height } = provinceMap.result;

		const states = flatMap(fileResults, (c) => c.result);

		const { sorted, badId } = sortRegionItems(states, stateKind, warnings);
		const { filled: filledStates, badCount: badStatesCount } = fillRegions(
			sorted,
			badId,
			"provinces",
			provinces,
			width,
			stateKind,
			warnings,
			(state) => {
				warnIfStateTooLarge(state, width, height, warnings);
				validateStateReferences(
					state,
					stateCategories.result,
					resources,
					warnings,
				);
			},
		);

		validateProvinceInState(provinces, filledStates, badStatesCount, warnings);

		return {
			result: {
				states: filledStates,
				badStatesCount,
			},
			dependencies: [this.folder + "/*", ...stateCategories.dependencies],
			warnings,
		};
	}
}

class StateCategoriesLoader extends FolderLoader<
	Record<string, StateCategory>,
	StateCategory[]
> {
	constructor() {
		super(
			"common/state_category",
			worldMapFileLoader("StateCategoryLoader", loadStateCategory),
		);
	}

	protected override async loadImpl(
		session: LoaderSession,
	): Promise<LoadResult<Record<string, StateCategory>>> {
		await this.fireOnProgressEvent(
			localize(
				"worldmap.progress.loadstatecategories",
				"Loading state categories...",
			),
		);
		return super.loadImpl(session);
	}

	protected async mergeLoadedFiles(
		fileResults: LoadResult<StateCategory[]>[],
	): Promise<LoadResult<Record<string, StateCategory>>> {
		const warnings = mergeInLoadResult(fileResults, "warnings");
		const categories: Record<string, StateCategory> = {};

		fileResults.forEach((result) =>
			result.result.forEach((category) => {
				const existingCategory = categories[category.name];
				if (existingCategory) {
					warnings.push({
						source: [{ type: "statecategory", name: category.name }],
						relatedFiles: [category.file, existingCategory.file],
						text: localize(
							"worldmap.warnings.statecategoryconflict",
							'There\'re multiple state categories have name "{0}".',
							category.name,
						),
					});
				}

				categories[category.name] = category;
			}),
		);

		return {
			result: categories,
			dependencies: [this.folder + "/*"],
			warnings,
		};
	}

	public override toString() {
		return `[StateCategoriesLoader]`;
	}
}

async function loadState(
	stateFile: string,
	globalWarnings: WorldMapWarning[],
): Promise<StateNoBoundingBox[]> {
	try {
		const data = await readFileFromModOrHOI4AsJson<StateFile>(
			stateFile,
			stateFileSchema,
		);
		const result: StateNoBoundingBox[] = [];

		for (const state of data.state) {
			const warnings: string[] = [];
			const id = state.id
				? state.id
				: (warnings.push(
						localize(
							"worldmap.warnings.statenoid",
							"A state in {0} doesn't have id field.",
							stateFile,
						),
					),
					-1);
			const name = state.name
				? state.name
				: (warnings.push(
						localize(
							"worldmap.warnings.statenoname",
							"The state doesn't have name field.",
						),
					),
					"");
			const manpower = state.manpower ?? 0;
			const category = state.state_category
				? state.state_category
				: (warnings.push(
						localize(
							"worldmap.warnings.statenocategory",
							"The state doesn't have category field.",
						),
					),
					"");
			const owner = state.history?.owner;
			const provinces = state.provinces._values.map((v) => parseInt(v, 10));
			const cores =
				state.history?.add_core_of
					.map((v) => v)
					.filter(
						(v, i, a): v is string => v !== undefined && i === a.indexOf(v),
					) ?? [];
			const impassable = state.impassable ?? false;
			const impassableIgnoredLinks =
				state.impassable_ignored_links?._values.map((v) => parseInt(v, 10)) ??
				[];
			const victoryPointsArray =
				state.history?.victory_points
					.filter((v) => v._values.length >= 2)
					.map(
						(v) =>
							v._values.slice(0, 2).map((v) => parseInt(v, 10)) as [
								number,
								number,
							],
					) ?? [];
			const victoryPoints = arrayToMap(victoryPointsArray, "0", (v) => v[1]);
			const resources = arrayToMap(
				Object.values(state.resources._map),
				"_key",
				(v) => v._value,
			);

			if (provinces.length === 0) {
				globalWarnings.push({
					source: [{ type: "state", id }],
					relatedFiles: [stateFile],
					text: localize(
						"worldmap.warnings.statenoprovinces",
						'State {0} in "{1}" doesn\'t have provinces.',
						id,
						stateFile,
					),
				});
			}

			for (const vpPair of victoryPointsArray) {
				if (!provinces.includes(vpPair[0])) {
					warnings.push(
						localize(
							"worldmap.warnings.provincenothere",
							"Province {0} not included in this state. But victory points defined here.",
							vpPair[0],
						),
					);
				}
			}

			globalWarnings.push(
				...warnings.map<WorldMapWarning>((warning) => ({
					source: [{ type: "state", id }],
					relatedFiles: [stateFile],
					text: warning,
				})),
			);

			result.push({
				id,
				name,
				manpower,
				category,
				owner,
				provinces,
				cores,
				impassable,
				impassableIgnoredLinks,
				victoryPoints,
				resources,
				file: stateFile,
				token: state._token ?? null,
			});
		}

		return result;
	} catch (e) {
		error(e);
		return [];
	}
}

export function sortStates(
	states: StateNoBoundingBox[],
	warnings: WorldMapWarning[],
): { sortedStates: StateNoBoundingBox[]; badStateId: number } {
	const { sorted, badId } = sortRegionItems(states, stateKind, warnings);
	return {
		sortedStates: sorted,
		badStateId: badId,
	};
}

export function calculateStateBoundingBox(
	noBoundingBoxState: StateNoBoundingBox,
	provinces: (Province | undefined | null)[],
	width: number,
	height: number,
	warnings: WorldMapWarning[],
): State {
	const state = calculateRegionBoundingBox(
		noBoundingBoxState,
		"provinces",
		provinces,
		width,
		stateKind,
		warnings,
	);
	warnIfStateTooLarge(state, width, height, warnings);
	return state;
}

function warnIfStateTooLarge(
	state: State,
	width: number,
	height: number,
	warnings: WorldMapWarning[],
): void {
	if (state.boundingBox.w > width / 2 || state.boundingBox.h > height / 2) {
		warnings.push({
			source: [{ type: "state", id: state.id }],
			relatedFiles: [state.file],
			text: localize(
				"worldmap.warnings.statetoolarge",
				"State {0} is too large: {1}x{2}.",
				state.id,
				state.boundingBox.w,
				state.boundingBox.h,
			),
		});
	}
}

export function validateStateReferences(
	state: State,
	stateCategories: Record<string, StateCategory>,
	resources: Record<string, Resource>,
	warnings: WorldMapWarning[],
): void {
	if (!(state.category in stateCategories)) {
		warnings.push({
			source: [{ type: "state", id: state.id }],
			relatedFiles: [state.file],
			text: localize(
				"worldmap.warnings.statecategorynotexist",
				"State category of state {0} is not defined: {1}.",
				state.id,
				state.category,
			),
		});
	}

	for (const key of Object.keys(state.resources)) {
		if (state.resources[key] !== undefined && !(key in resources)) {
			warnings.push({
				source: [{ type: "state", id: state.id }],
				relatedFiles: [state.file],
				text: localize(
					"worldmap.warnings.resourcenotexist",
					"Resource {0} used in state {1} is not defined.",
					key,
					state.id,
				),
			});
		}
	}
}

export function validateProvinceInState(
	provinces: (Province | undefined | null)[],
	states: (State | undefined | null)[],
	badStatesCount: number,
	warnings: WorldMapWarning[],
) {
	const provinceToState: Record<number, number> = {};

	for (let i = -badStatesCount; i < states.length; i++) {
		const state = states[i];
		if (!state) {
			continue;
		}

		state.provinces.forEach((p) => {
			const province = provinces[p];
			if (provinceToState[p] !== undefined) {
				const existingState = states[provinceToState[p]];
				if (!province || !existingState) {
					return;
				}

				warnings.push({
					source: [
						...[state.id, provinceToState[p]].map<WorldMapWarningSource>(
							(id) => ({ type: "state", id }),
						),
						{ type: "province", id: p, color: province.color },
					],
					relatedFiles: [state.file, existingState.file],
					text: localize(
						"worldmap.warnings.provinceinmultistates",
						"Province {0} exists in multiple states: {1}, {2}.",
						p,
						provinceToState[p],
						state.id,
					),
				});
			} else {
				provinceToState[p] = state.id;
			}

			if (province?.type === "sea") {
				warnings.push({
					source: [
						{ type: "state", id: state.id },
						{ type: "province", id: p, color: province.color },
					],
					relatedFiles: [state.file],
					text: localize(
						"worldmap.warnings.statehassea",
						"Sea province {0} shouldn't belong to a state.",
						p,
					),
				});
			}
		});
	}
}

async function loadStateCategory(
	file: string,
	_warning: WorldMapWarning[],
): Promise<StateCategory[]> {
	try {
		const data = await readFileFromModOrHOI4AsJson<StateCategoryFile>(
			file,
			stateCategoryFileSchema,
		);
		const result: StateCategory[] = [];

		for (const categories of Object.values(data.state_categories._map)) {
			const name = categories._key;
			const color = convertColor(categories._value.color);

			result.push({ name, color, file });
		}

		return result;
	} catch (e) {
		error(e);
		return [];
	}
}
