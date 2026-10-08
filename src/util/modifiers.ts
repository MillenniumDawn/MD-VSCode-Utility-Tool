import { Node } from "../hoiformat/hoiparser";
import uniq from "lodash/uniq";
import {
	getDescriptorModifierFormatFiles,
	getFilePathFromModOrHOI4,
	listFilesFromModOrHOI4,
	parseHoi4FileCached,
} from "./fileloader";
import { getLocalisedTextQuick } from "./localisationIndex";
import { getFlags } from "./featureflags";
import { isSymbolNode } from "../hoiformat/schema";
import { debug } from "./debug";
import { Logger } from "./logger";
import { getConfiguration } from "./vsccommon";
import { ModifierPair, ModifierLine, ModifierTone } from "../previewdef/sharedpayload";

/*
 * Turning `stability_factor = -0.1` into "Stability: -10.0%" in red.
 *
 * Two things have to be worked out: what the modifier is called, and how its number reads. Neither
 * is written down in one place.
 *
 * The name has two conventions living side by side. A modifier the game itself defines is localised
 * under MODIFIER_<KEY IN CAPITALS> -- MODIFIER_STABILITY_FACTOR is "Stability". A modifier a mod
 * defines in common/modifier_definitions is localised under its own token, so
 * productivity_growth_modifier is "Monthly Productivity Growth". Both are tried, in that order.
 *
 * The number is the harder half. common/modifier_definitions gives value_type, precision, postfix
 * and color_type for every modifier a mod defines, and those are used exactly as written. The
 * modifiers the game defines itself have no such file -- the game holds their formatting
 * internally, and it is not readable from the game files at all.
 *
 * So for those this module guesses: a _factor suffix reads as a percentage, everything else as a
 * plain number. That is right for the large majority and wrong for a minority, and there is no way
 * to be exactly right without shipping a copy of a table only Paradox has. Where a base-game
 * modifier guesses wrong, add it to builtinOverrides below -- that is what the table is for, and a fix
 * is one line. Where only one mod needs a different format, that mod names a format file in the
 * modifierFormatFiles setting or a `modifier_format_files = { }` list in its .mod file instead.
 */

export interface ModifierDefinition {
	valueType: "number" | "percentage" | "percentage_in_hundred" | "yes_no";
	precision: number;
	colorType: ModifierTone;
	postfix: "none" | "days" | "hours" | "daily";
}

export type ModifierDefinitions = Record<string, ModifierDefinition>;

const modifierDefinitionsDir = "common/modifier_definitions";

