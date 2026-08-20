import { tryRun, subscribeNavigators, enableZoom, initCommon, getState, setState, panning$ } from "./util/common";
import { syncCheckbox } from "./util/checkbox";
import { DivDropdown } from "./util/dropdown";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import { ConditionComplexExpr } from "../src/hoiformat/condition";
import {
	EffectTreeNode,
	EventGraphEdge,
	EventGraphEventNode,
	EventGraphNode,
	EventGraphOptionNode,
	EventGraphPayload,
	EventGraphUnresolvedNode,
	EventToolbarFlags,
} from "../src/previewdef/event/payload";

initCommon();

// Marker on every hover-picture popup (appended to body, outside #eventtreecontent) so a re-render
// can sweep any that were stranded by replacing their host node mid-hover.
const hoverPictureClass = "event-hover-picture";
// The same, for the effects panel.
const effectTooltipClass = "ev-effects-tip";

// Mirrors toolbarHeight in src/previewdef/event/contentbuilder.ts, which is what actually sizes
// the strip. Change one and the other has to follow, or the popup clamp and the zoom offset below
// stop matching where the toolbar really ends.
const toolbarHeight = 52;

// The hover popups are appended to <body>, so they are placed in viewport coordinates by hand
// rather than by the layout. The toolbar strip is drawn above them now, so anything they put under
// it would simply be invisible: this keeps them clear of it instead.
const popupMargin = 4;

function clampBelowToolbar(top: number): number {
	return Math.max(toolbarHeight + popupMargin, top);
}

const emptyPayload: EventGraphPayload = {
	roots: [],
	nodes: [],
	edges: [],
	conditionExprs: [],
	toolbarFlags: {
		hasChains: false,
		hasEffects: false,
		hasHidden: false,
		hasMajor: false,
		hasNews: false,
		hasMtth: false,
		hasTriggered: false,
		hasLocalisation: false,
		hasPicture: false,
	},
	effectBlocks: [],
};

let payload: EventGraphPayload = (window as any).eventGraph ?? emptyPayload;

let showLocalisation: boolean = getState().showLocalisation ?? true;
// An option's own `trigger = { ... }` gate, shown on the card, and the condition on the arrow that
// leads out of it are two different things, so they are two different toggles.
let showOptionTriggers: boolean = getState().showOptionTriggers ?? true;
let showEdgeConditions: boolean = getState().showEdgeConditions ?? true;
let showEventConditions: boolean = getState().showEventConditions ?? true;
let showPicture: boolean = getState().showPicture ?? true;
let showEffects: boolean = getState().showEffects ?? true;
// Empty by default: an opt-in filter must never hide anything the first time the preview is opened.
let filters: EventFilter[] = readFilters(getState().eventFilters);
let filterDropdown: DivDropdown | undefined = undefined;
// Set while a gated selection is being pushed into the widget, so its subscription can tell a value
// this module computed from one the reader chose. Only the second is worth storing.
let syncingFilters = false;

//#region Condition rendering

// `andnot` is NOT(a AND b) and `ornot` is NOT(a OR b), so with more than one item they read as
// "not all of" and "none of" respectively. A bare "not" would be ambiguous for the first.
const foldLabels: Record<string, string> = {
	and: "all of",
	or: "any of",
	ornot: "none of",
	andnot: "not all of",
	count: "count",
};

// conditionToString in hoiformat/condition.ts renders a single flat line, which is unreadable for
// anything but a trivial trigger. This renders the same tree as nested lists instead.
export function conditionToDom(condition: ConditionComplexExpr): HTMLUListElement {
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
		return conditionToDom(condition.items[0]);
	}

	const item = document.createElement("li");
	const head = document.createElement("span");
	head.className = "ev-fold";
	head.textContent = foldLabels[condition.type] ?? condition.type;
	if (condition.type === "count") {
		head.textContent += " == " + condition.amount;
	}
	item.appendChild(head);

	const inner = document.createElement("ul");
	for (const child of condition.items) {
		const rendered = conditionToDom(child);
		while (rendered.firstChild) {
			inner.appendChild(rendered.firstChild);
		}
	}
	item.appendChild(inner);
	list.appendChild(item);
	return list;
}

