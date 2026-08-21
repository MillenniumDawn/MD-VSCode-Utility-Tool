import {
	tryRun,
	subscribeNavigators,
	enableZoom,
	initCommon,
	getState,
	setState,
	panning$,
} from "./util/common";
import { syncCheckbox } from "./util/checkbox";
import { applyNav, badge } from "./util/card";
import { DivDropdown } from "./util/dropdown";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import {
	DecisionGraphCategoryNode,
	DecisionGraphDecisionNode,
	DecisionGraphEdge,
	DecisionGraphNode,
	DecisionGraphPayload,
	DecisionToolbarFlags,
	EffectTreeNode,
} from "../src/previewdef/decision/payload";
import { conditionPanel, conditionToLabel, effectsToDom } from "./util/conditiontree";
import {
	ChipInput,
	LayoutInput,
	LayoutResult,
	columnGap,
	layoutGraph,
	padY,
	separateChips,
} from "./util/graphlayout";

initCommon();

// Marker on the effects panel, which is appended to body outside #decisiontreecontent, so a
// re-render can sweep any that were stranded by replacing their host node mid-hover.
const effectTooltipClass = "dec-effects-tip";

// Mirrors toolbarHeight in src/previewdef/decision/contentbuilder.ts, which is what actually sizes
// the strip. Change one and the other has to follow.
const toolbarHeight = 52;

const effectHoverDelay = 150;
const effectTipGap = 12;
const effectTipMargin = 8;

// The card is this wide, so a scripted GUI window drawn inside one is scaled down to fit it rather
// than pushing the column out to the width of a 1920px game screen.
const guiPreviewWidth = 300;

function clampBelowToolbar(top: number): number {
	return Math.max(toolbarHeight + effectTipMargin, top);
}

const emptyPayload: DecisionGraphPayload = {
	roots: [],
	nodes: [],
	edges: [],
	conditionExprs: [],
	effectBlocks: [],
	toolbarFlags: {
		hasMissions: false,
		hasDecisions: false,
		hasChains: false,
		hasEffects: false,
		hasModifiers: false,
		hasTargets: false,
		hasScriptedGui: false,
		hasConditions: false,
		hasIcons: false,
		hasLocalisation: false,
		hasUnresolvedScriptedGui: false,
	},
};

let payload: DecisionGraphPayload = (window as any).decisionGraph ?? emptyPayload;

let showLocalisation: boolean = getState().decShowLocalisation ?? true;
let showIcon: boolean = getState().decShowIcon ?? true;
let showConditions: boolean = getState().decShowConditions ?? true;
let showEffects: boolean = getState().decShowEffects ?? true;
// Off by default: a game window is much larger than a card, and a reader opening a decisions file
// is usually after the decisions rather than the tab they sit in.
let showScriptedGui: boolean = getState().decShowScriptedGui ?? false;
// Empty by default: an opt-in filter must never hide anything the first time the preview is opened.
let filters: DecisionFilter[] = readFilters(getState().decisionFilters);
let filterDropdown: DivDropdown | undefined = undefined;
// Set while a gated selection is being pushed into the widget, so its subscription can tell a value
// this module computed from one the reader chose. Only the second is worth storing.
let syncingFilters = false;

//#region Filtering

export type DecisionFilter =
	| "missions"
	| "decisions"
	| "chains"
	| "effects"
	| "modifiers"
	| "conditions"
	| "scriptedgui";

// Fixes the order the selection is stored in, so it does not depend on the order they were clicked.
export const decisionFilters: readonly DecisionFilter[] = [
	"missions",
	"decisions",
	"chains",
	"effects",
	"modifiers",
	"conditions",
	"scriptedgui",
];

export function readFilters(stored: unknown): DecisionFilter[] {
	if (!Array.isArray(stored)) {
		return [];
	}
	return decisionFilters.filter((f) => stored.includes(f));
}

export interface VisibleGraph {
	nodes: DecisionGraphNode[];
	edges: DecisionGraphEdge[];
	roots: string[];
}

