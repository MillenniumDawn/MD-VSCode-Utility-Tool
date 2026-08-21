import { ConditionComplexExpr } from "../../src/hoiformat/condition";
import { EffectTreeNode } from "../../src/previewdef/sharedpayload";
import { feLocalize } from "./i18n";

// Condition and effect rendering, shared by the event and decision previews. Both draw the same two
// trees -- a trigger and what a thing does when it runs -- so they draw them the same way, out of
// one copy.
//
// The `eventtree.*` localisation keys are kept as they were when this lived in eventtree.ts:
// renaming them would retire every existing translation of these strings for no gain to the reader.

//#region Condition rendering

// `andnot` is NOT(a AND b) and `ornot` is NOT(a OR b), so with more than one item they read as
// "not all of" and "none of" respectively. A bare "not" would be ambiguous for the first.
export const foldLabels: Record<string, string> = {
	and: "all of",
	or: "any of",
	ornot: "none of",
	andnot: "not all of",
	count: "count",
};

// conditionToString in hoiformat/condition.ts renders a single flat line, which is unreadable for
// anything but a trivial trigger. This renders the same tree as nested lists instead.
//
// `labels` is a parameter because the idea preview has always named a `count` folder differently
// from the two tree previews, and sharing this function is not a reason to retire either wording.
export function conditionToDom(
	condition: ConditionComplexExpr,
	labels: Record<string, string> = foldLabels,
): HTMLUListElement {
	const list = document.createElement("ul");

	if (typeof condition === "boolean") {
		list.appendChild(leafItem(String(condition), ""));
		return list;
	}

	if (!("items" in condition)) {
		list.appendChild(leafItem(condition.nodeContent, condition.scopeName));
		return list;
	}

	// A single-item `and` adds a level of nesting without adding meaning, so `trigger = { tag = FROM }`
	// reads as one line rather than an "all of" wrapping one leaf.
	if (condition.type === "and" && condition.items.length === 1 && condition.items[0] !== undefined) {
		return conditionToDom(condition.items[0], labels);
	}

	const item = document.createElement("li");
	const head = document.createElement("span");
	head.className = "ev-fold";
	head.textContent = labels[condition.type] ?? condition.type;
	if (condition.type === "count") {
		head.textContent += " == " + condition.amount;
	}
	item.appendChild(head);

	const inner = document.createElement("ul");
	for (const child of condition.items) {
		const rendered = conditionToDom(child, labels);
		while (rendered.firstChild) {
			inner.appendChild(rendered.firstChild);
		}
	}
	item.appendChild(inner);
	list.appendChild(item);
	return list;
}

export function leafItem(text: string, scopeName: string): HTMLLIElement {
	const item = document.createElement("li");
	if (scopeName) {
		const scope = document.createElement("span");
		scope.className = "ev-cond-scope";
		scope.textContent = "[" + scopeName + "] ";
		item.appendChild(scope);
	}
	item.appendChild(document.createTextNode(text));
	return item;
}

// A one-line form, for an edge chip where the full tree would not fit. Every folder type names
// itself: a comma list alone would read a negated group as a positive one, which is the opposite of
// what the file says, and would drop the threshold off a `count`.
export function conditionToLabel(condition: ConditionComplexExpr): string {
	if (condition === true) {
		return "";
	}
	if (condition === false) {
		return "never";
	}
	if (!("items" in condition)) {
		return (condition.scopeName ? "[" + condition.scopeName + "] " : "") + condition.nodeContent;
	}

	// A nested `true` contributes nothing, and leaving it in would show up as an empty slot in the
	// comma list.
	const parts = condition.items.map((item) => conditionToLabel(item)).filter((part) => part !== "");
	const first = parts[0];
	if (parts.length === 0 || first === undefined) {
		return "";
	}

	if (parts.length === 1) {
		if (condition.type === "and" || condition.type === "or") {
			return first;
		}
		if (condition.type === "andnot" || condition.type === "ornot") {
			return "not " + first;
		}
	}

	if (condition.type === "and") {
		return parts.join(", ");
	}
	if (condition.type === "or") {
		return parts.join(" or ");
	}

	const label =
		condition.type === "count"
			? foldLabels.count + " == " + condition.amount
			: (foldLabels[condition.type] ?? condition.type);
	return label + " (" + parts.join(", ") + ")";
}

export function conditionPanel(
	condition: ConditionComplexExpr,
	label: string,
	labels: Record<string, string> = foldLabels,
): HTMLDivElement {
	const box = document.createElement("div");
	box.className = "ev-cond";
	const head = document.createElement("div");
	head.className = "ev-cond-head";
	head.textContent = label;
	box.appendChild(head);
	box.appendChild(conditionToDom(condition, labels));
	return box;
}

//#endregion

//#region Effect rendering

// A panel is a hover popup, so it has to stay something you can read at a glance rather than a
// second copy of the file. Anything past this many lines is counted and summarised instead.
const maxEffectLines = 40;

interface EffectBudget {
	left: number;
	skipped: number;
}

// The effects of one option, or of an event's immediate block, as a nested list. Structure is the
// point: which effects only run under an `if`, and which are one branch of a `random_list`.
export function effectsToDom(nodes: EffectTreeNode[]): HTMLUListElement {
	const budget: EffectBudget = { left: maxEffectLines, skipped: 0 };
	const list = document.createElement("ul");
	appendEffects(list, nodes, budget);

	if (budget.skipped > 0) {
		const more = document.createElement("li");
		more.className = "ev-fold";
		more.textContent = feLocalize("eventtree.moreeffects", "+{0} more", budget.skipped);
		list.appendChild(more);
	}

	return list;
}

function appendEffects(list: HTMLUListElement, nodes: EffectTreeNode[], budget: EffectBudget): void {
	for (const node of nodes) {
		// Counting what is left rather than rendering it keeps a half-filled `if` off the panel:
		// a group is either shown with its effects or reported as part of the tail.
		if (budget.left <= 0) {
			budget.skipped += countEffectLines([node]);
			continue;
		}

		if (node.kind === "line") {
			budget.left--;
			list.appendChild(leafItem(node.content, node.scopeName));
		} else if (node.kind === "group") {
			list.appendChild(foldItem("if " + conditionToLabel(node.condition), node.items, budget));
		} else {
			for (const branch of node.items) {
				// The weight is shown as written, for the reason chipTextFor gives: a random_list key
				// is relative to its siblings, and a modifier can change the totals at runtime.
				list.appendChild(
					foldItem(feLocalize("eventtree.weight", "weight {0}", branch.possibility), branch.effect, budget),
				);
			}
		}
	}
}

function foldItem(label: string, items: EffectTreeNode[], budget: EffectBudget): HTMLLIElement {
	const item = document.createElement("li");
	const head = document.createElement("span");
	head.className = "ev-fold";
	head.textContent = label;
	item.appendChild(head);

	const inner = document.createElement("ul");
	appendEffects(inner, items, budget);
	item.appendChild(inner);
	return item;
}

export function countEffectLines(nodes: EffectTreeNode[]): number {
	let total = 0;
	for (const node of nodes) {
		if (node.kind === "line") {
			total++;
		} else if (node.kind === "group") {
			total += countEffectLines(node.items);
		} else {
			for (const branch of node.items) {
				total += countEffectLines(branch.effect);
			}
		}
	}
	return total;
}

//#endregion