function leafItem(text: string, scopeName: string): HTMLLIElement {
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

function conditionPanel(condition: ConditionComplexExpr, label: string): HTMLDivElement {
	const box = document.createElement("div");
	box.className = "ev-cond";
	const head = document.createElement("div");
	head.className = "ev-cond-head";
	head.textContent = label;
	box.appendChild(head);
	box.appendChild(conditionToDom(condition));
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

function countEffectLines(nodes: EffectTreeNode[]): number {
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

//#region Filtering

export interface VisibleGraph {
	nodes: EventGraphNode[];
	edges: EventGraphEdge[];
	roots: string[];
}

// The entries of the toolbar's filter list. Each one answers "which events belong on the canvas",
// which is why they are one control and not one checkbox each.
export type EventFilter = "mtth" | "triggered" | "news" | "hidden" | "major" | "chains";

// The order the list is written in, which is also the order a selection is stored and read back in,
// so a saved selection cannot depend on the order the reader happened to tick the boxes.
export const eventFilters: readonly EventFilter[] = [
	"mtth",
	"triggered",
	"news",
	"hidden",
	"major",
	"chains",
];

// State written by an older version -- or by nothing at all -- reaches this as whatever it happens
// to be, so anything that is not a filter name is dropped rather than carried into the predicates.
export function readFilters(stored: unknown): EventFilter[] {
	if (!Array.isArray(stored)) {
		return [];
	}
	return eventFilters.filter((filter) => stored.includes(filter));
}

// One option is emitted as a node once per scope situation it is reached in, so it can have several
// structural parents. Treating this as a single id would silently drop chain links.
function ownersOfOptions(edges: EventGraphEdge[]): Map<string, string[]> {
	const owners = new Map<string, string[]>();
	for (const edge of edges) {
		if (!edge.structural) {
			continue;
		}
		const list = owners.get(edge.to);
		if (list) {
			list.push(edge.from);
		} else {
			owners.set(edge.to, [edge.from]);
		}
	}
	return owners;
}

// An event is part of a chain when an option of it calls another event, or an option of another
// event calls it. The link is two hops -- event --structural--> option --call--> event -- so the
// option hop is collapsed onto its owning event before the ends are counted. A call from the event's
// own `immediate` or `after` block is the same link with no option in between, and counts the same.
export function chainedIds(nodes: EventGraphNode[], edges: EventGraphEdge[]): Set<string> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	// Anything that is not an option is an end of a chain: an event, or an unresolved call to an
	// event no loaded file defines -- which exists only because an option called it, and is exactly
	// the cross-file link a chain view is for.
	const isChainEnd = (id: string): boolean => byId.get(id)?.kind !== "option";
	const owners = ownersOfOptions(edges);

	const linked = new Set<string>();
	for (const edge of edges) {
		if (edge.structural || !byId.has(edge.from) || !isChainEnd(edge.to)) {
			continue;
		}
		const froms = isChainEnd(edge.from) ? [edge.from] : (owners.get(edge.from) ?? []);
		for (const from of froms) {
			// An event that fires itself counts: the arrow is drawn on the canvas, so dropping the
			// only card it connects would leave the reader wondering. Guard `from !== edge.to` here
			// to require two distinct events instead.
			linked.add(from);
			linked.add(edge.to);
		}
	}

	return linked;
}

function matchesFilter(
	node: EventGraphEventNode,
	filter: EventFilter,
	linked: Set<string> | undefined,
): boolean {
	switch (filter) {
		// meanTimeToHappenBase is 1 for an event that declares no mean_time_to_happen at all, so it
		// cannot tell the two apart. `is_triggered_only` can, and it is the same line the card draws
		// in its own badge: an event either waits on its own clock or waits to be called.
		case "mtth":
			return !node.isTriggeredOnly;
		case "triggered":
			return node.isTriggeredOnly;
		case "news":
			return node.eventType === "news";
		case "hidden":
			return node.hidden;
		case "major":
			return node.major;
		case "chains":
			return linked?.has(node.id) ?? false;
	}
}

// Narrows the graph to the events matching any selected filter -- an OR, so two filters show more
// than one does, and an empty selection is not a filter at all but the whole file.
//
// What it never does is cut a chain in half. An event dropped from the middle of one is contracted
// out rather than deleted: the call that led into it is redirected to whatever it eventually
// reached, carrying the ids it passed through so the arrow can say what is missing. An event with
// nothing kept downstream loses its arrow, because there is nothing left for it to point at.
export function filteredGraph(
	source: EventGraphPayload,
	filters: readonly EventFilter[],
): VisibleGraph {
	if (filters.length === 0) {
		return { nodes: source.nodes, edges: source.edges, roots: source.roots };
	}

	const linked = filters.includes("chains")
		? chainedIds(source.nodes, source.edges)
		: undefined;

	// An unresolved node is a call to an event no loaded file defines: it has no properties of its
	// own to filter on, so it survives only as the far end of a chain.
	const keptEvents = new Set<string>();
	for (const node of source.nodes) {
		if (node.kind === "event") {
			if (filters.some((filter) => matchesFilter(node, filter, linked))) {
				keptEvents.add(node.id);
			}
		} else if (node.kind === "unresolved" && linked?.has(node.id)) {
			keptEvents.add(node.id);
		}
	}

	// An option belongs to its event and is never filtered on its own: a kept event keeps every
	// choice it offers, dead ends included.
	const kept = new Set(keptEvents);
	for (const edge of source.edges) {
		if (edge.structural && keptEvents.has(edge.from)) {
			kept.add(edge.to);
		}
	}

	// Where an event's calls land, with the option hop collapsed away, so the walk below moves one
	// event at a time rather than alternating between the two kinds of node.
	const owners = ownersOfOptions(source.edges);
	const callsOf = new Map<string, string[]>();
	for (const edge of source.edges) {
		if (edge.structural) {
			continue;
		}
		// An id with owners is an option, and the call belongs to the event above it; anything else
		// is an event making the call itself, which is what an `immediate` or `after` block is.
		const froms = owners.get(edge.from) ?? [edge.from];
		for (const from of froms) {
			const list = callsOf.get(from);
			if (list) {
				list.push(edge.to);
			} else {
				callsOf.set(from, [edge.to]);
			}
		}
	}

	// Breadth first, so each kept event is reached over the shortest run of dropped ones and the
	// count on the arrow is the number of cards actually missing between the two, not the size of
	// the whole region the walk wandered into.
	const bridgeCache = new Map<string, { to: string; skipped: string[] }[]>();
	const bridgesFrom = (start: string): { to: string; skipped: string[] }[] => {
		const cached = bridgeCache.get(start);
		if (cached) {
			return cached;
		}

		const bridges: { to: string; skipped: string[] }[] = [];
		const parent = new Map<string, string | undefined>([[start, undefined]]);
		const queue = [start];
		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) {
				continue;
			}
			for (const next of callsOf.get(current) ?? []) {
				if (parent.has(next)) {
					continue;
				}
				parent.set(next, current);
				if (kept.has(next)) {
					const skipped: string[] = [];
					for (let at: string | undefined = current; at !== undefined; at = parent.get(at)) {
						skipped.unshift(at);
					}
					bridges.push({ to: next, skipped });
				} else {
					queue.push(next);
				}
			}
		}

		bridgeCache.set(start, bridges);
		return bridges;
	};

	const edges: EventGraphEdge[] = [];
	for (const edge of source.edges) {
		if (!kept.has(edge.from)) {
			continue;
		}
		if (kept.has(edge.to)) {
			edges.push(edge);
		} else if (!edge.structural) {
			for (const bridge of bridgesFrom(edge.to)) {
				edges.push({ ...edge, to: bridge.to, skipped: bridge.skipped });
			}
		}
	}

	const hasParent = new Set(edges.map((e) => e.to));
	// A surviving declared root keeps its place first: that is what keeps a group which is nothing
	// but a cycle -- no parentless member at all -- reachable. Anything left without a parent because
	// its only caller was dropped is appended, or the vertical pack never visits it.
	const roots = source.roots.filter((r) => kept.has(r));
	for (const node of source.nodes) {
		if (kept.has(node.id) && !hasParent.has(node.id) && !roots.includes(node.id)) {
			roots.push(node.id);
		}
	}

	return { nodes: source.nodes.filter((n) => kept.has(n.id)), edges, roots };
}

// Case-insensitive substring over what identifies an event: its id, and its title in both forms.
// Both forms, not the one the localisation toggle happens to show -- the toggle decides what is
// drawn, not what the event is called, and matching only the displayed form would make the same
// query find different cards depending on an unrelated toggle. With the localisation index off the
// two are equal anyway, so the second field is free.
//
// Options are deliberately not searchable: the reader is looking for an event.
export function matchesQuery(node: EventGraphNode, query: string): boolean {
	if (query === "" || node.kind === "option") {
		return false;
	}
	const title = node.title;
	return [node.eventId, title?.text ?? "", title?.key ?? ""].some((field) =>
		field.toLowerCase().includes(query),
	);
}

//#endregion

//#region Layout

export interface LayoutInput {
	id: string;
	width: number;
	height: number;
}

// The measured size of an arrow's label. A chip lives in the gap that follows its source column, so
// the gap has to be wide enough to hold it clear of the cards on either side.
export interface ChipInput {
	from: string;
	to: string;
	width: number;
}

export interface LayoutResult {
	positions: Record<string, { x: number; y: number }>;
	rank: Record<string, number>;
	columnX: number[];
	// gapX[i] is the left edge of the empty band between column i and column i + 1, gapWidth[i] its
	// width. Both are indexed by the column on the left of the gap.
	gapX: number[];
	gapWidth: number[];
	width: number;
	height: number;
}

const columnGap = 78;
const rowGap = 18;
const padX = 34;
const padY = 42;
// Clearance kept on either side of a chip inside its gap, and between two chips stacked in one gap.
const chipPadX = 10;
const chipGapY = 6;

