import { ConditionComplexExpr, ConditionItem, extractConditionValue } from "../../hoiformat/condition";
import { Node, NodeValue, Token, SymbolNode } from "../../hoiformat/hoiparser";
import { Scope } from "../../hoiformat/scope";
import { Enum, Raw, SchemaDef, convertNodeToJson, isSymbolNode } from "../../hoiformat/schema";

// An ideas file is `ideas = { <category> = { <idea key> = { ... } } }`: two nested levels of keys
// the mod author chooses, wrapping a block whose own keys are fixed. The outer two levels are
// walked by hand rather than through CustomMap, because a category block mixes the ideas it holds
// with scalars of its own (`law = yes`, `use_list_view = yes`) and one schema cannot describe both.
// The innermost block -- the idea itself -- is fixed, so it goes through convertNodeToJson.

export interface HOIIdeaFile {
	categories: HOIIdeaCategory[];
	conditionExprs: ConditionItem[];
}

export interface HOIIdeaCategory {
	name: string;
	// `law = yes`. Laws are the categories the player picks one of, so they are worth calling out.
	isLaw: boolean;
	useListView: boolean;
	// `designer = yes` -- a manufacturer category, whose members carry `traits` rather than a
	// `modifier` block.
	isDesigner: boolean;
	ideas: HOIIdea[];
	token: Token | undefined;
}

// ModifierPair is written the same way by an idea and by a decision, so it lives in
// sharedpayload.ts; re-exported here so this module's importers keep reaching it in one place.
export { ModifierPair } from "../sharedpayload";
import { ModifierPair } from "../sharedpayload";

// `targeted_modifier = { tag = SOV attack_bonus = 0.1 }` -- modifiers that apply against one
// country rather than to the owner.
export interface TargetedModifier {
	tag: string | undefined;
	modifiers: ModifierPair[];
}

// `equipment_bonus = { <archetype> = { <stat> = value ... } }`, plus the `instant = yes` flag that
// can sit beside the archetypes.
export interface EquipmentBonusGroup {
	archetype: string;
	instant: boolean;
	modifiers: ModifierPair[];
}

export interface HOIIdea {
	id: string;
	category: string;
	// The key the game localises the idea under: the explicit `name` when there is one, otherwise
	// the idea's own key. Millennium Dawn leans on the override heavily -- HOL_shell3a declares
	// `name = HOL_shell2a` so a swapped idea keeps the name of the one it replaced.
	nameKey: string;
	hasNameOverride: boolean;
	descKey: string;
	// The `picture` token, without the `GFX_idea_` prefix the sprite carries.
	picture: string | undefined;
	cost: number | undefined;
	removalCost: number | undefined;
	level: number | undefined;
	isDefault: boolean;
	cancelIfInvalid: boolean | undefined;
	allowedCivilWar: boolean;
	traits: string[];
	ledger: string | undefined;
	modifiers: ModifierPair[];
	researchBonuses: ModifierPair[];
	targetedModifiers: TargetedModifier[];
	equipmentBonuses: EquipmentBonusGroup[];
	allowed: ConditionComplexExpr;
	hasAllowed: boolean;
	available: ConditionComplexExpr;
	hasAvailable: boolean;
	visible: ConditionComplexExpr;
	hasVisible: boolean;
	hasOnAdd: boolean;
	hasOnRemove: boolean;
	token: Token | undefined;
	file: string;
}

interface IdeaDef {
	name: string;
	picture: string;
	cost: number;
	removal_cost: number;
	level: number;
	default: boolean;
	cancel_if_invalid: boolean;
	allowed_civil_war: Raw;
	traits: Enum;
	ledger: string;
	modifier: Raw;
	research_bonus: Raw;
	targeted_modifier: Raw[];
	equipment_bonus: Raw;
	allowed: Raw;
	available: Raw;
	visible: Raw;
	on_add: Raw;
	on_remove: Raw;
}

