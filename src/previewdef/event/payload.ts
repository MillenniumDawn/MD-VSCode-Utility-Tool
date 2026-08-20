import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { HOIEventType } from "./schema";

// The serializable projection of the event graph: what the host posts and the webview lays out
// and renders.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency
// -- no vscode, no image cache, no localisation index. Keeping the shapes here rather than in
// graph.ts (which does depend on all three) means an accidental value import from the webview
// fails loudly at build time instead of dragging the extension host into the bundle.

// LocText and NavTarget are shared with the other previews and live in sharedpayload.ts; they are
// re-exported here so every importer of this module keeps working unchanged.
export { LocText, NavTarget } from "../sharedpayload";
import { LocText, NavTarget } from "../sharedpayload";

// Which block of the event a call was written in. `immediate` and `after` are the event's own two
// effect blocks -- one before the card is shown, one after it is dismissed -- and their calls hang
// off the event itself; `option` is a call the player has to pick to make, and hangs off the option.
export type EventCallSource = "immediate" | "after" | "option";

// The effects of one option (or of an event's `immediate` block), projected out of
// EffectComplexExpr. The shapes are the same three, minus EffectItem.node -- that field is the raw
// parse tree of the whole statement, which must never travel to the webview.
//
// Unlike EffectComplexExpr, which is sniffed structurally, each variant names itself: the renderer
// walks this tree in the webview, where a `kind` reads better than probing for a property.
export interface EffectLine {
	kind: "line";
	scopeName: string;
	content: string;
}

// Effects that only run when a condition holds -- an `if` / `else_if` / `else` in the file, with
// every enclosing guard already folded into `condition` by extractEffectValue.
export interface EffectGroup {
	kind: "group";
	condition: ConditionComplexExpr;
	items: EffectTreeNode[];
}

// One `random_list`: exactly one of the branches runs, with the weight it was written with.
export interface EffectChoice {
	kind: "choice";
	items: { possibility: number; effect: EffectTreeNode[] }[];
}

export type EffectTreeNode = EffectLine | EffectGroup | EffectChoice;

interface GraphNodeBase {
	id: string;
	nav?: NavTarget;
}

export interface EventGraphEventNode extends GraphNodeBase {
	kind: "event";
	eventId: string;
	eventType: HOIEventType;
	scope: string;
	title: LocText;
	major: boolean;
	hidden: boolean;
	fireOnlyOnce: boolean;
	isTriggeredOnly: boolean;
	loop: boolean;
	meanTimeToHappenBase: number;
	trigger: ConditionComplexExpr;
	picture?: { styleKey: string; width: number };
	// The event's `immediate` block, as an index into EventGraphPayload.effectBlocks. Absent when
	// the event has no immediate effects.
	effectsRef?: number;
	// The event's `after` block, the same way. Neither block has a card of its own, so this is the
	// only place either can surface.
	afterEffectsRef?: number;
}

export interface EventGraphOptionNode extends GraphNodeBase {
	kind: "option";
	name: LocText;
	trigger: ConditionComplexExpr;
	// What the option does, as an index into EventGraphPayload.effectBlocks. Absent when the option
	// body holds nothing but its own name and trigger.
	effectsRef?: number;
}

// A call to an event id that no loaded file defines.
export interface EventGraphUnresolvedNode extends GraphNodeBase {
	kind: "unresolved";
	eventId: string;
	scope: string;
	title?: LocText;
}

export type EventGraphNode =
	| EventGraphEventNode
	| EventGraphOptionNode
	| EventGraphUnresolvedNode;

export interface EventGraphEdge {
	from: string;
	to: string;
	// An event to one of its own options. Carries no scope, delay or condition -- it is the
	// structure of the event, not a call.
	structural: boolean;
	// Which block of the event fired this call. A structural edge leads to an option card, so it
	// carries `option`.
	source: EventCallSource;
	scope: string;
	days: number;
	hours: number;
	randomDays: number;
	randomHours: number;
	condition: ConditionComplexExpr;
	possibility?: number;
	// The events a filter removed from between `from` and `to`. Synthesized by the webview when it
	// contracts the graph around a filtered-out event, so the chain keeps its arrow rather than
	// falling into two halves -- the host never sets this.
	skipped?: string[];
}

// Which toolbar controls this file can actually use. A toggle whose flag is false produces
// byte-identical output in either position, so the webview hides it rather than offering a control
// that promises something the preview cannot deliver. The filter flags work the same way: a filter
// no event in the file matches would only ever empty the canvas, so its entry is dropped from the
// filter list.
//
// These ride in the payload rather than deciding the toolbar markup on the host, because the
// toolbar is part of the baked-in shell: markup that changed with the file would need a full html
// reassignment to apply, tearing the page down and losing scroll and zoom on every flip. As a
// payload field they reach the page through the initial script and every in-place update alike,
// and they are inside the hashed update so a flags-only change is never skipped.
export interface EventToolbarFlags {
	// Some option (or immediate block) calls another event, so there is a chain to filter down to.
	hasChains: boolean;
	hasEffects: boolean;
	// Some event is hidden.
	hasHidden: boolean;
	hasMajor: boolean;
	hasNews: boolean;
	// Some event fires on its own clock, and some event fires only when another effect calls it.
	// The two are complements, so a file of nothing but triggered events offers only the second.
	hasMtth: boolean;
	hasTriggered: boolean;
	// The localisation index is on. With it off every LocText has text === key, so the toggle
	// swaps a string for itself.
	hasLocalisation: boolean;
	hasPicture: boolean;
}

export interface EventGraphPayload {
	roots: string[];
	nodes: EventGraphNode[];
	edges: EventGraphEdge[];
	conditionExprs: ConditionItem[];
	toolbarFlags: EventToolbarFlags;
	// Every distinct effect block in the file, referenced by index from the nodes rather than
	// carried on them. One option is emitted as a node once per scope situation it is reached in,
	// so inlining its effects would multiply them by the walk instead of by the file -- the same
	// blow-up the `visited` memo in graph.ts exists to prevent.
	effectBlocks: EffectTreeNode[][];
}