// Left-to-right layered layout. The rank of a node picks its column, the column's x comes from the
// widest card in it, and a bottom-up pack stacks each subtree vertically and centres a parent over
// its children.
//
// Two things then guarantee that nothing can overlap, whatever the toggles do to the measured sizes.
// Horizontally, a column is as wide as its widest card and the gap after it is as wide as its widest
// arrow label, so a card and a label can never share space. Vertically, a final per-column sweep
// pushes any card that would still sit on top of the one above it down far enough to clear it; the
// centring survives wherever there is room for it.
export function layoutGraph(
	nodes: LayoutInput[],
	edges: { from: string; to: string }[],
	roots: string[],
	chips: ChipInput[] = [],
): LayoutResult {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const outEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const inEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const seenEdges = new Set<string>();

	for (const edge of edges) {
		if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
			continue;
		}
		// The payload is a DAG, so the same pair can carry several edges -- two differently guarded
		// calls to one event, say. They are one relationship as far as the layout is concerned.
		const key = edge.from + " " + edge.to;
		if (seenEdges.has(key)) {
			continue;
		}
		seenEdges.add(key);
		outEdges.get(edge.from)?.push(edge.to);
		inEdges.get(edge.to)?.push(edge.from);
	}

	// Longest path from a root decides the column, over every incoming edge rather than the first
	// one seen: a node reached both directly and through a longer detour belongs to the right of
	// both callers, or the edge from the deeper one would point backwards.
	const rank = new Map<string, number>();
	const remaining = new Map<string, number>(
		nodes.map((n) => [n.id, (inEdges.get(n.id) ?? []).length]),
	);
	const queue: string[] = [];
	const queued = new Set<string>();
	const processed = new Set<string>();
	for (const node of nodes) {
		if ((remaining.get(node.id) ?? 0) === 0) {
			rank.set(node.id, 0);
			queue.push(node.id);
			queued.add(node.id);
		}
	}

	let cursorIndex = 0;
	while (processed.size < nodes.length) {
		if (cursorIndex >= queue.length) {
			// Everything left sits on a cycle, so nothing will ever reach in-degree zero. Release the
			// first such node in payload order and carry on; the layout stays deterministic and the
			// cycle gets one arbitrary but stable entry point.
			const stuck = nodes.find((n) => !queued.has(n.id));
			if (!stuck) {
				break;
			}
			if (!rank.has(stuck.id)) {
				rank.set(stuck.id, 0);
			}
			queue.push(stuck.id);
			queued.add(stuck.id);
		}

		const current = queue[cursorIndex++];
		if (current === undefined) {
			continue;
		}
		processed.add(current);
		const depth = rank.get(current) ?? 0;
		for (const child of outEdges.get(current) ?? []) {
			rank.set(child, Math.max(rank.get(child) ?? 0, depth + 1));
			const left = (remaining.get(child) ?? 0) - 1;
			remaining.set(child, left);
			if (left <= 0 && !queued.has(child)) {
				queue.push(child);
				queued.add(child);
			}
		}
	}

	// The vertical pack needs a tree. Each node keeps the incoming edge from the column immediately
	// to its left where there is one, so a node with several callers is stacked beside the caller it
	// actually sits next to rather than beside whichever one happened to be first in the payload.
	const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const treeParent = new Map<string, string>();
	for (const node of nodes) {
		const parents = inEdges.get(node.id) ?? [];
		const own = rank.get(node.id) ?? 0;
		const parent = parents.find((p) => (rank.get(p) ?? 0) === own - 1) ?? parents[0];
		if (parent !== undefined) {
			treeParent.set(node.id, parent);
			children.get(parent)?.push(node.id);
		}
	}

	const effectiveRoots = roots.filter((r) => byId.has(r) && !treeParent.has(r));
	for (const node of nodes) {
		if (!treeParent.has(node.id) && !effectiveRoots.includes(node.id)) {
			effectiveRoots.push(node.id);
		}
	}

	const columnWidth: number[] = [];
	for (const node of nodes) {
		const column = rank.get(node.id) ?? 0;
		columnWidth[column] = Math.max(columnWidth[column] ?? 0, node.width);
	}

	// A chip is parked in the gap right after its source column even when the arrow spans several
	// columns, because the space between two columns is the only place on the canvas where no card
	// can ever be. The gap grows to fit the widest chip that lands in it.
	const gapWidth: number[] = [];
	for (let i = 0; i < columnWidth.length; i++) {
		gapWidth[i] = columnGap;
	}
	for (const chip of chips) {
		const gap = rank.get(chip.from);
		if (gap === undefined || gap >= columnWidth.length) {
			continue;
		}
		gapWidth[gap] = Math.max(gapWidth[gap] ?? columnGap, chip.width + chipPadX * 2);
	}

	const columnX: number[] = [];
	const gapX: number[] = [];
	let x = padX;
	for (let i = 0; i < columnWidth.length; i++) {
		columnX[i] = x;
		gapX[i] = x + (columnWidth[i] ?? 0);
		x += (columnWidth[i] ?? 0) + (gapWidth[i] ?? columnGap);
	}

	const positions: Record<string, { x: number; y: number }> = {};
	let cursor = padY;
	const pack = (id: string): { top: number; bottom: number } => {
		const node = byId.get(id);
		if (!node) {
			return { top: cursor, bottom: cursor };
		}
		// Packing the same node twice would move it and, on a cycle, never return.
		const placed = positions[id];
		if (placed) {
			return { top: placed.y, bottom: placed.y + node.height };
		}
		const nodeX = columnX[rank.get(id) ?? 0] ?? padX;
		const kids = children.get(id) ?? [];
		if (kids.length === 0) {
			const top = cursor;
			cursor += node.height + rowGap;
			positions[id] = { x: nodeX, y: top };
			return { top, bottom: top + node.height };
		}
		// Claim a slot before recursing so a cycle back to this node terminates.
		positions[id] = { x: nodeX, y: cursor };
		const spans = kids.map(pack);
		const top = Math.min(...spans.map((s) => s.top));
		const bottom = Math.max(...spans.map((s) => s.bottom));
		const y = (top + bottom) / 2 - node.height / 2;
		positions[id] = { x: nodeX, y };
		return { top: Math.min(top, y), bottom: Math.max(bottom, y + node.height) };
	};
	// A centred parent taller than its children's band reaches past both ends of it, so the next
	// subtree has to start below the whole span rather than below the last leaf the cursor happened
	// to see.
	for (const root of effectiveRoots) {
		const span = pack(root);
		cursor = Math.max(cursor, span.bottom + rowGap) + rowGap;
	}
	// A graph in which every node has a parent -- a pure cycle -- yields no roots at all. Pack
	// whatever is left so a node can never silently vanish from the canvas.
	for (const node of nodes) {
		if (!positions[node.id]) {
			const span = pack(node.id);
			cursor = Math.max(cursor, span.bottom + rowGap) + rowGap;
		}
	}

	// The guarantee. Centring a parent, and reusing the position of a node several callers share,
	// can both put two cards of one column on the same pixels; walking each column top to bottom and
	// pushing anything that still collides below its predecessor removes that for good. Nodes that
	// already clear each other are untouched, so the centring stays visible wherever it fits.
	const byColumn = new Map<number, string[]>();
	for (const node of nodes) {
		const column = rank.get(node.id) ?? 0;
		const list = byColumn.get(column);
		if (list) {
			list.push(node.id);
		} else {
			byColumn.set(column, [node.id]);
		}
	}
	for (const column of byColumn.values()) {
		column.sort((a, b) => {
			const top = (positions[a]?.y ?? 0) - (positions[b]?.y ?? 0);
			// Ties would otherwise resolve by Map insertion order, which is stable but arbitrary.
			return top !== 0 ? top : a.localeCompare(b);
		});
		let previousBottom = -Infinity;
		for (const id of column) {
			const position = positions[id];
			const node = byId.get(id);
			if (!position || !node) {
				continue;
			}
			position.y = Math.max(position.y, previousBottom + rowGap);
			previousBottom = position.y + node.height;
		}
	}

	// Centring can also push a card above the canvas, where it slides under the fixed toolbar. The
	// sweep never moves anything up, so one shift afterwards is enough.
	let minY = Infinity;
	for (const node of nodes) {
		minY = Math.min(minY, positions[node.id]?.y ?? 0);
	}
	if (minY < padY && minY !== Infinity) {
		const shift = padY - minY;
		for (const node of nodes) {
			const position = positions[node.id];
			if (position) {
				position.y += shift;
			}
		}
	}

	let width = padX;
	let height = padY;
	for (const node of nodes) {
		const position = positions[node.id];
		if (position) {
			width = Math.max(width, position.x + node.width);
			height = Math.max(height, position.y + node.height);
		}
	}
	// The last gap holds no chip, but the rail drawn down its middle should still be on the canvas.
	width = Math.max(width, (gapX[gapX.length - 1] ?? padX) + (gapWidth[gapWidth.length - 1] ?? 0));

	return {
		positions,
		rank: Object.fromEntries(rank),
		columnX,
		gapX,
		gapWidth,
		width: width + padX,
		height: height + padY,
	};
}

// Pushes chips that share a gap apart, top to bottom, so two arrow labels can never cover each
// other. Only the y moves: the x is already the centre of a gap no card reaches into.
export function separateChips<T extends { gap: number; y: number; height: number }>(chips: T[]): T[] {
	const byGap = new Map<number, T[]>();
	for (const chip of chips) {
		const list = byGap.get(chip.gap);
		if (list) {
			list.push(chip);
		} else {
			byGap.set(chip.gap, [chip]);
		}
	}
	for (const gap of byGap.values()) {
		gap.sort((a, b) => a.y - b.y);
		let previousBottom = -Infinity;
		for (const chip of gap) {
			chip.y = Math.max(chip.y, previousBottom + chipGapY);
			previousBottom = chip.y + chip.height;
		}
	}
	return chips;
}