const ideaSchema: SchemaDef<IdeaDef> = {
	name: "string",
	picture: "string",
	cost: "number",
	removal_cost: "number",
	level: "number",
	default: "boolean",
	cancel_if_invalid: "boolean",
	allowed_civil_war: "raw",
	traits: "enum",
	ledger: "string",
	modifier: "raw",
	research_bonus: "raw",
	targeted_modifier: {
		_innerType: "raw",
		_type: "array",
	},
	equipment_bonus: "raw",
	allowed: "raw",
	available: "raw",
	visible: "raw",
	on_add: "raw",
	on_remove: "raw",
};

// Scalars a category block carries about itself. Everything else in a category that opens a block
// is one of its ideas -- there is no category-level block in the format -- so this list only has to
// name the keys, not guess at shapes.
const categoryScalars = new Set([
	"law",
	"use_list_view",
	"designer",
	"character_slot",
	"slot",
	"type",
	"cost",
	"removal_cost",
	"ledger",
	"default",
]);

export function getIdeasFromFile(node: Node, filePath: string): HOIIdeaFile {
	const conditionExprs: ConditionItem[] = [];
	const categories: HOIIdeaCategory[] = [];

	for (const ideasNode of childNodes(node)) {
		if (ideasNode.name?.toLowerCase() !== "ideas") {
			continue;
		}

		for (const categoryNode of childNodes(ideasNode)) {
			const category = getCategory(categoryNode, filePath, conditionExprs);
			if (category) {
				categories.push(category);
			}
		}
	}

	return { categories, conditionExprs };
}

function getCategory(
	node: Node,
	filePath: string,
	conditionExprs: ConditionItem[],
): HOIIdeaCategory | undefined {
	const name = node.name;
	if (!name || !Array.isArray(node.value)) {
		return undefined;
	}

	const category: HOIIdeaCategory = {
		name,
		isLaw: false,
		useListView: false,
		isDesigner: false,
		ideas: [],
		token: node.nameToken ?? undefined,
	};

	for (const child of node.value) {
		const childName = child.name?.toLowerCase();
		if (!childName) {
			continue;
		}

		if (categoryScalars.has(childName)) {
			if (childName === "law") {
				category.isLaw = readBoolean(child.value) ?? false;
			} else if (childName === "use_list_view") {
				category.useListView = readBoolean(child.value) ?? false;
			} else if (childName === "designer") {
				category.isDesigner = readBoolean(child.value) ?? false;
			}
			continue;
		}

		if (!Array.isArray(child.value)) {
			continue;
		}

		category.ideas.push(getIdea(child, name, filePath, conditionExprs));
	}

	return category;
}

function getIdea(
	node: Node,
	category: string,
	filePath: string,
	conditionExprs: ConditionItem[],
): HOIIdea {
	const id = node.name ?? "";
	const def = convertNodeToJson<IdeaDef>(node, ideaSchema);

	// The description follows the name, not the key: an idea that borrows another idea's name
	// borrows its description with it, which is exactly what the game shows.
	const nameKey = def.name ?? id;

	const scope: Scope = { scopeName: "", scopeType: "country" };
	const condition = (raw: Raw | undefined): ConditionComplexExpr =>
		raw ? extractConditionValue(raw._raw.value, scope, conditionExprs).condition : true;

	return {
		id,
		category,
		nameKey,
		hasNameOverride: def.name !== undefined && def.name !== id,
		descKey: `${nameKey}_desc`,
		picture: def.picture,
		cost: def.cost,
		removalCost: def.removal_cost,
		level: def.level,
		isDefault: def.default ?? false,
		cancelIfInvalid: def.cancel_if_invalid,
		allowedCivilWar: def.allowed_civil_war !== undefined,
		traits: def.traits._values.filter(isDefined),
		ledger: def.ledger,
		modifiers: readModifierPairs(def.modifier),
		researchBonuses: readModifierPairs(def.research_bonus),
		targetedModifiers: def.targeted_modifier
			.filter(isDefined)
			.map(readTargetedModifier)
			.filter(isDefined),
		equipmentBonuses: readEquipmentBonuses(def.equipment_bonus),
		allowed: condition(def.allowed),
		hasAllowed: def.allowed !== undefined,
		available: condition(def.available),
		hasAvailable: def.available !== undefined,
		visible: condition(def.visible),
		hasVisible: def.visible !== undefined,
		hasOnAdd: hasContent(def.on_add),
		hasOnRemove: hasContent(def.on_remove),
		token: node.nameToken ?? undefined,
		file: filePath,
	};
}

