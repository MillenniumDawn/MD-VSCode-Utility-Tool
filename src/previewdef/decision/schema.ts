import {
	andCondition,
	ConditionComplexExpr,
	ConditionItem,
	extractConditionValue,
	extractConditionalExprs,
} from "../../hoiformat/condition";
import {
	extractEffectValue,
	findGuardedEffectItems,
	projectEffects,
} from "../../hoiformat/effect";
import { Node, NodeValue, Token } from "../../hoiformat/hoiparser";
import { Scope } from "../../hoiformat/scope";
import { HOIPartial, Raw, SchemaDef, convertNodeToJson } from "../../hoiformat/schema";
import { childNodes, readModifierPairs, readScalar } from "../../hoiformat/rawblock";
import { EffectTreeNode, ModifierPair } from "../sharedpayload";

// A decisions file is `<category> = { <decision> = { ... } }`. There is no wrapper key -- unlike an
// ideas file, which nests the same thing one level deeper inside `ideas = { ... }` -- so the outer
// level is walked by hand and only the innermost block, whose keys are fixed, goes through
// convertNodeToJson.
//
// The categories named here are only referenced, never defined: their icon, priority and
// scripted_gui live in common/decisions/categories. categories.ts reads those.

export interface HOIDecisionFile {
	categories: HOIDecisionCategoryRef[];
	conditionExprs: ConditionItem[];
}

export interface HOIDecisionCategoryRef {
	name: string;
	decisions: HOIDecision[];
	token: Token | undefined;
	file: string;
}

// `icon` is written either as a bare sprite token or as a repeatable
// `icon = { key = ... trigger = ... }` block, first match winning. Both forms end up here; the
// unconditional one carries `condition: true`.
export interface DecisionIcon {
	key: string;
	condition: ConditionComplexExpr;
}

// Which of a decision's four effect blocks a statement was written in. They fire at different
// moments -- on taking it, when it wears off, when a mission's clock runs out, when it is cancelled
// -- so the preview never merges them.
export type DecisionEffectBlockName =
	| "complete_effect"
	| "remove_effect"
	| "timeout_effect"
	| "cancel_effect";

export const decisionEffectBlockNames: readonly DecisionEffectBlockName[] = [
	"complete_effect",
	"remove_effect",
	"timeout_effect",
	"cancel_effect",
];

export interface DecisionEffectBlock {
	name: DecisionEffectBlockName;
	effects: EffectTreeNode[];
}

// What one decision does to another. `activate_mission` starts a mission, `unlock_decision_tooltip`
// says a decision becomes available, `remove_mission` ends one. These are the only links the file
// states outright, and they are what makes a run of decisions readable as a chain.
export type DecisionCallKind = "activate" | "unlock" | "remove";

export interface DecisionCall {
	kind: DecisionCallKind;
	target: string;
	// The condition guarding this particular call, folded from every `if` / `else_if` / `else`
	// enclosing it. `true` for an unconditional call.
	condition: ConditionComplexExpr;
	// Set when the call sits in a `random_list` branch, carrying that branch's weight.
	possibility?: number;
	from: DecisionEffectBlockName;
}

// `targets = { IRE 456 }` mixes country tags and state ids in one list, because which it is depends
// on `state_target`. Kept as written rather than guessed at.
export interface DecisionTargets {
	values: string[];
	arrays: string[];
	isState: boolean;
	dynamic: boolean;
}

export interface HOIDecision {
	id: string;
	category: string;
	// The key the game localises the decision under: the explicit `name` when there is one,
	// otherwise the decision's own key.
	nameKey: string;
	hasNameOverride: boolean;
	// `desc` overrides the description key independently of the name, which `<key>_desc` follows
	// otherwise.
	descKey: string;
	hasDescOverride: boolean;
	icons: DecisionIcon[];
	// A mission is not declared as one -- it is a decision that carries a countdown. Everything else
	// about a mission (`activation`, `is_good`, `selectable_mission`, `timeout_effect`) is optional,
	// so this is the discriminator.
	isMission: boolean;
	daysMissionTimeout: number | undefined;
	isGood: boolean | undefined;
	selectableMission: boolean | undefined;
	cost: number | string | undefined;
	customCostText: string | undefined;
	daysRemove: number | undefined;
	daysReEnable: number | undefined;
	priority: number | undefined;
	aiHintPpCost: number | undefined;
	fireOnlyOnce: boolean;
	cancelIfNotVisible: boolean;
	onMapMode: string | undefined;
	targets: DecisionTargets;
	modifiers: ModifierPair[];
	allowed: ConditionComplexExpr;
	hasAllowed: boolean;
	available: ConditionComplexExpr;
	hasAvailable: boolean;
	visible: ConditionComplexExpr;
	hasVisible: boolean;
	activation: ConditionComplexExpr;
	hasActivation: boolean;
	cancelTrigger: ConditionComplexExpr;
	hasCancelTrigger: boolean;
	targetTrigger: ConditionComplexExpr;
	hasTargetTrigger: boolean;
	effectBlocks: DecisionEffectBlock[];
	calls: DecisionCall[];
	token: Token | undefined;
	file: string;
}