//#endregion

//#region Node markup

function badge(container: HTMLElement, className: string, text: string): void {
	const element = document.createElement("span");
	element.className = "ev-badge" + (className ? " " + className : "");
	element.textContent = text;
	container.appendChild(element);
}

// What a card says about the events a filter took out from under it: every id its own arrows now
// step over, in the order they were walked. Collected per event, so an event whose three options all
// bridge past the same card mentions it once.
function skippedByEventOf(graph: VisibleGraph): Map<string, string[]> {
	const owners = ownersOfOptions(graph.edges);
	const byEvent = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!edge.skipped?.length) {
			continue;
		}
		for (const from of owners.get(edge.from) ?? [edge.from]) {
			const list = byEvent.get(from) ?? [];
			for (const id of edge.skipped) {
				if (!list.includes(id)) {
					list.push(id);
				}
			}
			byEvent.set(from, list);
		}
	}
	return byEvent;
}

// One glyph per kind the event actually is, in a fixed order, so the row reads the same way on every
// card and a major news event is not made to choose which of the two it advertises. Each shape owns
// one colour, fixed in the stylesheet, so three glyphs on one card are three colours rather than one
// -- which is what colouring the row by scope used to make them.
function buildMarkers(node: EventGraphEventNode): HTMLDivElement {
	const markers = document.createElement("div");
	markers.className = "ev-markers";
	markers.title = node.eventType + "_event";

	const glyph = (className: string, title: string) => {
		const element = document.createElement("span");
		element.className = "ev-marker " + className;
		element.title = title;
		markers.appendChild(element);
	};

	if (node.eventType === "news") {
		glyph("ev-marker-news", feLocalize("eventtree.news", "News"));
	}
	if (node.major) {
		glyph("ev-marker-major", feLocalize("eventtree.major", "Major"));
	}
	if (node.hidden) {
		glyph("ev-marker-hidden", feLocalize("eventtree.hidden", "Hidden"));
	}
	// Every event is one or the other, so the row is never empty.
	if (node.isTriggeredOnly) {
		glyph("ev-marker-triggered", feLocalize("eventtree.istriggeredonly", "Is triggered only"));
	} else {
		glyph("ev-marker-mtth", feLocalize("eventtree.mtth", "Mean time to happen"));
	}

	return markers;
}

function applyNav(element: HTMLElement, node: EventGraphNode): void {
	if (!node.nav) {
		return;
	}
	element.classList.add("navigator");
	element.setAttribute("start", String(node.nav.start));
	element.setAttribute("end", String(node.nav.end));
	element.setAttribute("file", node.nav.file);
}

function textFor(loc: { key: string; text: string }): string {
	return showLocalisation ? loc.text : loc.key;
}

// The only hint that a card has an effects panel behind it. It is positioned absolutely, so a card
// that has one is exactly as tall as a card that has not -- which the layout depends on, since it
// reserves space from measured heights.
function applyEffectsDot(card: HTMLDivElement, ...effectsRefs: (number | undefined)[]): void {
	if (!showEffects || effectsRefs.every((ref) => ref === undefined)) {
		return;
	}
	const dot = document.createElement("span");
	dot.className = "ev-effects-dot";
	card.appendChild(dot);
}

function buildEventCard(node: EventGraphEventNode): HTMLDivElement {
	const card = document.createElement("div");
	card.className = "ev-card ev-card-event" + (node.hidden ? " ev-card-hidden" : "");
	card.tabIndex = 0;
	applyNav(card, node);

	if (node.picture) {
		card.classList.add("event-picture-host");
		card.setAttribute("picture-style-key", node.picture.styleKey);
		card.setAttribute("picture-width", String(node.picture.width));
	}

	const head = document.createElement("div");
	head.className = "ev-head";

	head.appendChild(buildMarkers(node));

	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = node.eventId;
	text.appendChild(id);
	const sub = document.createElement("div");
	sub.className = "ev-sub";
	sub.textContent = textFor(node.title);
	text.appendChild(sub);
	head.appendChild(text);
	card.appendChild(head);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	if (node.major) {
		badge(meta, "ev-badge-major", feLocalize("eventtree.major", "Major"));
	}
	if (node.hidden) {
		badge(meta, "ev-badge-hidden", feLocalize("eventtree.hidden", "Hidden"));
	}
	if (node.fireOnlyOnce) {
		badge(meta, "", feLocalize("eventtree.fireonlyonce", "Fire only once"));
	}
	if (node.loop) {
		badge(meta, "ev-badge-loop", feLocalize("eventtree.loop", "Loop"));
	}
	const skipped = skippedByEvent.get(node.id);
	if (skipped?.length) {
		badge(meta, "ev-badge-skipped", feLocalize("eventtree.skipped", "{0} filtered out", skipped.length));
		const element = meta.lastElementChild as HTMLElement;
		element.title = feLocalize(
			"eventtree.skippedtitle",
			"Filtered out between this event and the next: {0}",
			skipped.join(", "),
		);
	}
	badge(
		meta,
		"",
		node.isTriggeredOnly
			? feLocalize("eventtree.istriggeredonly", "Is triggered only")
			: `${node.meanTimeToHappenBase} ${feLocalize("days", "day(s)")}`,
	);
	// The glyph row's colour used to say which kind of scope the event fires in; it now says which
	// kinds of event it is, so the scope is written out instead. A country event is the overwhelming
	// majority and the badge would be on nearly every card, so only the rest is named.
	if (node.eventType !== "country") {
		badge(meta, "", node.eventType + "_event");
	}
	badge(meta, "", node.scope);
	card.appendChild(meta);

	if (showEventConditions && node.trigger !== true) {
		card.appendChild(conditionPanel(node.trigger, feLocalize("eventtree.eventtrigger", "Event trigger")));
	}

	applyEffectsDot(card, node.effectsRef, node.afterEffectsRef);
	return card;
}

function buildOptionCard(node: EventGraphOptionNode): HTMLDivElement {
	const gated = showOptionTriggers && node.trigger !== true;
	const card = document.createElement("div");
	card.className = "ev-card ev-card-option" + (gated ? " ev-card-gated" : "");
	card.tabIndex = 0;
	applyNav(card, node);

	const head = document.createElement("div");
	head.className = "ev-head";

	const marker = document.createElement("span");
	marker.className = "ev-marker" + (gated ? " ev-marker-decision" : "");
	if (!gated) {
		marker.style.setProperty("--ev-dot", "var(--ev-border)");
	}
	head.appendChild(marker);

	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = node.name.key;
	text.appendChild(id);
	if (showLocalisation && node.name.text !== node.name.key) {
		const sub = document.createElement("div");
		sub.className = "ev-sub";
		sub.textContent = node.name.text;
		text.appendChild(sub);
	}
	head.appendChild(text);
	card.appendChild(head);

	if (gated) {
		card.appendChild(conditionPanel(node.trigger, feLocalize("eventtree.optiontrigger", "Option trigger")));
	}

	applyEffectsDot(card, node.effectsRef);
	return card;
}

function buildUnresolvedCard(node: EventGraphUnresolvedNode): HTMLDivElement {
	const card = document.createElement("div");
	card.className = "ev-card ev-card-event ev-card-unresolved";
	card.tabIndex = 0;

	const head = document.createElement("div");
	head.className = "ev-head";

	const marker = document.createElement("span");
	marker.className = "ev-marker";
	marker.style.setProperty("--ev-dot", "var(--ev-border)");
	marker.title = feLocalize("eventtree.unresolved", "Unresolved event");
	head.appendChild(marker);

	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = node.eventId;
	text.appendChild(id);
	if (node.title) {
		const sub = document.createElement("div");
		sub.className = "ev-sub";
		sub.textContent = textFor(node.title);
		text.appendChild(sub);
	}
	head.appendChild(text);
	card.appendChild(head);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	badge(meta, "ev-badge-hidden", feLocalize("eventtree.unresolved", "Unresolved event"));
	badge(meta, "", node.scope);
	card.appendChild(meta);

	return card;
}