// Game modifiers the _factor rule gets wrong: every one of these is written as a fraction and shown
// as a percentage, without the suffix that would give it away. Chosen by going through what the base
// game and Millennium Dawn actually write, rather than by transcribing the game's table -- this is
// the exception list, not a second copy of it. The audit, run in the game install and in the mod:
//
//   grep -rhoE "^[[:space:]]*[a-z_][a-z0-9_]*[[:space:]]*=[[:space:]]*-?[0-9]*\.[0-9]+" \
//       common/ideas common/country_leader common/unit_leader common/scientist_traits common/decisions \
//     | sed -E 's/^[[:space:]]*([a-z0-9_]+).*/\1/' | grep -v "_factor$" | sort | uniq -c | sort -rn
//
// lists every key written with a fraction; the ones below are those the game shows as a percentage,
// checked against documentation/modifiers_documentation.md to be modifiers at all. A modifier only
// one mod needs formatted differently belongs in that mod's format file, not here.
//
// Colour is not set here: which direction is good comes from lowerIsBetterKeys and the suffix list
// below, and a color_type only decides anything when a mod wrote one in common/modifier_definitions.
const builtinOverrides: Record<string, Partial<ModifierDefinition>> = {
	industrial_capacity_factory: { valueType: "percentage" },
	industrial_capacity_dockyard: { valueType: "percentage" },
	monthly_population: { valueType: "percentage" },
	conscription: { valueType: "percentage" },
	stability_weekly: { valueType: "percentage" },
	war_support_weekly: { valueType: "percentage" },
	min_export: { valueType: "percentage" },
	planning_speed: { valueType: "percentage" },
	surrender_limit: { valueType: "percentage" },
	send_volunteers_tension: { valueType: "percentage" },
	foreign_subversive_activites: { valueType: "percentage" },
	justify_war_goal_time: { valueType: "percentage" },
	research_sharing_per_country_bonus: { valueType: "percentage" },
	non_core_manpower: { valueType: "percentage" },
	mobilization_speed: { valueType: "percentage" },
	max_surrender_limit_offset: { valueType: "percentage" },
	weekly_casualties_war_support: { valueType: "percentage" },
	weekly_bombing_war_support: { valueType: "percentage" },
	weekly_convoys_war_support: { valueType: "percentage" },
	consumer_goods_expected_value: { valueType: "percentage" },
	command_power_gain_mult: { valueType: "percentage" },
	max_command_power_mult: { valueType: "percentage" },
	enemy_justify_war_goal_time: { valueType: "percentage" },
	generate_wargoal_tension: { valueType: "percentage" },
	join_faction_tension: { valueType: "percentage" },
	guarantee_tension: { valueType: "percentage" },
	lend_lease_tension: { valueType: "percentage" },
	request_lease_tension: { valueType: "percentage" },
	guarantee_cost: { valueType: "percentage" },
	license_purchase_cost: { valueType: "percentage" },
	license_air_purchase_cost: { valueType: "percentage" },
	license_production_speed: { valueType: "percentage" },
	license_tech_difference_speed: { valueType: "percentage" },
	refit_speed: { valueType: "percentage" },
	refit_ic_cost: { valueType: "percentage" },
	equipment_conversion_speed: { valueType: "percentage" },
	land_equipment_upgrade_xp_cost: { valueType: "percentage" },
	military_industrial_organization_funds_gain: { valueType: "percentage" },
	military_industrial_organization_research_bonus: { valueType: "percentage" },
	military_industrial_organization_design_team_assign_cost: { valueType: "percentage" },
	military_industrial_organization_design_team_change_cost: { valueType: "percentage" },
	military_industrial_organization_industrial_manufacturer_assign_cost: { valueType: "percentage" },
	military_industrial_organization_size_up_requirement: { valueType: "percentage" },
	// Resistance and compliance in the states we occupy and, for the _on_our_occupied_states ones,
	// in ours that someone else occupies.
	resistance_target: { valueType: "percentage" },
	resistance_growth: { valueType: "percentage" },
	resistance_activity: { valueType: "percentage" },
	resistance_decay: { valueType: "percentage" },
	resistance_damage_to_garrison: { valueType: "percentage" },
	resistance_garrison_penetration_chance: { valueType: "percentage" },
	compliance_growth: { valueType: "percentage" },
	resistance_target_on_our_occupied_states: { valueType: "percentage" },
	resistance_growth_on_our_occupied_states: { valueType: "percentage" },
	resistance_damage_to_garrison_on_our_occupied_states: { valueType: "percentage" },
	compliance_growth_on_our_occupied_states: { valueType: "percentage" },
	// Intelligence.
	intelligence_agency_defense: { valueType: "percentage" },
	agency_upgrade_time: { valueType: "percentage" },
	subversive_activites_upkeep: { valueType: "percentage" },
	// Land combat and leaders.
	army_org_regain: { valueType: "percentage" },
	attrition: { valueType: "percentage" },
	land_reinforce_rate: { valueType: "percentage" },
	max_planning: { valueType: "percentage" },
	coordination_bonus: { valueType: "percentage" },
	org_loss_when_moving: { valueType: "percentage" },
	pocket_penalty: { valueType: "percentage" },
	special_forces_cap: { valueType: "percentage" },
	supply_node_range: { valueType: "percentage" },
	critical_receive_chance: { valueType: "percentage" },
	cas_damage_reduction: { valueType: "percentage" },
	// Naval.
	naval_coordination: { valueType: "percentage" },
	naval_detection: { valueType: "percentage" },
	naval_hit_chance: { valueType: "percentage" },
	naval_retreat_chance: { valueType: "percentage" },
	naval_retreat_speed: { valueType: "percentage" },
	naval_accidents_chance: { valueType: "percentage" },
	naval_invasion_penalty: { valueType: "percentage" },
	naval_invasion_prep_speed: { valueType: "percentage" },
	screening_efficiency: { valueType: "percentage" },
	convoy_escort_efficiency: { valueType: "percentage" },
	convoy_retreat_speed: { valueType: "percentage" },
	amphibious_invasion: { valueType: "percentage" },
	shore_bombardment_bonus: { valueType: "percentage" },
	spotting_chance: { valueType: "percentage" },
	positioning: { valueType: "percentage" },
	// Air.
	air_mission_efficiency: { valueType: "percentage" },
	air_superiority_efficiency: { valueType: "percentage" },
	air_intercept_efficiency: { valueType: "percentage" },
	air_cas_efficiency: { valueType: "percentage" },
	fighter_sortie_efficiency: { valueType: "percentage" },
	air_night_penalty: { valueType: "percentage" },
	air_weather_penalty: { valueType: "percentage" },
	// Counted in divisions, so the two decimals a fraction would want are noise.
	send_volunteer_size: { valueType: "number", precision: 0 },
};