interface DecisionDef {
	name: string;
	desc: string;
	icon: Raw[];
	cost: Raw;
	custom_cost_text: string;
	days_remove: number;
	days_re_enable: number;
	days_mission_timeout: number;
	priority: number;
	ai_hint_pp_cost: number;
	fire_only_once: boolean;
	is_good: boolean;
	selectable_mission: boolean;
	cancel_if_not_visible: boolean;
	state_target: boolean;
	targets_dynamic: boolean;
	on_map_mode: string;
	targets: Raw;
	target_array: Raw[];
	modifier: Raw;
	allowed: Raw;
	available: Raw;
	visible: Raw;
	activation: Raw;
	cancel_trigger: Raw;
	target_trigger: Raw;
	complete_effect: Raw;
	remove_effect: Raw;
	timeout_effect: Raw;
	cancel_effect: Raw;
}

const decisionSchema: SchemaDef<DecisionDef> = {
	name: "string",
	desc: "string",
	// Repeatable: the conditional form is written once per candidate sprite.
	icon: {
		_innerType: "raw",
		_type: "array",
	},
	// Raw rather than "number": a cost is very often `@some_constant` rather than a literal.
	cost: "raw",
	custom_cost_text: "string",
	days_remove: "number",
	days_re_enable: "number",
	days_mission_timeout: "number",
	priority: "number",
	ai_hint_pp_cost: "number",
	fire_only_once: "boolean",
	is_good: "boolean",
	selectable_mission: "boolean",
	cancel_if_not_visible: "boolean",
	state_target: "boolean",
	targets_dynamic: "boolean",
	on_map_mode: "string",
	targets: "raw",
	target_array: {
		_innerType: "raw",
		_type: "array",
	},
	modifier: "raw",
	allowed: "raw",
	available: "raw",
	visible: "raw",
	activation: "raw",
	cancel_trigger: "raw",
	target_trigger: "raw",
	complete_effect: "raw",
	remove_effect: "raw",
	timeout_effect: "raw",
	cancel_effect: "raw",
};

// The effect keys that name another decision, and what each of them means for the chain.
const callKindByKey: Record<string, DecisionCallKind> = {
	activate_mission: "activate",
	activate_decision: "activate",
	unlock_decision_tooltip: "unlock",
	remove_mission: "remove",
};

const callKeys = Object.keys(callKindByKey);

export function getDecisionsFromFile(node: Node, filePath: string): HOIDecisionFile {
	const conditionExprs: ConditionItem[] = [];
	const categories: HOIDecisionCategoryRef[] = [];

	for (const categoryNode of childNodes(node)) {
		const category = getCategoryRef(categoryNode, filePath, conditionExprs);
		if (category) {
			categories.push(category);
		}
	}

	return { categories, conditionExprs };
}

function getCategoryRef(
	node: Node,
	filePath: string,
	conditionExprs: ConditionItem[],
): HOIDecisionCategoryRef | undefined {
	const name = node.name;
	if (!name || !Array.isArray(node.value)) {
		return undefined;
	}

	const decisions: HOIDecision[] = [];
	for (const child of node.value) {
		// Every child of a category that opens a block is one of its decisions: unlike an ideas
		// category, a decisions category block carries no scalars of its own.
		if (!child.name || !Array.isArray(child.value)) {
			continue;
		}
		decisions.push(getDecision(child, name, filePath, conditionExprs));
	}

	return { name, decisions, token: node.nameToken ?? undefined, file: filePath };
}