function buildCard(node: EventGraphNode): HTMLDivElement {
	switch (node.kind) {
		case "event":
			return buildEventCard(node);
		case "option":
			return buildOptionCard(node);
		default:
			return buildUnresolvedCard(node);
	}
}

//#endregion

//#region Render

interface RenderedNode {
	node: EventGraphNode;
	// The positioned wrapper. Hover isolation dims this one.
	element: HTMLDivElement;
	// The card inside it. The search highlight goes here instead, so the two never fight over the
	// same element and neither needs !important.
	card: HTMLDivElement;
}

let rendered: RenderedNode[] = [];
let renderedEdges: { edge: EventGraphEdge; path: SVGPathElement; chip?: HTMLDivElement }[] = [];
let childrenById = new Map<string, string[]>();
// Filled by buildContent before the cards are built, and read by buildEventCard. Empty whenever no
// filter is selected, because nothing can have been left out.
let skippedByEvent = new Map<string, string[]>();

function currentScale(): number {
	return getState().scale || 1;
}

function buildContent(): void {
	const content = document.getElementById("eventtreecontent") as HTMLDivElement | null;
	if (!content) {
		return;
	}

	document
		.querySelectorAll("." + hoverPictureClass + ", ." + effectTooltipClass)
		.forEach((el) => el.remove());
	content.textContent = "";
	rendered = [];
	renderedEdges = [];

	// Before the filters: a control this file cannot use is forced back to its neutral position here,
	// and a filter entry it cannot use is one the stored selection must not be allowed to keep.
	applyToolbarFlags();

	const graph = filteredGraph(payload, filters);
	// The cards are built below and the arrows only afterwards, so what each card has to say about
	// the events missing beneath it is collected from the edges first.
	skippedByEvent = skippedByEventOf(graph);
	if (graph.nodes.length === 0) {
		const empty = document.createElement("div");
		empty.className = "ev-empty";
		empty.textContent = feLocalize("eventtree.noevents", "No event chain to show for this file.");
		content.appendChild(empty);
		// Nothing to highlight, but the counter still has to stop claiming the matches of the graph
		// that was on screen a moment ago.
		applySearch(false);
		return;
	}

	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "ev-edges");
	content.appendChild(svg);

	// Build and measure before laying out: a card's height depends on the toggles.
	const scale = currentScale();
	const measured: LayoutInput[] = [];
	for (const node of graph.nodes) {
		const box = document.createElement("div");
		box.className = "ev-node";
		box.dataset.id = node.id;
		box.style.left = "0px";
		box.style.top = "0px";
		box.style.visibility = "hidden";
		const card = buildCard(node);
		box.appendChild(card);
		content.appendChild(box);
		rendered.push({ node, element: box, card });
	}
	// The arrow labels are measured alongside the cards, because a gap is only wide enough to keep a
	// label clear of the cards if the layout knows how wide the label is.
	const built = buildChips(content, graph);
	for (const item of rendered) {
		const rect = item.element.getBoundingClientRect();
		measured.push({ id: item.node.id, width: rect.width / scale, height: rect.height / scale });
	}
	const chipSizes: ChipInput[] = [];
	for (const { edge, chip } of built) {
		if (chip) {
			chipSizes.push({
				from: edge.from,
				to: edge.to,
				width: chip.getBoundingClientRect().width / scale,
			});
		}
	}

	const layout = layoutGraph(measured, graph.edges, graph.roots, chipSizes);

	for (const item of rendered) {
		const position = layout.positions[item.node.id];
		item.element.style.left = Math.round(position?.x ?? 0) + "px";
		item.element.style.top = Math.round(position?.y ?? 0) + "px";
		item.element.style.visibility = "";
	}

	content.style.width = layout.width + "px";
	content.style.height = layout.height + "px";
	svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
	svg.setAttribute("width", String(layout.width));
	svg.setAttribute("height", String(layout.height));

	renderRails(content, layout);
	renderEdges(content, svg, layout, measured, built);

	childrenById = new Map();
	for (const edge of graph.edges) {
		const list = childrenById.get(edge.from);
		if (list) {
			list.push(edge.to);
		} else {
			childrenById.set(edge.from, [edge.to]);
		}
	}

	wireIsolation();
	if (showPicture) {
		showPictureWhenHover();
	}
	if (showEffects) {
		wireEffectTooltips();
	}
	subscribeNavigators();
	// The query survives every rebuild -- a toggle change, an in-place update, the first load -- so
	// the highlight is re-applied to the cards that were just built. Class flipping only, no layout.
	applySearch(false);
}

function renderRails(content: HTMLDivElement, layout: LayoutResult): void {
	for (let i = 1; i < layout.columnX.length; i++) {
		const rail = document.createElement("div");
		rail.className = "ev-rail";
		// Down the middle of the gap before this column, which is no longer a fixed width.
		rail.style.left = (layout.gapX[i - 1] ?? 0) + (layout.gapWidth[i - 1] ?? columnGap) / 2 + "px";
		rail.style.height = layout.height + "px";
		const label = document.createElement("span");
		label.textContent = feLocalize("eventtree.step", "step {0}", i);
		rail.appendChild(label);
		content.appendChild(rail);
	}
}

// Everything an arrow says next to itself: the scope it fires in, its delay, its random_list weight
// and the condition that guards it.
export function chipTextFor(edge: EventGraphEdge, guarded: boolean): string {
	const bits: string[] = [];
	if (edge.scope && edge.scope !== "{event_target}") {
		bits.push(edge.scope);
	}
	if (edge.days) {
		bits.push(
			`${edge.randomDays ? `${edge.days}-${edge.days + edge.randomDays}` : edge.days} ${feLocalize("days", "day(s)")}`,
		);
	} else if (edge.hours) {
		bits.push(
			`${edge.randomHours ? `${edge.hours}-${edge.hours + edge.randomHours}` : edge.hours} ${feLocalize("hours", "hour(s)")}`,
		);
	}
	// Which of the event's own blocks fired the call. A player option fires nothing by itself, so an
	// arrow out of an option card says nothing here.
	if (edge.source === "immediate") {
		bits.push(feLocalize("eventtree.immediate", "immediate"));
	} else if (edge.source === "after") {
		bits.push(feLocalize("eventtree.after", "after"));
	}
	if (edge.possibility !== undefined) {
		// A random_list key is a weight relative to its siblings, not a percentage: a 3 next to a
		// 1 means three chances in four. The siblings are not on this edge, and a branch modifier
		// can change the totals at runtime anyway, so the weight is shown as written.
		bits.push(feLocalize("eventtree.weight", "weight {0}", edge.possibility));
	}
	if (edge.skipped?.length) {
		bits.push(feLocalize("eventtree.skipped", "{0} filtered out", edge.skipped.length));
	}
	if (guarded) {
		bits.push(conditionToLabel(edge.condition));
	}
	return bits.join(" · ");
}

interface BuiltChip {
	edge: EventGraphEdge;
	guarded: boolean;
	chip?: HTMLDivElement;
}

// Chips are created before the layout runs, because their measured width is what decides how wide
// the gap they sit in has to be. They are hidden until the layout says where they go.
function buildChips(content: HTMLDivElement, graph: VisibleGraph): BuiltChip[] {
	return graph.edges.map((edge) => {
		const guarded = showEdgeConditions && edge.condition !== true;
		const text = chipTextFor(edge, guarded);
		if (!text) {
			return { edge, guarded };
		}
		const chip = document.createElement("div");
		chip.className =
			"ev-chip" +
			(guarded ? " ev-chip-guarded" : "") +
			(edge.skipped?.length ? " ev-chip-bridged" : "");
		chip.textContent = text;
		chip.style.left = "0px";
		chip.style.top = "0px";
		chip.style.visibility = "hidden";
		content.appendChild(chip);
		return { edge, guarded, chip };
	});
}