// Modifiers where a smaller number is the better outcome, so the sign alone would colour them
// backwards. Matched as suffixes against the key. Audited, like builtinOverrides, over the base
// game and Millennium Dawn.
const lowerIsBetterSuffixes = [
	"_cost_factor",
	"_cost_modifier",
	"_consumption_factor",
	"_damage_factor",
	"_time_factor",
	"_price_factor",
	"_penalty",
	"_penalty_factor",
	"_risk",
	"_drift_defence_factor",
	"_purchase_cost",
	"_assign_cost",
	"_change_cost",
	"_xp_cost",
	"_ic_cost",
	"_upkeep",
];

// Modifiers where a smaller number is better and the suffix rule does not reach them.
const lowerIsBetterKeys = new Set([
	"ai_badass_factor",
	"consumer_goods_factor",
	"conscription_factor",
	"training_time_factor",
	"experience_loss_factor",
	"supply_consumption_factor",
	"justify_war_goal_time",
	"required_garrison_factor",
	"weekly_manpower",
	// Tension our own actions add to the world.
	"send_volunteers_tension",
	"generate_wargoal_tension",
	"join_faction_tension",
	"guarantee_tension",
	"lend_lease_tension",
	"request_lease_tension",
	"political_power_cost",
	"guarantee_cost",
	"agency_upgrade_time",
	"foreign_subversive_activites",
	"military_industrial_organization_size_up_requirement",
	"minimum_training_level",
	"attrition",
	"org_loss_when_moving",
	"critical_receive_chance",
	"naval_accidents_chance",
	// Resistance in the states we occupy. The _on_our_occupied_states ones work against whoever
	// occupies ours, so for them more is better and the sign rule already reads the right way --
	// except compliance, which helps the occupier.
	"resistance_target",
	"resistance_growth",
	"resistance_activity",
	"resistance_damage_to_garrison",
	"resistance_garrison_penetration_chance",
	"compliance_growth_on_our_occupied_states",
]);

const modifierFormatFilesSetting = "mdHoi4Utilities.modifierFormatFiles";

/**
 * Definition files, format files, and configured folders with a wildcard for new files.
 * Preview dependencies use the wildcard to refresh when a folder gains a format file.
 */
export async function listModifierDefinitionFiles(): Promise<string[]> {
	const [definitions, formats, entries] = await Promise.all([
		listDefinitionDirectoryFiles(), listModifierFormatFiles(), modifierFormatEntries(),
	]);
	const folders = entries
		.filter(({ entry }) => typeof entry === "string")
		.map(({ entry }) => entry.trim().replace(/\\+/g, "/").replace(/\/+$/, ""))
		.filter((entry) => entry !== "" && !entry.toLowerCase().endsWith(".txt"))
		.map((entry) => `${entry}/*`);
	return uniq([...definitions, ...formats, ...folders]);
}

async function listDefinitionDirectoryFiles(): Promise<string[]> {
	try {
		return (await listFilesFromModOrHOI4(modifierDefinitionsDir))
			.filter((file) => file.toLowerCase().endsWith(".txt"))
			.map((file) => `${modifierDefinitionsDir}/${file}`);
	} catch (e) {
		// A workspace with no modifier_definitions folder at all is normal, not an error: every
		// modifier then falls back to the heuristic.
		debug("No modifier definitions to read", e);
		return [];
	}
}

/**
 * The mod's format files, in order: what the modifierFormatFiles setting names, then what the
 * working mod's (and its parent mods') descriptors name in `modifier_format_files`. An entry that is
 * not a .txt file is a folder scanned for them. An entry that names nothing is reported, naming
 * where it was configured, and skipped.
 */
async function modifierFormatEntries(): Promise<{ entry: string; source: string }[]> {
	return [
		...(getConfiguration().modifierFormatFiles ?? []).map((entry) => ({ entry, source: modifierFormatFilesSetting })),
		...(await getDescriptorModifierFormatFiles()).map((entry) => ({ entry, source: "modifier_format_files in the .mod file" })),
	];
}

