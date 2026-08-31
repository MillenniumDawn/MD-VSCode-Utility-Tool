import { ConditionComplexExpr, ConditionItem, extractConditionValue } from "../../hoiformat/condition";
import { Node, Token } from "../../hoiformat/hoiparser";
import { Scope } from "../../hoiformat/scope";
import {
	Enum,
	Raw,
	SchemaDef,
	convertNodeToJson,
	readNodeAsString,
	readRawAsString,
} from "../../hoiformat/schema";
import {
	childNodes,
	hasContent,
	readModifierPairs,
	readScalar,
} from "../../hoiformat/rawblock";

// A characters file is `characters = { <character key> = { ... } }`: one level of keys the mod
// author chooses, wrapping a block whose own keys are fixed. The outer level is walked by hand for
// the same reason the ideas file is -- the key is the character's id and there is no schema that
// can name it -- and so is `portraits`, because the game lets the same category appear twice inside
// one block and a map would lose the first.
//
// Everything else is fixed and goes through convertNodeToJson: the character's own scalars, and
// each role block. One shared role schema covers every role kind, because the keys do not collide
// across them -- `ideology` only ever appears in a country_leader, `slot` only in an advisor -- and
// six near-identical schemas would be six places to keep in step.

export { ModifierPair } from "../sharedpayload";
import { ModifierPair } from "../sharedpayload";

export interface HOICharacterFile {
	characters: HOICharacter[];
	conditionExprs: ConditionItem[];
}

// The role blocks a character can carry. `operative` and `nuclear_scientist` are vanilla's and
// Millennium Dawn writes neither, but reading them costs nothing and a preview that silently drops
// a role is worse than one that shows an empty group.
export const characterRoleKinds = [
	"country_leader",
	"field_marshal",
	"corps_commander",
	"navy_leader",
	"advisor",
	"scientist",
	"operative",
	"nuclear_scientist",
] as const;

export type CharacterRoleKind = (typeof characterRoleKinds)[number];

const roleKindSet: Set<string> = new Set(characterRoleKinds);

// One `<category> = { <size> = <value> }` entry out of a `portraits` block. Kept as a flat list
// rather than a nested map because a block may name the same category twice --
// `army = { small = ... }` followed by `army = { large = ... }` is real, and merging into a map
// would drop whichever came first.
export interface PortraitRef {
	// army | civilian | navy
	category: string;
	size: string;
	// A mod-relative path such as `gfx/leaders/AFG/X.dds`, or a `GFX_` sprite name.
	value: string;
}

export interface HOICharacterRole {
	kind: CharacterRoleKind;
	traits: string[];
	// country_leader
	ideology: string | undefined;
	expire: string | undefined;
	// advisor
	slot: string | undefined;
	ideaToken: string | undefined;
	ledger: string | undefined;
	cost: number | undefined;
	removalCost: number | undefined;
	// `skill = 5`, `attack_skill = 4`, and the scientist's `skills = { specialization_air = 2 }`.
	// One list, because they read the same way on the card and the game spells them differently
	// only by role.
	skills: ModifierPair[];
	legacyId: number | undefined;
	// A role's own modifier block. Vanilla advisors write one; Millennium Dawn's never do, taking
	// everything through traits instead.
	modifiers: ModifierPair[];
	researchBonuses: ModifierPair[];
	// The explicit `desc = <key>` a country_leader can carry, in place of `<character>_desc`.
	descKey: string | undefined;
	allowed: ConditionComplexExpr;
	available: ConditionComplexExpr;
	visible: ConditionComplexExpr;
	hasOnAdd: boolean;
	hasOnRemove: boolean;
	token: Token | undefined;
}

export interface HOICharacter {
	id: string;
	// `name = "Ahmad Shah Massoud"` is a literal to print; `name = tony_abbott` is a key to look up.
	// The game tells them apart by whether the string resolves, so both are kept and the payload
	// builder decides.
	name: string | undefined;
	descKey: string;
	portraits: PortraitRef[];
	gender: string | undefined;
	roles: HOICharacterRole[];
	token: Token | undefined;
	file: string;
}

interface RoleDef {
	traits: Enum;
	ideology: Raw;
	desc: Raw;
	slot: Raw;
	idea_token: Raw;
	ledger: Raw;
	cost: number;
	removal_cost: number;
	legacy_id: number;
	skill: number;
	attack_skill: number;
	defense_skill: number;
	planning_skill: number;
	logistics_skill: number;
	maneuvering_skill: number;
	coordination_skill: number;
	skills: Raw;
	modifier: Raw;
	research_bonus: Raw;
	allowed: Raw;
	available: Raw;
	visible: Raw;
	on_add: Raw;
	on_remove: Raw;
	// Read but never walked. Naming it in the schema is what keeps the `modifier = { factor = 3 }`
	// weight blocks inside it out of `modifier` above: the converter only ever fills a field from a
	// direct child, so a nested one is sealed inside this raw.
	ai_will_do: Raw;
}

const roleSchema: SchemaDef<RoleDef> = {
	traits: "enum",
	// The token-like scalars are raw rather than "string" because the file writes them both quoted
	// and bare -- `desc = john_howard_desc` and `desc = "TUR_bulent_ecevit_desc"` -- and
	// readRawAsString reads either.
	ideology: "raw",
	desc: "raw",
	slot: "raw",
	idea_token: "raw",
	ledger: "raw",
	cost: "number",
	removal_cost: "number",
	legacy_id: "number",
	skill: "number",
	attack_skill: "number",
	defense_skill: "number",
	planning_skill: "number",
	logistics_skill: "number",
	maneuvering_skill: "number",
	coordination_skill: "number",
	skills: "raw",
	modifier: "raw",
	research_bonus: "raw",
	allowed: "raw",
	available: "raw",
	visible: "raw",
	on_add: "raw",
	on_remove: "raw",
	ai_will_do: "raw",
};