// ---------- raw block readers ----------

// Keys that sit inside a `modifier` block without being modifiers: they name a localisation key to
// print, and rendering them as "Custom Modifier Tooltip: some_tt_key" would be noise on every card
// that has one -- which in Millennium Dawn is hundreds of them.
const notModifiers = new Set(["custom_modifier_tooltip", "custom_effect_tooltip"]);

function readModifierPairs(raw: Raw | undefined): ModifierPair[] {
	const result: ModifierPair[] = [];
	if (!raw || !Array.isArray(raw._raw.value)) {
		return result;
	}

	for (const child of raw._raw.value) {
		// A nested block inside `modifier` has no value to render, so it is dropped rather than
		// shown empty.
		if (!child.name || Array.isArray(child.value)) {
			continue;
		}
		if (notModifiers.has(child.name.toLowerCase())) {
			continue;
		}
		const value = readScalar(child.value);
		if (value !== undefined) {
			result.push({ key: child.name, value });
		}
	}

	return result;
}

function readTargetedModifier(raw: Raw): TargetedModifier | undefined {
	if (!Array.isArray(raw._raw.value)) {
		return undefined;
	}

	let tag: string | undefined;
	const modifiers: ModifierPair[] = [];
	for (const child of raw._raw.value) {
		if (!child.name || Array.isArray(child.value)) {
			continue;
		}
		const value = readScalar(child.value);
		if (value === undefined) {
			continue;
		}
		if (child.name.toLowerCase() === "tag") {
			tag = String(value);
		} else {
			modifiers.push({ key: child.name, value });
		}
	}

	return modifiers.length > 0 || tag !== undefined ? { tag, modifiers } : undefined;
}

function readEquipmentBonuses(raw: Raw | undefined): EquipmentBonusGroup[] {
	const result: EquipmentBonusGroup[] = [];
	if (!raw || !Array.isArray(raw._raw.value)) {
		return result;
	}

	for (const child of raw._raw.value) {
		if (!child.name || !Array.isArray(child.value)) {
			continue;
		}

		const group: EquipmentBonusGroup = {
			archetype: child.name,
			instant: false,
			modifiers: [],
		};

		for (const stat of child.value) {
			if (!stat.name || Array.isArray(stat.value)) {
				continue;
			}
			if (stat.name.toLowerCase() === "instant") {
				group.instant = readBoolean(stat.value) ?? false;
				continue;
			}
			const value = readScalar(stat.value);
			if (value !== undefined) {
				group.modifiers.push({ key: stat.name, value });
			}
		}

		result.push(group);
	}

	return result;
}

// ---------- node helpers ----------

function childNodes(node: Node): Node[] {
	return Array.isArray(node.value) ? node.value : [];
}

function readScalar(value: NodeValue): number | string | boolean | undefined {
	if (typeof value === "number" || typeof value === "string") {
		return value;
	}
	if (isSymbolNode(value)) {
		const name = (value as SymbolNode).name;
		if (name === "yes") {
			return true;
		}
		if (name === "no") {
			return false;
		}
		// A `@constant` or a variable reference: keep the token so the reader at least sees which
		// one was written, rather than the line disappearing.
		return name;
	}
	return undefined;
}

function readBoolean(value: NodeValue): boolean | undefined {
	const scalar = readScalar(value);
	return typeof scalar === "boolean" ? scalar : undefined;
}

function hasContent(raw: Raw | undefined): boolean {
	return raw !== undefined && Array.isArray(raw._raw.value) && raw._raw.value.length > 0;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
