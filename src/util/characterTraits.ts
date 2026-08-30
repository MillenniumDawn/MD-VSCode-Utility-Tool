import { Node, Token } from "../hoiformat/hoiparser";
import { listFilesFromModOrHOI4, parseHoi4FileCached } from "./fileloader";
import { childNodes, readModifierPairsFromNode, readScalar } from "../hoiformat/rawblock";
import { ModifierPair } from "../previewdef/sharedpayload";
import { debug } from "./debug";

/*
 * Turning `traits = { army_chief_planning_3 }` into the modifiers that trait actually grants.
 *
 * A character carries no modifiers of its own. Everything it does to a country is written in the
 * traits it names, and those live in three directories that spell a trait three different ways:
 *
 *   common/country_leader/    politician and advisor traits, wrapped in `leader_traits = { }`.
 *                             Millennium Dawn writes the modifiers FLAT at the trait's top level;
 *                             the base game wraps them in `modifier = { }`. Both forms occur, often
 *                             in the same directory.
 *   common/unit_leader/       commander traits, also wrapped in `leader_traits = { }`, with
 *                             `modifier`, `non_shared_modifier` and the two per-role blocks, plus
 *                             flat skill fields of their own.
 *   common/scientist_traits/  no wrapper at all -- the traits are the file's own children.
 *
 * Two rules cover all three. The wrapper is found rather than assumed: a file that has a
 * `leader_traits` node contributes its children, and a file that does not contributes its own. And
 * a flat scalar is a modifier unless it is named in `structuralKeys` below -- which is what makes
 * MD's `army_chief_logistics_1 = { sprite = 6  experience_gain_army = 0.05 ... }` produce a
 * modifier line instead of nothing.
 *
 * Where that guesses wrong the symptom is a nonsense line on a card and the fix is one entry in
 * `structuralKeys`. That is the same trade, and the same remedy, as builtinOverrides in
 * util/modifiers.ts.
 */

export type TraitSource = "country_leader" | "unit_leader" | "scientist";

// A named run of pairs out of a trait: a `non_shared_modifier` block, a per-role block, or one
// equipment archetype. Formatted into a ModifierGroup by the payload builder, which is where the
// titles get localised.
export interface TraitModifierGroup {
	// The block's own key -- `non_shared_modifier`, `field_marshal_modifier` -- or, for an
	// equipment bonus, the archetype.
	title: string;
	modifiers: ModifierPair[];
}

export interface CharacterTrait {
	id: string;
	source: TraitSource;
	// `type = land`, or the braced form `type = { land navy }` a few Millennium Dawn traits use.
	types: string[];
	traitType: string | undefined;
	modifiers: ModifierPair[];
	// `attack_skill = 1` and friends: a commander trait grants skill points as well as modifiers,
	// and they are not modifiers, so they are drawn as their own run.
	skillBonuses: ModifierPair[];
	groups: TraitModifierGroup[];
	researchBonuses: ModifierPair[];
	file: string;
	token: Token | undefined;
}

export type CharacterTraits = Record<string, CharacterTrait>;

const traitDirectories: { path: string; source: TraitSource }[] = [
	{ path: "common/country_leader", source: "country_leader" },
	{ path: "common/unit_leader", source: "unit_leader" },
	{ path: "common/scientist_traits", source: "scientist" },
];

// Blocks read for their structure rather than their contents. Every one of these is either handled
// explicitly below or deliberately dropped, and naming them here is what keeps their insides out of
// the flat-scalar sweep -- most importantly `ai_will_do` and `new_commander_weight`, which contain
// `modifier = { factor = 3 ... }` blocks that are weights on an AI decision, not effects on a
// country.
const structuralKeys = new Set([
	"modifier",
	"non_shared_modifier",
	"corps_commander_modifier",
	"field_marshal_modifier",
	"equipment_bonus",
	"targeted_modifier",
	"research_bonus",
	"sub_unit_modifiers",
	"trait_xp_factor",
	"ai_will_do",
	"new_commander_weight",
	"gain_xp",
	"gain_xp_leader",
	"allowed",
	"prerequisites",
	"daily_effect",
	"on_add",
	"on_remove",
	"specialization",
	// Scalars that describe the trait rather than what it does.
	"random",
	"sprite",
	"icon",
	"name",
	"desc",
	"type",
	"trait_type",
	"cost",
	"gui_row",
	"gui_column",
	"num_parents_needed",
	"parent",
	"mutually_exclusive",
	"enable_ability",
	"show_in_combat",
	"gain_xp_on_spotting",
	"override_effect_tooltip",
	"custom_effect_tooltip",
	"custom_prerequisite_tooltip",
	"custom_gain_xp_trigger_tooltip",
]);

// The per-role modifier blocks, in the order a card draws them.
const groupBlocks = [
	"non_shared_modifier",
	"corps_commander_modifier",
	"field_marshal_modifier",
];

// Skill fields a unit_leader trait grants, plus the `_factor` variants. Matched by suffix so
// `attack_skill` and `attack_skill_factor` both land here rather than in the modifier sweep, where
// they would be looked up under a MODIFIER_ key that does not exist.
const skillSuffixes = ["_skill", "_skill_factor"];