function getDecision(
	node: Node,
	category: string,
	filePath: string,
	conditionExprs: ConditionItem[],
): HOIDecision {
	const id = node.name ?? "";
	const def = convertNodeToJson<DecisionDef>(node, decisionSchema);

	const scope: Scope = { scopeName: "", scopeType: "country" };
	const condition = (raw: Raw | undefined): ConditionComplexExpr =>
		raw ? extractConditionValue(raw._raw.value, scope, conditionExprs).condition : true;

	const nameKey = def.name ?? id;
	const effectBlocks: DecisionEffectBlock[] = [];
	const calls: DecisionCall[] = [];

	for (const blockName of decisionEffectBlockNames) {
		const raw = def[blockName];
		if (!raw || !Array.isArray(raw._raw.value) || raw._raw.value.length === 0) {
			continue;
		}

		const effect = extractEffectValue(raw._raw.value, scope).effect;
		effectBlocks.push({ name: blockName, effects: projectEffects(effect) });

		for (const guarded of findGuardedEffectItems(effect, callKeys)) {
			const key = guarded.item.node.name?.toLowerCase();
			const kind = key ? callKindByKey[key] : undefined;
			const target = readTarget(guarded.item.node.value);
			if (!kind || !target) {
				continue;
			}
			calls.push({
				kind,
				target,
				condition: guarded.condition,
				possibility: guarded.possibility,
				from: blockName,
			});
		}
	}

	for (const call of calls) {
		extractConditionalExprs(call.condition, conditionExprs);
	}

	return {
		id,
		category,
		nameKey,
		hasNameOverride: def.name !== undefined && def.name !== id,
		descKey: def.desc ?? `${nameKey}_desc`,
		hasDescOverride: def.desc !== undefined,
		icons: readIcons(def.icon, scope, conditionExprs),
		isMission: def.days_mission_timeout !== undefined,
		daysMissionTimeout: def.days_mission_timeout,
		isGood: def.is_good,
		selectableMission: def.selectable_mission,
		cost: readRawScalar(def.cost),
		customCostText: def.custom_cost_text,
		daysRemove: def.days_remove,
		daysReEnable: def.days_re_enable,
		priority: def.priority,
		aiHintPpCost: def.ai_hint_pp_cost,
		fireOnlyOnce: def.fire_only_once ?? false,
		cancelIfNotVisible: def.cancel_if_not_visible ?? false,
		onMapMode: def.on_map_mode,
		targets: readTargets(def),
		modifiers: readModifierPairs(def.modifier),
		allowed: condition(def.allowed),
		hasAllowed: def.allowed !== undefined,
		available: condition(def.available),
		hasAvailable: def.available !== undefined,
		visible: condition(def.visible),
		hasVisible: def.visible !== undefined,
		activation: condition(def.activation),
		hasActivation: def.activation !== undefined,
		cancelTrigger: condition(def.cancel_trigger),
		hasCancelTrigger: def.cancel_trigger !== undefined,
		targetTrigger: condition(def.target_trigger),
		hasTargetTrigger: def.target_trigger !== undefined,
		effectBlocks,
		calls,
		token: node.nameToken ?? undefined,
		file: filePath,
	};
}

// ---------- raw block readers ----------

// `icon = GFX_decision_x` and `icon = { key = GFX_decision_x trigger = { ... } }` are the same key
// written two ways. The conditional form is repeated, first match winning, so the order is kept.
function readIcons(
	raws: (Raw | undefined)[],
	scope: Scope,
	conditionExprs: ConditionItem[],
): DecisionIcon[] {
	const icons: DecisionIcon[] = [];

	for (const raw of raws) {
		if (!raw) {
			continue;
		}

		const value = raw._raw.value;
		if (!Array.isArray(value)) {
			const scalar = readScalar(value);
			if (scalar !== undefined) {
				icons.push({ key: String(scalar), condition: true });
			}
			continue;
		}

		let key: string | undefined;
		let condition: ConditionComplexExpr = true;
		for (const child of value) {
			const childName = child.name?.toLowerCase();
			if (childName === "key") {
				const scalar = readScalar(child.value);
				if (scalar !== undefined) {
					key = String(scalar);
				}
			} else if (childName === "trigger") {
				condition = andCondition(
					condition,
					extractConditionValue(child.value, scope, conditionExprs).condition,
				);
			}
		}

		if (key !== undefined) {
			icons.push({ key, condition });
		}
	}

	return icons;
}

function readTargets(def: HOIPartial<DecisionDef>): DecisionTargets {
	const values: string[] = [];
	if (def.targets && Array.isArray(def.targets._raw.value)) {
		for (const child of def.targets._raw.value) {
			// A target list is written as bare tokens, so each one arrives as a node with a name and
			// no value rather than as a `key = value` pair.
			if (child.name) {
				values.push(child.name);
			}
		}
	}

	const arrays: string[] = [];
	for (const raw of def.target_array) {
		const target = raw ? readRawScalar(raw) : undefined;
		if (target !== undefined) {
			arrays.push(String(target));
		}
	}

	return {
		values,
		arrays,
		isState: def.state_target ?? false,
		dynamic: def.targets_dynamic ?? false,
	};
}

// ---------- node helpers ----------

// readModifierPairs, readScalar and childNodes live in hoiformat/rawblock.ts, shared with the idea
// and character schemas.

// `activate_mission = X`, and the block form `activate_mission = { ... }` that a few effects use.
// Only the first names a decision; the second has nothing to point an arrow at.
function readTarget(value: NodeValue): string | undefined {
	const scalar = readScalar(value);
	return typeof scalar === "string" ? scalar : undefined;
}

function readRawScalar(raw: Raw | undefined): number | string | undefined {
	if (!raw) {
		return undefined;
	}
	const scalar = readScalar(raw._raw.value);
	return typeof scalar === "boolean" ? undefined : scalar;
}
