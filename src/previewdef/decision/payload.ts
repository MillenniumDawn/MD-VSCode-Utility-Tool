import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { EffectTreeNode, LocText, ModifierLine, NavTarget } from "../sharedpayload";
import { DecisionCallKind, DecisionEffectBlockName } from "./schema";

// The serializable projection of a decisions file: what the host posts and the webview lays out as
// a graph of categories, the decisions inside them, and the arrows between decisions that start or
// end one another.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency --
// no vscode, no image cache, no localisation index. And the payload must be deterministic:
// LoaderPreview hashes it to decide whether an edit changed anything, so a stable order and
// counter-free ids are what make an unchanged edit skip the re-render.

export { LocText, NavTarget, EffectTreeNode, ModifierLine } from "../sharedpayload";
export { DecisionCallKind, DecisionEffectBlockName } from "./schema";

// An icon, as a StyleTable class carrying the decoded image as a data URL, plus the size to draw it
// at. The same shape the idea preview uses.
export interface DecisionIcon {
	styleKey: string;
	width: number;
	height: number;
}

// A category the game draws with a custom GUI window instead of the standard list of buttons. The
// name is always known; the window is only there when the interface tree defines it.
export interface DecisionScriptedGui {
	// The `scripted_gui = X` token.
	name: string;
	// The `window_name` the scripted GUI declares, when common/scripted_guis names one.
	windowName?: string;
	// The window rendered to HTML by the same code the GUI preview uses. Absent when the window
	// could not be found, in which case the card says so rather than showing an empty frame.
	html?: string;
	// Where the window is defined, so the badge can be clicked through to it.
	nav?: NavTarget;
}

interface GraphNodeBase {
	id: string;
	nav?: NavTarget;
}

export interface DecisionGraphCategoryNode extends GraphNodeBase {
	kind: "category";
	categoryKey: string;
	name: LocText;
	desc: LocText;
	icon?: DecisionIcon;
	picture?: DecisionIcon;
	priority?: number;
	scriptedGui?: DecisionScriptedGui;
	visibleWhenEmpty: boolean;
	allowed: ConditionComplexExpr;
	hasAllowed: boolean;
	visible: ConditionComplexExpr;
	hasVisible: boolean;
	// False when common/decisions/categories defines no category by this name. The decisions still
	// show; the card says the tab they belong to was not found, which is a real mistake worth
	// seeing rather than a blank icon.
	defined: boolean;
}

// One of a decision's effect blocks, as an index into DecisionGraphPayload.effectBlocks. The blocks
// are referenced rather than carried so a block shared by two decisions is stored once.
export interface DecisionEffectRef {
	name: DecisionEffectBlockName;
	ref: number;
}

export interface DecisionGraphDecisionNode extends GraphNodeBase {
	kind: "decision";
	decisionId: string;
	category: string;
	name: LocText;
	desc: LocText;
	// True when the decision declared `name = <other key>` rather than being localised under its own
	// key -- worth showing, because it is how two decisions come to share a button title.
	borrowsName: boolean;
	icon?: DecisionIcon;
	// How many icons the decision declared. More than one means the game picks between them by
	// trigger and the preview is showing the first.
	iconCount: number;
	isMission: boolean;
	daysMissionTimeout?: number;
	// Only meaningful on a mission: whether its timer bar reads as a goal or as a threat.
	isGood?: boolean;
	selectableMission?: boolean;
	fireOnlyOnce: boolean;
	// Short facts drawn as badges: cost, timers, priority, target list.
	badges: string[];
	modifiers: ModifierLine[];
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
	effects: DecisionEffectRef[];
}

// A decision named by an `activate_mission` that no loaded file defines.
export interface DecisionGraphUnresolvedNode extends GraphNodeBase {
	kind: "unresolved";
	decisionId: string;
	name?: LocText;
}

export type DecisionGraphNode =
	| DecisionGraphCategoryNode
	| DecisionGraphDecisionNode
	| DecisionGraphUnresolvedNode;

export interface DecisionGraphEdge {
	from: string;
	to: string;
	// A category to one of the decisions it holds. Carries no condition -- it is the structure of
	// the file, not something one decision does to another.
	structural: boolean;
	kind?: DecisionCallKind;
	// Which effect block the call was written in.
	fromBlock?: DecisionEffectBlockName;
	condition: ConditionComplexExpr;
	possibility?: number;
	// The decisions a filter removed from between `from` and `to`. Synthesized by the webview when
	// it contracts the graph around a filtered-out decision, so a chain keeps its arrow rather than
	// falling into two halves -- the host never sets this.
	skipped?: string[];
}

// Which toolbar controls this file can actually use. A control whose flag is false would produce
// identical output in either position, so the webview hides it rather than offering something the
// preview cannot deliver.
//
// These ride in the payload rather than deciding the toolbar markup on the host, because the
// toolbar is part of the baked-in shell: markup that changed with the file would need a full html
// reassignment to apply, tearing the page down and losing scroll and zoom on every flip.
export interface DecisionToolbarFlags {
	hasMissions: boolean;
	hasDecisions: boolean;
	// Some decision starts, unlocks or ends another, so there is a chain to filter down to.
	hasChains: boolean;
	hasEffects: boolean;
	hasModifiers: boolean;
	hasTargets: boolean;
	hasScriptedGui: boolean;
	hasConditions: boolean;
	hasIcons: boolean;
	// The localisation index is on. With it off every LocText has text === key, so the toggle would
	// swap a string for itself.
	hasLocalisation: boolean;
	// A category names a scripted GUI whose window nothing in the interface tree defines, so the
	// toggle can be offered but will not draw that one.
	hasUnresolvedScriptedGui: boolean;
}

export interface DecisionGraphPayload {
	roots: string[];
	nodes: DecisionGraphNode[];
	edges: DecisionGraphEdge[];
	conditionExprs: ConditionItem[];
	effectBlocks: EffectTreeNode[][];
	toolbarFlags: DecisionToolbarFlags;
}
