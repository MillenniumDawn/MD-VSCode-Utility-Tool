import { Node } from "../hoiformat/hoiparser";
import { listFilesFromModOrHOI4, parseHoi4FileCached } from "./fileloader";
import { getLocalisedTextQuick } from "./localisationIndex";
import { localisationIndex } from "./featureflags";
import { isSymbolNode } from "../hoiformat/schema";
import { debug } from "./debug";
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
 * to be exactly right without shipping a copy of a table only Paradox has. Where a known one guesses
 * wrong, add it to builtinOverrides below -- that is what the table is for, and a fix is one line.
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
// as a percentage, without the suffix that would give it away. Chosen by going through what
// Millennium Dawn's ideas actually use, most-used first, rather than by transcribing the game's
// table -- this is the exception list, not a second copy of it.
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
	// Counted in divisions, so the two decimals a fraction would want are noise.
	send_volunteer_size: { valueType: "number", precision: 0 },
};

// Modifiers where a smaller number is the better outcome, so the sign alone would colour them
// backwards. Matched as suffixes against the key.
const lowerIsBetterSuffixes = [
	"_cost_factor",
	"_cost_modifier",
	"_consumption_factor",
	"_damage_factor",
	"_time_factor",
	"_price_factor",
	"_penalty_factor",
	"_risk",
	"_drift_defence_factor",
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
]);

/**
 * Reads every `common/modifier_definitions` file the mod and the game between them provide. A mod
 * file with the same modifier as the game's wins, because listFilesFromModOrHOI4 lists the mod's
 * copy and the later assignment overwrites.
 */
export async function loadModifierDefinitions(): Promise<ModifierDefinitions> {
	const result: ModifierDefinitions = {};

	let files: string[];
	try {
		files = await listFilesFromModOrHOI4(modifierDefinitionsDir);
	} catch (e) {
		// A workspace with no modifier_definitions folder at all is normal, not an error: every
		// modifier then falls back to the heuristic.
		debug("No modifier definitions to read", e);
		return result;
	}

	for (const file of files) {
		if (!file.toLowerCase().endsWith(".txt")) {
			continue;
		}

		try {
			const node = await parseHoi4FileCached(`${modifierDefinitionsDir}/${file}`);
			Object.assign(result, readModifierDefinitions(node));
		} catch (e) {
			// One unparseable file must not cost the preview every other definition.
			debug(`Failed to read modifier definitions from ${file}`, e);
		}
	}

	return result;
}

export function readModifierDefinitions(node: Node): ModifierDefinitions {
	const result: ModifierDefinitions = {};
	if (!Array.isArray(node.value)) {
		return result;
	}

	for (const child of node.value) {
		if (!child.name || !Array.isArray(child.value)) {
			continue;
		}

		const definition: ModifierDefinition = {
			valueType: "number",
			precision: 2,
			colorType: "bad",
			postfix: "none",
		};

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
export async function localiseModifierName(key: string): Promise<string> {
	if (!localisationIndex) {
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
			const localised = localisationIndex ? await getLocalisedTextQuick(key) : undefined;
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