/**
 * Every trait the mod and the game between them define, by id. A mod file redefining a trait the
 * game ships wins, because listFilesFromModOrHOI4 lists the mod's copy and the later assignment
 * overwrites.
 *
 * Nothing is memoised here beyond what parseHoi4FileCached already holds, so a trait file the user
 * edits is picked up by the next render with no cache to invalidate. That is the same bargain
 * loadModifierDefinitions makes on every idea preview.
 */
export async function loadCharacterTraits(): Promise<CharacterTraits> {
	const result: CharacterTraits = {};

	for (const directory of traitDirectories) {
		let files: string[];
		try {
			files = await listFilesFromModOrHOI4(directory.path);
		} catch (e) {
			// A workspace with no such folder is normal, not an error: the traits it would have held
			// simply come back unknown, which the preview says out loud.
			debug(`No trait files in ${directory.path}`, e);
			continue;
		}

		for (const file of files) {
			if (!file.toLowerCase().endsWith(".txt")) {
				continue;
			}

			const path = `${directory.path}/${file}`;
			try {
				const node = await parseHoi4FileCached(path);
				Object.assign(result, readTraitFile(node, directory.source, path));
			} catch (e) {
				// One unparseable file must not cost the preview every other trait.
				debug(`Failed to read traits from ${path}`, e);
			}
		}
	}

	return result;
}

/**
 * The traits in one parsed file. Exported so the tests can pin the three wrapper shapes without a
 * workspace.
 */
export function readTraitFile(
	node: Node,
	source: TraitSource,
	file: string,
): CharacterTraits {
	const result: CharacterTraits = {};

	const wrappers = childNodes(node).filter(
		(child) => child.name?.toLowerCase() === "leader_traits",
	);

	// No `leader_traits` anywhere in the file means the traits are the file's own children, which
	// is how common/scientist_traits is written.
	const traitNodes =
		wrappers.length > 0 ? wrappers.flatMap(childNodes) : childNodes(node);

	for (const traitNode of traitNodes) {
		const trait = readTrait(traitNode, source, file);
		if (trait) {
			result[trait.id] = trait;
		}
	}

	return result;
}

function readTrait(
	node: Node,
	source: TraitSource,
	file: string,
): CharacterTrait | undefined {
	const id = node.name;
	if (!id || !Array.isArray(node.value)) {
		return undefined;
	}

	const trait: CharacterTrait = {
		id,
		source,
		types: [],
		traitType: undefined,
		modifiers: [],
		skillBonuses: [],
		groups: [],
		researchBonuses: [],
		file,
		token: node.nameToken ?? undefined,
	};

	for (const child of node.value) {
		const name = child.name?.toLowerCase();
		if (!name) {
			continue;
		}

		if (name === "type") {
			trait.types.push(...readTypes(child));
			continue;
		}

		if (name === "trait_type") {
			const value = readScalar(child.value);
			trait.traitType = typeof value === "string" ? value : undefined;
			continue;
		}

		if (name === "modifier") {
			trait.modifiers.push(...readModifierPairsFromNode(child));
			continue;
		}

		if (name === "research_bonus") {
			trait.researchBonuses.push(...readModifierPairsFromNode(child));
			continue;
		}

		if (groupBlocks.includes(name)) {
			pushGroup(trait.groups, name, readModifierPairsFromNode(child));
			continue;
		}

		if (name === "equipment_bonus") {
			// One group per archetype, so `heavy_tank_chassis` says which equipment the bonus is on
			// rather than the numbers floating loose.
			for (const archetype of childNodes(child)) {
				if (!archetype.name || !Array.isArray(archetype.value)) {
					continue;
				}
				pushGroup(
					trait.groups,
					archetype.name,
					readModifierPairsFromNode(archetype).filter(
						(pair) => pair.key.toLowerCase() !== "instant",
					),
				);
			}
			continue;
		}

		if (structuralKeys.has(name)) {
			continue;
		}

		// Nothing named it, so it is a flat scalar the mod wrote at the trait's top level. In
		// Millennium Dawn that is where nearly every politician and advisor modifier lives.
		if (Array.isArray(child.value)) {
			continue;
		}
		const value = readScalar(child.value);
		if (value === undefined) {
			continue;
		}
		if (skillSuffixes.some((suffix) => name.endsWith(suffix))) {
			trait.skillBonuses.push({ key: child.name as string, value });
		} else {
			trait.modifiers.push({ key: child.name as string, value });
		}
	}

	return trait;
}

// `type = land` and `type = { land navy }` both occur, sometimes in the same file.
function readTypes(node: Node): string[] {
	if (Array.isArray(node.value)) {
		return node.value
			.map((child) => child.name)
			.filter((name): name is string => name !== null);
	}
	const value = readScalar(node.value);
	return typeof value === "string" ? [value] : [];
}

function pushGroup(
	groups: TraitModifierGroup[],
	title: string,
	modifiers: ModifierPair[],
): void {
	if (modifiers.length === 0) {
		return;
	}
	groups.push({ title, modifiers });
}