// The ids of every decision that is either end of a call, so "in a chain" can be filtered on.
export function chainedIds(edges: readonly DecisionGraphEdge[]): Set<string> {
	const linked = new Set<string>();
	for (const edge of edges) {
		if (!edge.structural) {
			linked.add(edge.from);
			linked.add(edge.to);
		}
	}
	return linked;
}

function matchesFilter(
	node: DecisionGraphDecisionNode,
	filter: DecisionFilter,
	linked: Set<string>,
): boolean {
	switch (filter) {
		case "missions":
			return node.isMission;
		case "decisions":
			return !node.isMission;
		case "chains":
			return linked.has(node.id);
		case "effects":
			return node.effects.length > 0;
		case "modifiers":
			return node.modifiers.length > 0;
		case "conditions":
			return (
				node.hasAllowed ||
				node.hasAvailable ||
				node.hasVisible ||
				node.hasActivation ||
				node.hasCancelTrigger
			);
		case "scriptedgui":
			// A decision is never itself a custom GUI; the filter is about the tab it sits in, and
			// that is answered by keeping the category, below.
			return false;
	}
}

// Empty selection is the whole file. Several is an OR.
//
// A category survives when any of its decisions did, so the canvas never fills with empty tabs; the
// `scriptedgui` filter is the one that selects categories directly, which is why it is the only
// filter that can leave a category standing on its own.
export function filteredGraph(
	source: DecisionGraphPayload,
	selected: readonly DecisionFilter[],
): VisibleGraph {
	if (selected.length === 0) {
		return { nodes: source.nodes, edges: source.edges, roots: source.roots };
	}

	const linked = chainedIds(source.edges);
	const wantsGui = selected.includes("scriptedgui");
	const decisionFiltersOnly = selected.filter((f) => f !== "scriptedgui");

	const keptDecisions = new Set<string>();
	for (const node of source.nodes) {
		if (node.kind !== "decision") {
			continue;
		}
		// With only `scriptedgui` selected, no decision filter is in force, so the decisions of a
		// kept category all stay: the reader asked which tabs have a custom GUI, not which buttons.
		const matches =
			decisionFiltersOnly.length === 0
				? wantsGui
				: decisionFiltersOnly.some((f) => matchesFilter(node, f, linked));
		if (matches) {
			keptDecisions.add(node.id);
		}
	}

	const categoriesWithKept = new Set<string>();
	for (const edge of source.edges) {
		if (edge.structural && keptDecisions.has(edge.to)) {
			categoriesWithKept.add(edge.from);
		}
	}

	const kept = new Set<string>(keptDecisions);
	for (const node of source.nodes) {
		if (node.kind === "category") {
			const hasGui = wantsGui && node.scriptedGui !== undefined;
			// A category kept only for its GUI keeps its decisions with it, or the tab would be drawn
			// with nothing in it.
			if (hasGui || categoriesWithKept.has(node.id)) {
				kept.add(node.id);
				if (hasGui && decisionFiltersOnly.length === 0) {
					for (const edge of source.edges) {
						if (edge.structural && edge.from === node.id) {
							kept.add(edge.to);
						}
					}
				}
			}
		} else if (node.kind === "unresolved") {
			// A placeholder is only worth drawing while something still points at it.
			continue;
		}
	}

	// Bridge the calls that ran through a decision the filter removed, so a chain keeps its arrow
	// rather than falling into two halves.
	const bridged = bridgeEdges(source.edges, kept);

	for (const edge of bridged) {
		if (kept.has(edge.from)) {
			const target = source.nodes.find((n) => n.id === edge.to);
			if (target?.kind === "unresolved") {
				kept.add(edge.to);
			}
		}
	}

	const nodes = source.nodes.filter((n) => kept.has(n.id));
	const edges = bridged.filter((e) => kept.has(e.from) && kept.has(e.to));
	const withParent = new Set(edges.filter((e) => e.structural).map((e) => e.to));
	const roots = nodes.filter((n) => !withParent.has(n.id)).map((n) => n.id);

	return { nodes, edges, roots };
}