// x of the cubic used for the arrows, which is monotonic from x1 to x2, so a bisection finds the
// parameter that puts a point at a given x.
function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
	const s = 1 - t;
	return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

function parameterAtX(x1: number, c1: number, c2: number, x2: number, target: number): number {
	let low = 0;
	let high = 1;
	for (let i = 0; i < 20; i++) {
		const mid = (low + high) / 2;
		if (cubicAt(x1, c1, c2, x2, mid) < target) {
			low = mid;
		} else {
			high = mid;
		}
	}
	return (low + high) / 2;
}

function renderEdges(
	content: HTMLDivElement,
	svg: SVGSVGElement,
	layout: LayoutResult,
	measured: LayoutInput[],
	built: BuiltChip[],
): void {
	const sizeById = new Map(measured.map((m) => [m.id, m]));
	const fanOut = new Map<string, number>();
	const placements: { gap: number; x: number; y: number; height: number; chip: HTMLDivElement }[] = [];

	for (const { edge, guarded, chip } of built) {
		const from = layout.positions[edge.from];
		const to = layout.positions[edge.to];
		const fromSize = sizeById.get(edge.from);
		const toSize = sizeById.get(edge.to);
		if (!from || !to || !fromSize || !toSize) {
			chip?.remove();
			continue;
		}

		const index = fanOut.get(edge.from) ?? 0;
		fanOut.set(edge.from, index + 1);

		const x1 = from.x + fromSize.width;
		// Fanning the origins apart keeps parallel arrows readable, but the spread has to stay on the
		// card it leaves from -- unclamped, a node with a dozen calls put the last arrow below its box.
		const spread = Math.min(7, Math.max(2, (fromSize.height - 8) / Math.max(1, index + 1)));
		const y1 = from.y + fromSize.height / 2 + (index - 0.5) * spread;
		const x2 = to.x;
		const y2 = to.y + toSize.height / 2;
		const dx = Math.max(28, (x2 - x1) * 0.5);

		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
		path.setAttribute(
			"class",
			"ev-edge" +
				// The event fires this itself, from its immediate or its after block, rather than
				// waiting for the player to pick an option: both get the same dotted arrow.
				(edge.source !== "option"
					? " ev-edge-immediate"
					: guarded
						? " ev-edge-guarded"
						: "") +
				(edge.skipped?.length ? " ev-edge-bridged" : ""),
		);
		svg.appendChild(path);

		if (chip) {
			// The gap after the source column is the one the layout widened for this chip, and the only
			// band on the canvas guaranteed to be free of cards -- an arrow that skips a column would
			// otherwise drop its label onto a card in between.
			const gap = layout.rank[edge.from] ?? 0;
			const centre = (layout.gapX[gap] ?? x1) + (layout.gapWidth[gap] ?? 0) / 2;
			const t = parameterAtX(x1, x1 + dx, x2 - dx, x2, centre);
			const height = chip.getBoundingClientRect().height / currentScale();
			placements.push({
				gap,
				x: centre,
				y: cubicAt(y1, y1, y2, y2, t) - height / 2,
				height,
				chip,
			});
		}

		renderedEdges.push({ edge, path, chip });
	}

	let bottom = 0;
	for (const placement of separateChips(placements)) {
		placement.chip.style.left = placement.x + "px";
		// .ev-chip is translated by -50% on both axes, so the style position is its centre.
		placement.chip.style.top = placement.y + placement.height / 2 + "px";
		placement.chip.style.visibility = "";
		bottom = Math.max(bottom, placement.y + placement.height);
	}
	if (bottom + padY > layout.height) {
		layout.height = bottom + padY;
		content.style.height = layout.height + "px";
		svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
		svg.setAttribute("height", String(layout.height));
	}
}

//#endregion

//#region Chain isolation

function downstreamOf(id: string): Set<string> {
	const reached = new Set<string>([id]);
	const stack = [id];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) {
			continue;
		}
		for (const child of childrenById.get(current) ?? []) {
			if (!reached.has(child)) {
				reached.add(child);
				stack.push(child);
			}
		}
	}
	return reached;
}

// Class flipping only -- never a re-layout, so isolating a chain stays cheap on a large file.
function setIsolation(reached: Set<string> | undefined): void {
	for (const item of rendered) {
		item.element.classList.toggle("ev-dim", reached !== undefined && !reached.has(item.node.id));
	}
	for (const item of renderedEdges) {
		const on = reached === undefined || (reached.has(item.edge.from) && reached.has(item.edge.to));
		item.path.classList.toggle("ev-edge-dim", !on);
		item.chip?.classList.toggle("ev-dim", !on);
	}
}

function wireIsolation(): void {
	for (const item of rendered) {
		const enter = () => {
			// Cards slide under a stationary cursor while the canvas is dragged, so without this the
			// chain would light up card by card for the length of the drag.
			if (panning$.value) {
				return;
			}
			setIsolation(downstreamOf(item.node.id));
		};
		const leave = () => setIsolation(undefined);
		item.element.addEventListener("mouseenter", enter);
		item.element.addEventListener("mouseleave", leave);
		item.element.addEventListener("focusin", enter);
		item.element.addEventListener("focusout", leave);
	}
}

//#endregion

//#region Search

let searchQuery = "";
let searchHits: RenderedNode[] = [];
// The id of the hit Enter is parked on, not its index into searchHits: a rebuild can drop nodes, and
// remembering the id keeps the cursor on the same card across a toggle change.
let searchCurrentId: string | undefined = undefined;

// Class flipping only -- never a re-layout, so typing stays cheap on a large file. Same contract as
// setIsolation.
function applySearch(navigate: boolean): void {
	searchHits = searchQuery === "" ? [] : rendered.filter((r) => matchesQuery(r.node, searchQuery));
	const hits = new Set(searchHits.map((h) => h.node.id));
	if (searchCurrentId !== undefined && !hits.has(searchCurrentId)) {
		searchCurrentId = undefined;
	}
	for (const item of rendered) {
		item.card.classList.toggle("ev-hit", hits.has(item.node.id));
		item.card.classList.toggle("ev-hit-current", item.node.id === searchCurrentId);
	}
	if (navigate && searchCurrentId !== undefined) {
		scrollToHit(searchHits.find((h) => h.node.id === searchCurrentId));
	}
	updateSearchCount();
}

function cycleSearch(backwards: boolean): void {
	const total = searchHits.length;
	if (total === 0) {
		return;
	}
	const current = searchHits.findIndex((h) => h.node.id === searchCurrentId);
	const next =
		current < 0
			? // The first Enter lands on the first hit, the first Shift+Enter on the last.
				backwards
				? total - 1
				: 0
			: (current + (backwards ? total - 1 : 1)) % total;
	searchCurrentId = searchHits[next]?.node.id;
	applySearch(true);
}

function scrollToHit(hit: RenderedNode | undefined): void {
	// Optional call, not a guard: jsdom leaves scrollIntoView undefined and the webview tests drive
	// this path, where a throw would be swallowed by tryRun and strand the highlight half applied.
	hit?.element.scrollIntoView?.({ block: "center", inline: "center" });
}

function updateSearchCount(): void {
	const label = document.getElementById("ev-search-count");
	if (!label) {
		return;
	}
	if (searchQuery === "") {
		label.textContent = "";
		return;
	}
	if (searchHits.length === 0) {
		label.textContent = feLocalize("eventtree.nomatches", "no matches");
		return;
	}
	// Matches a filter took off the canvas are not in `rendered`, so this counts the ones actually on
	// screen -- which is the number Enter can walk.
	const current = searchHits.findIndex((h) => h.node.id === searchCurrentId);
	label.textContent = feLocalize(
		"eventtree.searchmatches",
		"{0}/{1}",
		current < 0 ? "-" : current + 1,
		searchHits.length,
	);
}