async function listModifierFormatFiles(): Promise<string[]> {
	const configured = await modifierFormatEntries();
	const files: string[] = [];
	for (const { entry, source } of configured) {
		if (typeof entry !== "string" || entry.trim() === "") {
			continue;
		}
		const path = entry.trim().replace(/\\+/g, "/").replace(/\/+$/, "");
		if (path.toLowerCase().endsWith(".txt")) {
			if (await getFilePathFromModOrHOI4(path)) {
				files.push(path);
			} else {
				Logger.warn(`${source}: "${entry}" is not in the mod, its parent mods or the game install -- check the path`);
			}
			continue;
		}

		let found: string[] = [];
		try {
			found = (await listFilesFromModOrHOI4(path))
				.filter((file) => file.toLowerCase().endsWith(".txt"))
				.map((file) => `${path}/${file}`);
		} catch (e) {
			debug(`Cannot list modifier format folder ${path}`, e);
		}
		if (found.length === 0) {
			Logger.warn(`${source}: "${entry}" contains no .txt files in the mod, its parent mods or the game install -- check the path`);
		}
		files.push(...found);
	}
	return uniq(files);
}

/**
 * Reads every `common/modifier_definitions` file the mod and the game between them provide, then the
 * mod's format files. A mod file with the same modifier as the game's wins, because
 * listFilesFromModOrHOI4 lists the mod's copy and the later assignment overwrites. A format file
 * entry changes only the fields it writes, over whatever the modifier would otherwise resolve to.
 */
export async function loadModifierDefinitions(): Promise<ModifierDefinitions> {
	const result: ModifierDefinitions = {};
	const [definitionFiles, formatFiles] = await Promise.all([
		listDefinitionDirectoryFiles(),
		listModifierFormatFiles(),
	]);

	for (const path of definitionFiles) {
		try {
			const node = await parseHoi4FileCached(path);
			Object.assign(result, readModifierDefinitions(node));
		} catch (e) {
			// One unparseable file must not cost the preview every other definition.
			debug(`Failed to read modifier definitions from ${path}`, e);
		}
	}

	for (const path of formatFiles) {
		try {
			const node = await parseHoi4FileCached(path);
			for (const [key, format] of Object.entries(readModifierFormats(node))) {
				result[key] = { ...resolveDefinition(key, result), ...format };
			}
		} catch (e) {
			debug(`Failed to read modifier formats from ${path}`, e);
		}
	}

	return result;
}

export function readModifierDefinitions(node: Node): ModifierDefinitions {
	const result: ModifierDefinitions = {};
	for (const [key, format] of Object.entries(readModifierFormats(node))) {
		result[key] = {
			valueType: "number",
			precision: 2,
			colorType: "bad",
			postfix: "none",
			...format,
		};
	}
	return result;
}

/**
 * The fields each block of a `common/modifier_definitions`-style file writes, and only those: a field
 * left out, or given a value the game does not accept, is absent rather than defaulted.
 */
export function readModifierFormats(node: Node): Record<string, Partial<ModifierDefinition>> {
	const result: Record<string, Partial<ModifierDefinition>> = {};
	if (!Array.isArray(node.value)) {
		return result;
	}

	for (const child of node.value) {
		if (!child.name || !Array.isArray(child.value)) {
			continue;
		}

		const definition: Partial<ModifierDefinition> = {};

		for (const field of child.value) {
			const name = field.name?.toLowerCase();
			const value = symbolOf(field.value);
			if (!name || value === undefined) {
				continue;
			}

			switch (name) {
				case "value_type":
					if (
						value === "number" ||
						value === "percentage" ||
						value === "percentage_in_hundred" ||
						value === "yes_no"
					) {
						definition.valueType = value;
					}
					break;
				case "precision": {
					const precision = Number(value);
					if (Number.isFinite(precision)) {
						definition.precision = precision;
					}
					break;
				}
				case "color_type":
					if (value === "good" || value === "bad" || value === "neutral") {
						definition.colorType = value;
					}
					break;
				case "postfix":
					if (value === "none" || value === "days" || value === "hours" || value === "daily") {
						definition.postfix = value;
					}
					break;
			}
		}

		result[child.name] = definition;
	}

	return result;
}

/**
 * The formatting rule for one modifier: the definition the mod wrote if there is one, otherwise the
 * guess described at the top of this file.
 */
export function resolveDefinition(
	key: string,
	definitions: ModifierDefinitions,
): ModifierDefinition {
	const defined = definitions[key];
	if (defined) {
		return defined;
	}

	const guessed: ModifierDefinition = {
		valueType: key.endsWith("_factor") ? "percentage" : "number",
		precision: 2,
		colorType: "neutral",
		postfix: "none",
	};

	return { ...guessed, ...builtinOverrides[key] };
}

/**
 * The two localisation conventions, tried in order. Falls back to the key made readable, so a
 * modifier nothing localises still says something rather than showing a raw token.
 */