// Every call edge, with the ones that end on a removed decision redirected to whatever that
// decision went on to call. The decisions passed through are recorded on the edge so the arrow can
// say how many were left out.
function bridgeEdges(
	edges: readonly DecisionGraphEdge[],
	kept: Set<string>,
): DecisionGraphEdge[] {
	const outgoing = new Map<string, DecisionGraphEdge[]>();
	for (const edge of edges) {
		if (edge.structural) {
			continue;
		}
		const list = outgoing.get(edge.from);
		if (list) {
			list.push(edge);
		} else {
			outgoing.set(edge.from, [edge]);
		}
	}

	const result: DecisionGraphEdge[] = [];
	for (const edge of edges) {
		if (edge.structural || kept.has(edge.to)) {
			result.push(edge);
			continue;
		}

		// Breadth first from the removed decision, collecting what it reaches that survived.
		const seen = new Set<string>([edge.to]);
		const skipped: string[] = [edge.to];
		const queue = [edge.to];
		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) {
				continue;
			}
			for (const next of outgoing.get(current) ?? []) {
				if (seen.has(next.to)) {
					continue;
				}
				seen.add(next.to);
				if (kept.has(next.to)) {
					result.push({ ...edge, to: next.to, skipped: [...skipped] });
				} else {
					skipped.push(next.to);
					queue.push(next.to);
				}
			}
		}
	}

	return result;
}

export function matchesQuery(node: DecisionGraphNode, query: string): boolean {
	if (query === "") {
		return true;
	}

	const fields: string[] = [];
	if (node.kind === "category") {
		fields.push(node.categoryKey, node.name.text, node.name.key);
		if (node.scriptedGui) {
			fields.push(node.scriptedGui.name);
		}
	} else if (node.kind === "decision") {
		fields.push(node.decisionId, node.name.text, node.name.key, node.category);
		for (const modifier of node.modifiers) {
			fields.push(modifier.key, modifier.name);
		}
		for (const badge of node.badges) {
			fields.push(badge);
		}
	} else {
		fields.push(node.decisionId, node.name?.text ?? "", node.name?.key ?? "");
	}

	return fields.some((field) => field.toLowerCase().includes(query));
}

//#endregion

//#region Node markup

function iconElement(icon: { styleKey: string; width: number; height: number }): HTMLDivElement {
	const element = document.createElement("div");
	element.className = "dec-icon " + icon.styleKey;
	// Drawn at a fixed height so a row of cards lines up whatever size the sprites happen to be,
	// with the width following the sprite's own proportions.
	const height = Math.min(28, icon.height);
	element.style.height = height + "px";
	element.style.width = Math.max(8, Math.round((icon.width / icon.height) * height)) + "px";
	return element;
}

function head(card: HTMLDivElement, node: DecisionGraphNode, markers: string[]): void {
	const bar = document.createElement("div");
	bar.className = "ev-head";

	for (const kind of markers) {
		const marker = document.createElement("span");
		marker.className = "ev-marker dec-marker-" + kind;
		bar.appendChild(marker);
	}

	if (showIcon && node.kind !== "unresolved" && node.icon) {
		bar.appendChild(iconElement(node.icon));
	}

	const text = document.createElement("div");
	text.className = "ev-text";

	const title = document.createElement("div");
	title.className = "ev-id";
	const loc = node.kind === "unresolved" ? node.name : node.name;
	title.textContent = showLocalisation && loc ? loc.text : identifierOf(node);
	text.appendChild(title);

	const sub = document.createElement("div");
	sub.className = "ev-sub";
	sub.textContent = showLocalisation ? identifierOf(node) : (loc?.text ?? "");
	if (sub.textContent && sub.textContent !== title.textContent) {
		text.appendChild(sub);
	}

	bar.appendChild(text);
	card.appendChild(bar);
}

function identifierOf(node: DecisionGraphNode): string {
	return node.kind === "category" ? node.categoryKey : node.decisionId;
}