function wireSearch(): void {
	const box = document.getElementById("ev-searchbox") as HTMLInputElement | null;
	if (!box) {
		return;
	}
	searchQuery = (getState().eventSearchQuery ?? "").toLowerCase();
	box.value = searchQuery;

	const onEdit = () => {
		const next = box.value.trim().toLowerCase();
		if (next === searchQuery) {
			return;
		}
		searchQuery = next;
		// Typing highlights; Enter is what jumps. Starting over from the top on every edit keeps the
		// cursor from landing somewhere arbitrary in the new set of hits.
		searchCurrentId = undefined;
		setState({ eventSearchQuery: next });
		applySearch(false);
	};

	box.addEventListener(
		"keypress",
		tryRun((e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				cycleSearch(e.shiftKey);
			} else {
				onEdit();
			}
		}),
	);
	for (const type of ["change", "keyup", "paste", "cut"]) {
		box.addEventListener(type, tryRun(onEdit));
	}
}

//#endregion

//#region Toolbar flags

// A toggle whose flag is false cannot change anything for this file, so the codicon widget built
// over its input is hidden. The widget is the input's next sibling (Checkbox.init inserts it with
// input.after) and the <label> was hidden when the widget was built, so this is one element each.
//
// The stored state of a hidden toggle is forced back to the position that changes nothing. The
// forced value is deliberately not written back through setState, so the reader's own preference
// returns when the file gains pictures (or effects, or localisation) again. The filter list follows
// the same rule: an entry no event in the file matches is taken out of the list and out of the
// working selection, but never out of the stored one -- a stored `hidden` with no hidden event left
// would otherwise empty the canvas with no control on screen to undo it.
// Offering a control the file cannot use is a much smaller failure than hiding one it can, so a
// payload that carries no flags at all falls back to showing everything.
const allToolbarControls: EventToolbarFlags = {
	hasChains: true,
	hasEffects: true,
	hasHidden: true,
	hasMajor: true,
	hasNews: true,
	hasMtth: true,
	hasTriggered: true,
	hasLocalisation: true,
	hasPicture: true,
};

const filterAvailability: Record<EventFilter, keyof EventToolbarFlags> = {
	mtth: "hasMtth",
	triggered: "hasTriggered",
	news: "hasNews",
	hidden: "hasHidden",
	major: "hasMajor",
	chains: "hasChains",
};

function applyToolbarFlags(): void {
	const flags = payload.toolbarFlags ?? allToolbarControls;
	const state = getState();
	// The neutral value is the position that shows the most: with nothing to filter out, "show
	// everything" is the honest state.
	showLocalisation = gateToggle("show-localisation", flags.hasLocalisation, state.showLocalisation, true);
	showPicture = gateToggle("show-picture", flags.hasPicture, state.showPicture, true);
	showEffects = gateToggle("show-effects", flags.hasEffects, state.showEffects, true);
	filters = gateFilters(flags, readFilters(state.eventFilters));
}

// Returns the selection that should be in force, and puts the list on screen in step with it: an
// entry this file cannot match is hidden, which is enough for DivDropdown to stop offering it, and
// the whole control goes when every entry is gone.
function gateFilters(flags: EventToolbarFlags, stored: EventFilter[]): EventFilter[] {
	const available = eventFilters.filter((filter) => flags[filterAvailability[filter]]);
	const select = document.getElementById("ev-filters");
	const container = document.getElementById("ev-filter-container");

	if (container) {
		container.style.display = available.length === 0 ? "none" : "";
	}
	select?.querySelectorAll(".option").forEach((option) => {
		const value = option.getAttribute("value") as EventFilter | null;
		if (value !== null && available.includes(value)) {
			option.removeAttribute("hidden");
		} else {
			option.setAttribute("hidden", "");
		}
	});

	const selection = stored.filter((filter) => available.includes(filter));
	if (filterDropdown) {
		// Pushing this back into the widget is what puts the closed combobox in step with a gating
		// that just dropped an entry. The guard keeps that push out of the subscription below: it is
		// this code's own value, not a click, and storing it would lose the reader's real preference.
		syncingFilters = true;
		try {
			filterDropdown.selectedValues$.next(selection);
		} finally {
			syncingFilters = false;
		}
	}
	return selection;
}

// Returns the value the toggle should hold, and puts the input and its widget in step with it.
//
// While the control is offered that is the reader's own choice, read from the stored state rather
// than from the module variable: the variable may be holding a forced value from a moment ago, and
// the stored one is only ever written by a deliberate click. So a file that gains pictures back --
// through an ordinary in-place update, no reload -- gets the toggle back in the position its reader
// last put it, not in the one the forcing left behind.
function gateToggle(
	id: string,
	available: boolean,
	stored: boolean | undefined,
	neutral: boolean,
): boolean {
	const input = document.getElementById(id) as HTMLInputElement | null;
	const widget = input?.nextElementSibling as HTMLElement | null;
	if (widget) {
		widget.style.display = available ? "" : "none";
	}
	// `neutral` doubles as the default here: a toggle that only shows things starts on, and the one
	// that hides them starts off.
	const value = available ? (stored ?? neutral) : neutral;
	if (input && input.checked !== value) {
		input.checked = value;
		syncCheckbox(input);
	}
	return value;
}

//#endregion

//#region Hover picture

function showPictureWhenHover() {
	const eventNodes = document.getElementsByClassName(
		"event-picture-host",
	) as HTMLCollectionOf<HTMLDivElement>;
	for (let i = 0; i < eventNodes.length; i++) {
		const eventNode = eventNodes.item(i);
		if (eventNode) {
			showPictureWhenHoverElement(eventNode);
		}
	}
}

function showPictureWhenHoverElement(eventNode: HTMLDivElement) {
	const pictureKey = eventNode.attributes.getNamedItem("picture-style-key")?.value;
	const pictureWidthStr = eventNode.attributes.getNamedItem("picture-width")?.value;
	if (!pictureKey || !pictureWidthStr) {
		return;
	}

	const pictureWidth = parseInt(pictureWidthStr);

	let hoverElement: HTMLDivElement | undefined = undefined;

	eventNode.addEventListener("mouseenter", () => {
		if (panning$.value) {
			return;
		}
		// getBoundingClientRect is already in zoomed pixels, but the sprite style is not, so the
		// popup is scaled to match the card it belongs to rather than dwarfing it when zoomed out.
		const scale = currentScale();
		const position = eventNode.getBoundingClientRect();
		hoverElement = document.createElement("div");
		hoverElement.className = pictureKey + " " + hoverPictureClass;
		hoverElement.style.position = "absolute";
		hoverElement.style.transform = `scale(${scale})`;
		hoverElement.style.transformOrigin = "top left";
		hoverElement.style.left =
			position.left + window.scrollX - (pictureWidth * scale - position.width) / 2 + "px";
		hoverElement.style.top =
			clampBelowToolbar(position.top + position.height) + window.scrollY + "px";
		document.body.append(hoverElement);
	});

	eventNode.addEventListener("mouseleave", () => {
		hoverElement?.remove();
	});
}

//#endregion

//#region Hover effects

// Long enough that panning the pointer across a column does not flash a panel per card.
const effectHoverDelay = 150;
// Between the card and the panel, and from the edge of the window.
const effectTipGap = 8;
const effectTipMargin = 4;

// One headed block in the hover panel. An event has two of them -- what it does before the card is
// shown and what it does once the card is dismissed -- and an option has one.
interface EffectSection {
	head: string;
	effects: EffectTreeNode[];
}

