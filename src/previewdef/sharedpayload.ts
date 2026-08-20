import { ConditionComplexExpr } from "../hoiformat/condition";

// Shapes shared by every preview payload.
//
// Like the payload modules that use them, this file is imported by webview bundles, so it must stay
// free of any runtime dependency -- no vscode, no image cache, no localisation index. An accidental
// value import from a webview then fails at build time instead of dragging the extension host into
// the bundle.

// A localisation key together with the text it resolves to. Both travel to the webview so a
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

// What one effect block does -- an event option, an event's `immediate`, a decision's
// `complete_effect` -- projected out of EffectComplexExpr. The shapes are the same three, minus
// EffectItem.node: that field is the raw parse tree of the whole statement, which is both large and
// full of cycles, and must never travel to a webview.
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