function buildCategoryCard(node: DecisionGraphCategoryNode): HTMLDivElement {
	const card = document.createElement("div");
	card.className = "ev-card dec-card-category";
	head(card, node, node.scriptedGui ? ["gui"] : []);
	applyNav(card, node.nav, true);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	if (!node.defined) {
		badge(
			meta,
			"dec-badge-warn",
			feLocalize("decisiontree.categoryundefined", "No category definition found"),
		);
	}
	if (node.priority !== undefined) {
		badge(meta, "", feLocalize("decisiontree.priority", "Priority {0}", node.priority));
	}
	if (node.visibleWhenEmpty) {
		badge(meta, "", feLocalize("decisiontree.visiblewhenempty", "Tab shown when empty"));
	}
	if (node.scriptedGui) {
		badge(
			meta,
			node.scriptedGui.html ? "dec-badge-gui" : "dec-badge-warn",
			node.scriptedGui.html
				? feLocalize("decisiontree.customgui", "Custom GUI: {0}", node.scriptedGui.name)
				: feLocalize(
						"decisiontree.customguimissing",
						"Custom GUI {0}: window not found",
						node.scriptedGui.name,
					),
		);
	}
	if (meta.childElementCount > 0) {
		card.appendChild(meta);
	}

	if (showConditions) {
		if (node.hasAllowed) {
			card.appendChild(conditionPanel(node.allowed, feLocalize("decisiontree.allowed", "Allowed")));
		}
		if (node.hasVisible) {
			card.appendChild(conditionPanel(node.visible, feLocalize("decisiontree.visible", "Visible")));
		}
	}

	if (showScriptedGui && node.scriptedGui?.html) {
		card.appendChild(buildGuiFrame(node.scriptedGui.html));
	}

	return card;
}

// The window is rendered by the host at the size the game draws it, which is far wider than a card,
// so it is scaled down into a fixed frame. A transform rather than a zoom, so the sprites inside
// keep their own positioning.
function buildGuiFrame(html: string): HTMLDivElement {
	const frame = document.createElement("div");
	frame.className = "dec-gui-frame";
	frame.innerHTML = html;

	const inner = frame.firstElementChild as HTMLElement | null;
	const width = parseInt(inner?.style.width ?? "0", 10);
	const height = parseInt(inner?.style.height ?? "0", 10);
	if (inner && width > 0) {
		const scale = Math.min(1, guiPreviewWidth / width);
		inner.style.transform = `scale(${scale})`;
		inner.style.transformOrigin = "top left";
		frame.style.width = Math.round(width * scale) + "px";
		frame.style.height = Math.round(height * scale) + "px";
	}

	return frame;
}