// The commander skill fields, in the order the game's tooltip lists them rather than the order the
// file happens to write them, so two commanders always read alike.
const skillFields: (keyof RoleDef)[] = [
	"skill",
	"attack_skill",
	"defense_skill",
	"planning_skill",
	"logistics_skill",
	"maneuvering_skill",
	"coordination_skill",
];

export function getCharactersFromFile(node: Node, filePath: string): HOICharacterFile {
	const conditionExprs: ConditionItem[] = [];
	const characters: HOICharacter[] = [];

	for (const charactersNode of childNodes(node)) {
		if (charactersNode.name?.toLowerCase() !== "characters") {
			continue;
		}

		for (const characterNode of childNodes(charactersNode)) {
			const character = getCharacter(characterNode, filePath, conditionExprs);
			if (character) {
				characters.push(character);
			}
		}
	}

	return { characters, conditionExprs };
}

function getCharacter(
	node: Node,
	filePath: string,
	conditionExprs: ConditionItem[],
): HOICharacter | undefined {
	const id = node.name;
	if (!id || !Array.isArray(node.value)) {
		return undefined;
	}

	const character: HOICharacter = {
		id,
		name: undefined,
		descKey: `${id}_desc`,
		portraits: [],
		gender: undefined,
		roles: [],
		token: node.nameToken ?? undefined,
		file: filePath,
	};

	for (const child of node.value) {
		const childName = child.name?.toLowerCase();
		if (!childName) {
			continue;
		}

		if (childName === "name") {
			character.name = readNodeAsString(child);
		} else if (childName === "gender") {
			character.gender = readNodeAsString(child);
		} else if (childName === "portraits") {
			readPortraits(child, character.portraits);
		} else if (roleKindSet.has(childName) && Array.isArray(child.value)) {
			character.roles.push(
				getRole(child, childName as CharacterRoleKind, conditionExprs),
			);
		}
	}

	// A country_leader's `desc` overrides the key the character would otherwise be described under.
	// Taken from the first role that names one, because a character has only ever one description.
	const explicit = character.roles.find((r) => r.descKey !== undefined)?.descKey;
	if (explicit !== undefined) {
		character.descKey = explicit;
	}

	return character;
}

// Appends every `<size> = <value>` under every category. Repeated categories append rather than
// replace: `TUR_ercument_tatlioglu` writes two separate `army = { }` blocks and both hold a
// portrait the game uses.
function readPortraits(node: Node, into: PortraitRef[]): void {
	for (const categoryNode of childNodes(node)) {
		const category = categoryNode.name?.toLowerCase();
		if (!category || !Array.isArray(categoryNode.value)) {
			continue;
		}

		for (const sizeNode of categoryNode.value) {
			const size = sizeNode.name?.toLowerCase();
			const value = readNodeAsString(sizeNode);
			if (size && value) {
				into.push({ category, size, value });
			}
		}
	}
}

function getRole(
	node: Node,
	kind: CharacterRoleKind,
	conditionExprs: ConditionItem[],
): HOICharacterRole {
	const def = convertNodeToJson<RoleDef>(node, roleSchema);

	const scope: Scope = { scopeName: "", scopeType: "country" };
	const condition = (raw: Raw | undefined): ConditionComplexExpr =>
		raw ? extractConditionValue(raw._raw.value, scope, conditionExprs).condition : true;

	const skills: ModifierPair[] = [];
	for (const field of skillFields) {
		const value = def[field];
		if (typeof value === "number") {
			skills.push({ key: field, value });
		}
	}
	// A scientist's specialisations are written as a block instead of as flat fields, but they are
	// the same thing to a reader: a number per axis.
	skills.push(...readModifierPairs(def.skills));

	return {
		kind,
		traits: def.traits._values.filter(isDefined),
		ideology: readRawAsString(def.ideology),
		expire: readExpire(node),
		slot: readRawAsString(def.slot),
		ideaToken: readRawAsString(def.idea_token),
		ledger: readRawAsString(def.ledger),
		cost: def.cost,
		removalCost: def.removal_cost,
		skills,
		legacyId: def.legacy_id,
		modifiers: readModifierPairs(def.modifier),
		researchBonuses: readModifierPairs(def.research_bonus),
		descKey: readRawAsString(def.desc),
		allowed: condition(def.allowed),
		available: condition(def.available),
		visible: condition(def.visible),
		hasOnAdd: hasContent(def.on_add),
		hasOnRemove: hasContent(def.on_remove),
		token: node.nameToken ?? undefined,
	};
}

/**
 * A country leader's expiry date, in whichever of the two forms the file wrote it.
 *
 * `expire = "2005.3.8"` is a quoted string and reads straight through. `expire = 2030.1.1.1` does
 * not: a four-part date is not a token the format defines, so the tokenizer takes `2030.1` as a
 * number and leaves `.1` and `.1` behind as two valueless siblings. Gluing those back on is what
 * makes the unquoted form readable, and both forms are common in Millennium Dawn.
 */
function readExpire(node: Node): string | undefined {
	const children = childNodes(node);
	const index = children.findIndex((c) => c.name?.toLowerCase() === "expire");
	if (index < 0) {
		return undefined;
	}

	const head = readScalar(children[index]?.value ?? null);
	if (head === undefined || typeof head === "boolean") {
		return undefined;
	}

	let date = String(head);
	for (let i = index + 1; i < children.length; i++) {
		const fragment = children[i];
		if (!fragment?.name || fragment.value !== null || !/^\.\d+$/.test(fragment.name)) {
			break;
		}
		date += fragment.name;
	}

	return date;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