function effectSectionsOf(node: EventGraphNode): EffectSection[] {
	if (node.kind === "unresolved") {
		return [];
	}

	const refs: { head: string; ref: number | undefined }[] =
		node.kind === "event"
			? [
					{ head: feLocalize("eventtree.immediateeffects", "Immediate effects"), ref: node.effectsRef },
					{ head: feLocalize("eventtree.aftereffects", "After effects"), ref: node.afterEffectsRef },
				]
			: [{ head: feLocalize("eventtree.effects", "Effects"), ref: node.effectsRef }];

	const sections: EffectSection[] = [];
	for (const { head, ref } of refs) {
		const effects = ref === undefined ? undefined : payload.effectBlocks[ref];
		if (effects && effects.length > 0) {
			sections.push({ head, effects });
		}
	}
	return sections;
}

function wireEffectTooltips(): void {
	for (const item of rendered) {
		const sections = effectSectionsOf(item.node);
		if (sections.length > 0) {
			wireEffectTooltip(item.element, sections);
		}
	}
}

function wireEffectTooltip(host: HTMLDivElement, sections: EffectSection[]): void {
	let panel: HTMLDivElement | undefined = undefined;
	let timer: number | undefined = undefined;

	host.addEventListener("mouseenter", () => {
		if (panning$.value) {
			return;
		}
		timer = window.setTimeout(() => {
			timer = undefined;
			// The card can be gone by the time the delay is up: a re-render replaces every card, and
			// the pointer resting on one leaves this timer behind. Without the check the panel of a
			// card that is no longer on screen opens over the new graph.
			if (!host.isConnected) {
				return;
			}
			panel = buildEffectTooltip(sections);
			document.body.append(panel);
			placeEffectTooltip(panel, host.getBoundingClientRect());
		}, effectHoverDelay);
	});

	host.addEventListener("mouseleave", () => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		panel?.remove();
		panel = undefined;
	});
}

function buildEffectTooltip(sections: EffectSection[]): HTMLDivElement {
	const panel = document.createElement("div");
	// .ev-cond as well, so the panel is typeset exactly like the condition panels on the cards.
	panel.className = "ev-cond " + effectTooltipClass;

	for (const section of sections) {
		const head = document.createElement("div");
		head.className = "ev-cond-head";
		head.textContent = section.head;
		panel.appendChild(head);
		panel.appendChild(effectsToDom(section.effects));
	}

	// The panel sits outside #eventtreecontent, so it does not inherit the canvas zoom; scaling it
	// by hand keeps it the size of the card it belongs to, the way the hover picture is scaled.
	panel.style.transform = `scale(${currentScale()})`;
	panel.style.transformOrigin = "top left";
	panel.style.visibility = "hidden";
	return panel;
}

// To the right of the card, top aligned, flipping to the left when the window has no room. Measured
// after the transform is set, because getBoundingClientRect already reports the scaled size.
function placeEffectTooltip(panel: HTMLDivElement, host: DOMRect): void {
	const size = panel.getBoundingClientRect();
	const viewWidth = document.documentElement.clientWidth;
	const viewHeight = document.documentElement.clientHeight;

	let left = host.right + effectTipGap;
	if (left + size.width > viewWidth) {
		left = host.left - effectTipGap - size.width;
	}
	left = Math.max(effectTipMargin, Math.min(left, viewWidth - size.width - effectTipMargin));

	let top = host.top;
	if (top + size.height > viewHeight) {
		top = viewHeight - size.height - effectTipMargin;
	}
	top = clampBelowToolbar(top);

	panel.style.left = left + window.scrollX + "px";
	panel.style.top = top + window.scrollY + "px";
	panel.style.visibility = "";
}

//#endregion

// A drag starts on the empty canvas, so a popup is rarely open at that moment -- but a card the
// pointer left on its way to the background can still be finishing its fade, and the dragger keeps
// the press even when the pointer runs back over the graph. Sweeping once, the way a re-render
// does, guarantees nothing is left hanging over the canvas while it is being moved.
panning$.subscribe((panning) => {
	if (!panning) {
		return;
	}
	document
		.querySelectorAll("." + hoverPictureClass + ", ." + effectTooltipClass)
		.forEach((el) => el.remove());
	setIsolation(undefined);
});

// In-place update pushed by LoaderPreview when the previewed file changed: re-render from the fresh
// graph without a full reload, so scroll and zoom survive. Falls back to a full reload if the DOM
// the re-render needs is gone (e.g. the webview shows the error page, which has no listener).
window.addEventListener(
	"message",
	tryRun(function (event: MessageEvent) {
		const msg = event.data;
		if (!msg || msg.type !== "updateBody") {
			return;
		}

		const contentElement = document.getElementById("eventtreecontent") as HTMLDivElement | null;
		if (!contentElement) {
			vscode.postMessage({ command: "reload" });
			return;
		}

		if (typeof msg.styleCss === "string") {
			const serverStyles = document.getElementById("event-server-styles");
			if (serverStyles) {
				serverStyles.textContent = msg.styleCss;
			}
		}

		const data = msg.data ?? {};
		if (data.eventGraph) {
			const scrollX = window.scrollX;
			const scrollY = window.scrollY;
			payload = data.eventGraph as EventGraphPayload;
			buildContent();
			window.scrollTo(scrollX, scrollY);
		}
	}),
);

window.addEventListener(
	"load",
	tryRun(function () {
		const contentElement = document.getElementById("eventtreecontent") as HTMLDivElement;
		enableZoom(contentElement, 0, toolbarHeight);

		bindToggle("show-localisation", showLocalisation, (value) => {
			showLocalisation = value;
			setState({ showLocalisation: value });
		});
		bindToggle("show-option-triggers", showOptionTriggers, (value) => {
			showOptionTriggers = value;
			setState({ showOptionTriggers: value });
		});
		bindToggle("show-edge-conditions", showEdgeConditions, (value) => {
			showEdgeConditions = value;
			setState({ showEdgeConditions: value });
		});
		bindToggle("show-event-conditions", showEventConditions, (value) => {
			showEventConditions = value;
			setState({ showEventConditions: value });
		});
		bindToggle("show-picture", showPicture, (value) => {
			showPicture = value;
			setState({ showPicture: value });
		});
		bindToggle("show-effects", showEffects, (value) => {
			showEffects = value;
			setState({ showEffects: value });
		});
		wireFilters();

		// Before the first buildContent, so the restored query is applied by the first render rather
		// than only by the next one.
		wireSearch();

		buildContent();
	}),
);

// The restored selection is pushed into the widget before the subscription is attached, so the
// BehaviorSubject's immediate first emission -- which carries whatever the widget was built with,
// not a choice anyone made -- cannot write an empty selection over the stored one.
function wireFilters(): void {
	const element = document.getElementById("ev-filters") as HTMLDivElement | null;
	if (!element) {
		return;
	}

	filterDropdown = new DivDropdown(element, true, {
		// Selecting nothing is not "no selection" here: it is the whole file, unfiltered.
		empty: feLocalize("eventtree.filterall", "(All events)"),
	});

	syncingFilters = true;
	try {
		filterDropdown.selectedValues$.next(filters);
		filterDropdown.selectedValues$.subscribe(
			tryRun((selection: readonly string[]) => {
				if (syncingFilters) {
					return;
				}
				filters = readFilters(selection);
				setState({ eventFilters: filters });
				buildContent();
			}),
		);
	} finally {
		syncingFilters = false;
	}
}

function bindToggle(id: string, initial: boolean, apply: (value: boolean) => void): void {
	const input = document.getElementById(id) as HTMLInputElement | null;
	if (!input) {
		return;
	}
	input.checked = initial;
	// initCommon's load handler runs before this one, so the codicon checkbox over this input was
	// already built from the unrestored value and would announce a toggle that is on as unchecked.
	syncCheckbox(input);
	input.addEventListener(
		"change",
		tryRun(() => {
			apply(input.checked);
			buildContent();
		}),
	);
}