function buildDecisionCard(node: DecisionGraphDecisionNode): HTMLDivElement {
	const card = document.createElement("div");
	card.className = "ev-card " + (node.isMission ? "dec-card-mission" : "dec-card-decision");
	head(card, node, [node.isMission ? "mission" : "decision"]);
	applyNav(card, node.nav, true);

	const meta = document.createElement("div");
	meta.className = "ev-meta";

	if (node.isMission) {
		badge(
			meta,
			node.isGood === false ? "dec-badge-threat" : "dec-badge-goal",
			node.daysMissionTimeout !== undefined
				? feLocalize("decisiontree.missiontimeout", "{0} day mission", node.daysMissionTimeout)
				: feLocalize("decisiontree.mission", "Mission"),
		);
		if (node.isGood !== undefined) {
			badge(
				meta,
				"",
				node.isGood
					? feLocalize("decisiontree.missiongoal", "Goal")
					: feLocalize("decisiontree.missionthreat", "Threat"),
			);
		}
		if (node.selectableMission) {
			badge(
				meta,
				"",
				feLocalize("decisiontree.selectablemission", "Can be completed early"),
			);
		}
	}
	if (node.fireOnlyOnce) {
		badge(meta, "", feLocalize("decisiontree.fireonlyonce", "Once only"));
	}
	if (node.borrowsName) {
		badge(meta, "", feLocalize("decisiontree.borrowedname", "Localised as {0}", node.name.key));
	}
	if (node.iconCount > 1) {
		badge(meta, "", feLocalize("decisiontree.moreicons", "{0} icons chosen by trigger", node.iconCount));
	}
	for (const text of node.badges) {
		badge(meta, "", text);
	}

	const skipped = skippedByDecision.get(node.id);
	if (skipped?.length) {
		const element = document.createElement("span");
		element.className = "ev-badge dec-badge-skipped";
		element.textContent = feLocalize("decisiontree.skipped", "{0} filtered out", skipped.length);
		element.title = feLocalize(
			"decisiontree.skippedtitle",
			"Filtered out between this decision and the next: {0}",
			skipped.join(", "),
		);
		meta.appendChild(element);
	}

	if (meta.childElementCount > 0) {
		card.appendChild(meta);
	}

	if (node.modifiers.length > 0) {
		const box = document.createElement("div");
		box.className = "ev-cond dec-modifiers";
		const title = document.createElement("div");
		title.className = "ev-cond-head";
		title.textContent = feLocalize("decisiontree.modifiers", "Modifiers");
		box.appendChild(title);
		const list = document.createElement("ul");
		for (const line of node.modifiers) {
			const item = document.createElement("li");
			item.className = "dec-modifier dec-tone-" + line.tone;
			const name = document.createElement("span");
			name.className = "dec-modifier-name";
			name.textContent = line.name;
			const value = document.createElement("span");
			value.className = "dec-modifier-value";
			value.textContent = line.value;
			item.appendChild(name);
			item.appendChild(value);
			list.appendChild(item);
		}
		box.appendChild(list);
		card.appendChild(box);
	}

	if (showConditions) {
		const blocks: [boolean, unknown, string][] = [
			[node.hasActivation, node.activation, feLocalize("decisiontree.activation", "Activation")],
			[node.hasAllowed, node.allowed, feLocalize("decisiontree.allowed", "Allowed")],
			[node.hasAvailable, node.available, feLocalize("decisiontree.available", "Available")],
			[node.hasVisible, node.visible, feLocalize("decisiontree.visible", "Visible")],
			[
				node.hasCancelTrigger,
				node.cancelTrigger,
				feLocalize("decisiontree.canceltrigger", "Cancelled when"),
			],
		];
		for (const [has, condition, label] of blocks) {
			if (has) {
				card.appendChild(conditionPanel(condition as never, label));
			}
		}
	}

	if (showEffects && node.effects.length > 0) {
		const dot = document.createElement("span");
		dot.className = "ev-effects-dot";
		card.appendChild(dot);
	}

	return card;
}

function buildUnresolvedCard(node: DecisionGraphNode & { kind: "unresolved" }): HTMLDivElement {
	const card = document.createElement("div");
	card.className = "ev-card dec-card-unresolved";
	head(card, node, []);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	badge(meta, "dec-badge-warn", feLocalize("decisiontree.unresolved", "Not defined in this file"));
	card.appendChild(meta);

	return card;
}

function buildCard(node: DecisionGraphNode): HTMLDivElement {
	switch (node.kind) {
		case "category":
			return buildCategoryCard(node);
		case "decision":
			return buildDecisionCard(node);
		default:
			return buildUnresolvedCard(node);
	}
}

//#endregion

//#region Render

interface RenderedNode {
	node: DecisionGraphNode;
	element: HTMLDivElement;
	card: HTMLDivElement;
}

let rendered: RenderedNode[] = [];
let renderedEdges: { edge: DecisionGraphEdge; path: SVGPathElement; chip?: HTMLDivElement }[] = [];
let childrenById = new Map<string, string[]>();
// Filled by buildContent before the cards are built, and read by buildDecisionCard. Empty whenever
// no filter is selected, because nothing can have been left out.
let skippedByDecision = new Map<string, string[]>();

function skippedByDecisionOf(graph: VisibleGraph): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const edge of graph.edges) {
		if (!edge.skipped?.length) {
			continue;
		}
		const existing = result.get(edge.from);
		if (existing) {
			for (const id of edge.skipped) {
				if (!existing.includes(id)) {
					existing.push(id);
				}
			}
		} else {
			result.set(edge.from, [...edge.skipped]);
		}
	}
	return result;
}

