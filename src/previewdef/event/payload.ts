import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { HOIEventType } from "./schema";

// The serializable projection of the event graph: what the host posts and the webview lays out
// and renders.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency
// -- no vscode, no image cache, no localisation index. Keeping the shapes here rather than in
// graph.ts (which does depend on all three) means an accidental value import from the webview
// fails loudly at build time instead of dragging the extension host into the bundle.

// A localisation key together with the text it resolves to. Both travel to the webview so the
// "show localisation" toggle can swap between them without a round trip to the host.
export interface LocText {
	key: string;
	text: string;
}

export interface NavTarget {
	start: number;
	end: number;
	file: string;
}

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
}

export interface EventGraphOptionNode extends GraphNodeBase {
	kind: "option";
	name: LocText;
	trigger: ConditionComplexExpr;
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
	// Fired from the event's `immediate` block rather than from a player option.
	immediate: boolean;
	scope: string;
	days: number;
	hours: number;
	randomDays: number;
	randomHours: number;
	condition: ConditionComplexExpr;
	possibility?: number;
}

export interface EventGraphPayload {
	roots: string[];
	nodes: EventGraphNode[];
	edges: EventGraphEdge[];
	conditionExprs: ConditionItem[];
}