async function localiseModifierName(key: string): Promise<string> {
	if (!getFlags().localisationIndex) {
		return key;
	}

	const upper = `MODIFIER_${key.toUpperCase()}`;
	const fromUpper = await getLocalisedTextQuick(upper);
	if (fromUpper !== undefined && fromUpper !== upper) {
		return fromUpper;
	}

	const fromKey = await getLocalisedTextQuick(key);
	if (fromKey !== undefined && fromKey !== key) {
		return fromKey;
	}

	return key;
}

export function humaniseKey(key: string): string {
	return key
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Formats one modifier's value. Exported on its own so the tests can pin the numbers without
 * standing up a localisation index.
 */
export function formatModifierValue(
	value: number | string | boolean,
	definition: ModifierDefinition,
): string {
	if (typeof value === "boolean") {
		return value ? "yes" : "no";
	}

	// A `@constant` or a variable: there is no number to scale, so it is shown as written.
	if (typeof value === "string") {
		return value;
	}

	if (definition.valueType === "yes_no") {
		return value !== 0 ? "yes" : "no";
	}

	const scaled =
		definition.valueType === "percentage"
			? value * 100
			: definition.valueType === "percentage_in_hundred"
				? value
				: value;
	const suffix =
		definition.valueType === "percentage" || definition.valueType === "percentage_in_hundred"
			? "%"
			: postfixText(definition.postfix);

	const precision = Math.max(0, Math.min(10, definition.precision));
	const sign = scaled > 0 ? "+" : "";
	return `${sign}${trimZeroes(scaled.toFixed(precision))}${suffix}`;
}

function postfixText(postfix: ModifierDefinition["postfix"]): string {
	switch (postfix) {
		case "days":
			return " days";
		case "hours":
			return " hours";
		case "daily":
			return " daily";
		default:
			return "";
	}
}

// 0.10 reads as 0.1 and 2.00 as 2, but 0 stays 0 rather than becoming "".
function trimZeroes(text: string): string {
	if (!text.includes(".")) {
		return text;
	}
	return text.replace(/\.?0+$/, "");
}

export function toneFor(
	key: string,
	value: number | string | boolean,
	definition: ModifierDefinition,
	fromDefinitions: boolean,
): ModifierTone {
	if (typeof value !== "number" || value === 0) {
		return "neutral";
	}

	// A mod that wrote color_type meant it: it says which direction is good, and the sign then says
	// whether this value goes that way.
	if (fromDefinitions && definition.colorType !== "neutral") {
		const goodDirection = definition.colorType === "good" ? 1 : -1;
		return Math.sign(value) === goodDirection ? "good" : "bad";
	}

	const lowerIsBetter =
		lowerIsBetterKeys.has(key) || lowerIsBetterSuffixes.some((s) => key.endsWith(s));
	const positiveIsGood = !lowerIsBetter;
	return value > 0 === positiveIsGood ? "good" : "bad";
}

/**
 * Formats a whole block of modifiers into the lines the webview draws. Order follows the file, so
 * the payload stays deterministic.
 */
export async function formatModifiers(
	pairs: ModifierPair[],
	definitions: ModifierDefinitions,
): Promise<ModifierLine[]> {
	return Promise.all(
		pairs.map(async ({ key, value }) => {
			const definition = resolveDefinition(key, definitions);
			const localised = await localiseModifierName(key);
			return {
				key,
				name: localised === key ? humaniseKey(key) : localised,
				value: formatModifierValue(value, definition),
				tone: toneFor(key, value, definition, definitions[key] !== undefined),
			};
		}),
	);
}

/**
 * A `research_bonus` block is not a list of modifiers: its keys are research categories, and its
 * values are always factors, so `CAT_fuel_oil = 0.05` reads as +5% however the key is spelled.
 *
 * The names follow the categories' own convention too -- a category is localised under its bare
 * token, `CAT_fuel_oil` and `armor` alike -- so the MODIFIER_ lookup does not apply here and is not
 * tried.
 */
export async function formatResearchBonuses(
	pairs: ModifierPair[],
): Promise<ModifierLine[]> {
	const definition: ModifierDefinition = {
		valueType: "percentage",
		precision: 2,
		colorType: "good",
		postfix: "none",
	};

	return Promise.all(
		pairs.map(async ({ key, value }) => {
			const localised = getFlags().localisationIndex ? await getLocalisedTextQuick(key) : undefined;
			return {
				key,
				name: localised && localised !== key ? localised : humaniseKey(key),
				value: formatModifierValue(value, definition),
				// More research speed is better, whatever the category.
				tone: toneFor(key, value, definition, true),
			};
		}),
	);
}

function symbolOf(value: Node["value"]): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		return value.toString();
	}
	if (isSymbolNode(value)) {
		return value.name;
	}
	return undefined;
}