function currentScale(): number {
	return getState().scale || 1;
}

function buildContent(): void {
	const content = document.getElementById("decisiontreecontent") as HTMLDivElement | null;
	if (!content) {
		return;
	}

	document.querySelectorAll("." + effectTooltipClass).forEach((el) => el.remove());
	content.textContent = "";
	rendered = [];
	renderedEdges = [];

	// Before the filters: a control this file cannot use is forced back to its neutral position
	// here, and a filter entry it cannot use is one the stored selection must not keep.
	applyToolbarFlags();

	const graph = filteredGraph(payload, filters);
	skippedByDecision = skippedByDecisionOf(graph);

	if (graph.nodes.length === 0) {
		const empty = document.createElement("div");
		empty.className = "ev-empty";
		empty.textContent = feLocalize(
			"decisiontree.nodecisions",
			"No decisions to show for this file.",
		);
		content.appendChild(empty);
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
	if (showEffects) {
		wireEffectTooltips();
	}
	subscribeNavigators();
	applySearch(false);
}

function renderRails(content: HTMLDivElement, layout: LayoutResult): void {
	for (let i = 1; i < layout.columnX.length; i++) {
		const rail = document.createElement("div");
		rail.className = "ev-rail";
		rail.style.left = (layout.gapX[i - 1] ?? 0) + (layout.gapWidth[i - 1] ?? columnGap) / 2 + "px";
		rail.style.height = layout.height + "px";
		content.appendChild(rail);
	}
}

// Everything an arrow says next to itself: what one decision does to another, the random_list weight
// it does it with, and the condition guarding it.
export function chipTextFor(edge: DecisionGraphEdge, guarded: boolean): string {
	if (edge.structural) {
		return "";
	}

	const bits: string[] = [];
	if (edge.kind === "activate") {
		bits.push(feLocalize("decisiontree.callactivate", "activates"));
	} else if (edge.kind === "unlock") {
		bits.push(feLocalize("decisiontree.callunlock", "unlocks"));
	} else if (edge.kind === "remove") {
		bits.push(feLocalize("decisiontree.callremove", "removes"));
	}
	if (edge.possibility !== undefined) {
		// A random_list key is a weight relative to its siblings, not a percentage, and a modifier
		// can change the totals at runtime, so it is shown as written.
		bits.push(feLocalize("eventtree.weight", "weight {0}", edge.possibility));
	}
	if (edge.skipped?.length) {
		bits.push(feLocalize("decisiontree.skipped", "{0} filtered out", edge.skipped.length));
	}
	if (guarded) {
		bits.push(conditionToLabel(edge.condition));
	}
	return bits.join(" · ");
}

interface BuiltChip {
	edge: DecisionGraphEdge;
	guarded: boolean;
	chip?: HTMLDivElement;
}

// Chips are created before the layout runs, because their measured width is what decides how wide
// the gap they sit in has to be. They are hidden until the layout says where they go.
function buildChips(content: HTMLDivElement, graph: VisibleGraph): BuiltChip[] {
	return graph.edges.map((edge) => {
		const guarded = showConditions && !edge.structural && edge.condition !== true;
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
	const placements: { gap: number; x: number; y: number; height: number; chip: HTMLDivElement }[] =
		[];

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
		// Fanning the origins apart keeps parallel arrows readable, but the spread has to stay on
		// the card it leaves from -- unclamped, a category with a dozen decisions put the last arrow
		// below its box.
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
				(edge.structural ? " dec-edge-structural" : " dec-edge-call") +
				(edge.kind === "remove" ? " dec-edge-remove" : "") +
				(!edge.structural && guarded ? " ev-edge-guarded" : "") +
				(edge.skipped?.length ? " ev-edge-bridged" : ""),
		);
		svg.appendChild(path);

		if (chip) {
			// The gap after the source column is the one the layout widened for this chip, and the
			// only band on the canvas guaranteed to be free of cards.
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
	const label = document.getElementById("dec-search-count");
	if (!label) {
		return;
	}
	if (searchQuery === "") {
		label.textContent = "";
		return;
	}
	if (searchHits.length === 0) {
		label.textContent = feLocalize("decisiontree.nomatches", "no matches");
		return;
	}
	const current = searchHits.findIndex((h) => h.node.id === searchCurrentId);
	label.textContent = feLocalize(
		"decisiontree.searchmatches",
		"{0}/{1}",
		current < 0 ? "-" : current + 1,
		searchHits.length,
	);
}

function wireSearch(): void {
	const box = document.getElementById("dec-searchbox") as HTMLInputElement | null;
	if (!box) {
		return;
	}
	searchQuery = (getState().decisionSearchQuery ?? "").toLowerCase();
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
		setState({ decisionSearchQuery: next });
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

// Offering a control the file cannot use is a much smaller failure than hiding one it can, so a
// payload that carries no flags at all falls back to showing everything.
const allToolbarControls: DecisionToolbarFlags = {
	hasMissions: true,
	hasDecisions: true,
	hasChains: true,
	hasEffects: true,
	hasModifiers: true,
	hasTargets: true,
	hasScriptedGui: true,
	hasConditions: true,
	hasIcons: true,
	hasLocalisation: true,
	hasUnresolvedScriptedGui: true,
};

const filterAvailability: Record<DecisionFilter, keyof DecisionToolbarFlags> = {
	missions: "hasMissions",
	decisions: "hasDecisions",
	chains: "hasChains",
	effects: "hasEffects",
	modifiers: "hasModifiers",
	conditions: "hasConditions",
	scriptedgui: "hasScriptedGui",
};

function applyToolbarFlags(): void {
	const flags = payload.toolbarFlags ?? allToolbarControls;
	const state = getState();
	// The neutral value is the position that shows the most: with nothing to hide, "show everything"
	// is the honest state. The scripted GUI toggle is the exception -- its neutral position is off,
	// because a window nothing can draw would only add an empty frame.
	showLocalisation = gateToggle(
		"show-localisation",
		flags.hasLocalisation,
		state.decShowLocalisation,
		true,
	);
	showIcon = gateToggle("show-icon", flags.hasIcons, state.decShowIcon, true);
	showConditions = gateToggle("show-conditions", flags.hasConditions, state.decShowConditions, true);
	showEffects = gateToggle("show-effects", flags.hasEffects, state.decShowEffects, true);
	showScriptedGui = gateToggle(
		"show-scripted-gui",
		flags.hasScriptedGui,
		state.decShowScriptedGui,
		false,
	);
	filters = gateFilters(flags, readFilters(state.decisionFilters));
}

// Returns the selection that should be in force, and puts the list on screen in step with it: an
// entry this file cannot match is hidden, which is enough for DivDropdown to stop offering it, and
// the whole control goes when every entry is gone.
function gateFilters(flags: DecisionToolbarFlags, stored: DecisionFilter[]): DecisionFilter[] {
	const available = decisionFilters.filter((filter) => flags[filterAvailability[filter]]);
	const select = document.getElementById("dec-filters");
	const container = document.getElementById("dec-filter-container");

	if (container) {
		container.style.display = available.length === 0 ? "none" : "";
	}
	select?.querySelectorAll(".option").forEach((option) => {
		const value = option.getAttribute("value") as DecisionFilter | null;
		if (value !== null && available.includes(value)) {
			option.removeAttribute("hidden");
		} else {
			option.setAttribute("hidden", "");
		}
	});

	const selection = stored.filter((filter) => available.includes(filter));
	if (filterDropdown) {
		// Pushing this back into the widget is what puts the closed combobox in step with a gating
		// that just dropped an entry. The guard keeps that push out of the subscription: it is this
		// code's own value, not a click, and storing it would lose the reader's real preference.
		syncingFilters = true;
		try {
			filterDropdown.selectedValues$.next(selection);
		} finally {
			syncingFilters = false;
		}
	}
	return selection;
}

// Returns the value the toggle should hold, and puts the input and its widget in step with it. The
// stored value is read rather than the module variable, so a file that gains icons back gets the
// toggle in the position its reader last put it, not the one a forcing left behind.
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
	const value = available ? (stored ?? neutral) : neutral;
	if (input && input.checked !== value) {
		input.checked = value;
		syncCheckbox(input);
	}
	return value;
}

//#endregion

//#region Hover effects

interface EffectSection {
	head: string;
	effects: EffectTreeNode[];
}

const effectBlockLabels: Record<string, string> = {
	complete_effect: "decisiontree.completeeffect",
	remove_effect: "decisiontree.removeeffect",
	timeout_effect: "decisiontree.timeouteffect",
	cancel_effect: "decisiontree.canceleffect",
};

const effectBlockFallbacks: Record<string, string> = {
	complete_effect: "On completion",
	remove_effect: "When it wears off",
	timeout_effect: "When the timer runs out",
	cancel_effect: "When cancelled",
};

function effectSectionsOf(node: DecisionGraphNode): EffectSection[] {
	if (node.kind !== "decision") {
		return [];
	}

	const sections: EffectSection[] = [];
	for (const { name, ref } of node.effects) {
		const effects = payload.effectBlocks[ref];
		if (effects && effects.length > 0) {
			sections.push({
				head: feLocalize(
					effectBlockLabels[name] as never,
					effectBlockFallbacks[name] ?? name,
				),
				effects,
			});
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
			// the pointer resting on one leaves this timer behind.
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

	// The panel sits outside #decisiontreecontent, so it does not inherit the canvas zoom; scaling
	// it by hand keeps it the size of the card it belongs to.
	panel.style.transform = `scale(${currentScale()})`;
	panel.style.transformOrigin = "top left";
	panel.style.visibility = "hidden";
	return panel;
}

// To the right of the card, top aligned, flipping to the left when the window has no room.
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

// A card the pointer left on its way to the background can still be finishing its fade, so sweeping
// once guarantees nothing is left hanging over the canvas while it is being moved.
panning$.subscribe((panning) => {
	if (!panning) {
		return;
	}
	document.querySelectorAll("." + effectTooltipClass).forEach((el) => el.remove());
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

		const contentElement = document.getElementById(
			"decisiontreecontent",
		) as HTMLDivElement | null;
		if (!contentElement) {
			vscode.postMessage({ command: "reload" });
			return;
		}

		if (typeof msg.styleCss === "string") {
			const serverStyles = document.getElementById("decision-server-styles");
			if (serverStyles) {
				serverStyles.textContent = msg.styleCss;
			}
		}

		const data = msg.data ?? {};
		if (data.decisionGraph) {
			const scrollX = window.scrollX;
			const scrollY = window.scrollY;
			payload = data.decisionGraph as DecisionGraphPayload;
			buildContent();
			window.scrollTo(scrollX, scrollY);
		}
	}),
);

window.addEventListener(
	"load",
	tryRun(function () {
		const contentElement = document.getElementById("decisiontreecontent") as HTMLDivElement;
		enableZoom(contentElement, 0, toolbarHeight);

		bindToggle("show-localisation", showLocalisation, (value) => {
			showLocalisation = value;
			setState({ decShowLocalisation: value });
		});
		bindToggle("show-icon", showIcon, (value) => {
			showIcon = value;
			setState({ decShowIcon: value });
		});
		bindToggle("show-conditions", showConditions, (value) => {
			showConditions = value;
			setState({ decShowConditions: value });
		});
		bindToggle("show-effects", showEffects, (value) => {
			showEffects = value;
			setState({ decShowEffects: value });
		});
		bindToggle("show-scripted-gui", showScriptedGui, (value) => {
			showScriptedGui = value;
			setState({ decShowScriptedGui: value });
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
	const element = document.getElementById("dec-filters") as HTMLDivElement | null;
	if (!element) {
		return;
	}

	filterDropdown = new DivDropdown(element, true, {
		// Selecting nothing is not "no selection" here: it is the whole file, unfiltered.
		empty: feLocalize("decisiontree.filterall", "(All decisions)"),
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
				setState({ decisionFilters: filters });
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
