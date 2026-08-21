import {
	tryRun,
	subscribeNavigators,
	enableZoom,
	initCommon,
	getState,
	setState,
	panning$,
} from "./util/common";
import { SearchBox } from "./util/searchbox";
import { applyNav, badge } from "./util/card";
import { FilterControl, gateToggle, readFilterList, toggleBinder } from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import {
	DecisionGraphCategoryNode,
	DecisionGraphDecisionNode,
	DecisionGraphEdge,
	DecisionGraphNode,
	DecisionGraphPayload,
	DecisionToolbarFlags,
} from "../src/previewdef/decision/payload";
import { conditionPanel, conditionToLabel } from "./util/conditiontree";
import {
	EffectTooltipOptions,
	TooltipSection,
	wireEffectTooltip,
} from "./util/hovertooltip";
import {
	IsolationHandle,
	RenderedEdge,
	RenderedNode,
	renderGraph,
	wireIsolation,
} from "./util/graphview";

initCommon();

// Marker on the effects panel, which is appended to body outside #decisiontreecontent, so a
// re-render can sweep any that were stranded by replacing their host node mid-hover.
const effectTooltipClass = "dec-effects-tip";

// Mirrors toolbarHeight in src/previewdef/decision/contentbuilder.ts, which is what actually sizes
// the strip. Change one and the other has to follow.
const toolbarHeight = 52;

// The card is this wide, so a scripted GUI window drawn inside one is scaled down to fit it rather
// than pushing the column out to the width of a 1920px game screen.
const guiPreviewWidth = 300;

// Kept as they were: the decision preview has always sat its panel a little further from the card
// than the event preview does.
const effectTooltipOptions: EffectTooltipOptions = {
	className: effectTooltipClass,
	toolbarHeight,
	gap: 12,
	margin: 8,
};

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
	return readFilterList(decisionFilters, stored);
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

let rendered: RenderedNode<DecisionGraphNode>[] = [];
let renderedEdges: RenderedEdge<DecisionGraphEdge>[] = [];
let childrenById = new Map<string, string[]>();
// Replaced by every rebuild, so a drag always puts back the graph that is actually on screen.
let isolation: IsolationHandle | undefined = undefined;
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

function buildContent(): void {
	const content = document.getElementById("decisiontreecontent") as HTMLDivElement | null;
	if (!content) {
		return;
	}

	document.querySelectorAll("." + effectTooltipClass).forEach((el) => el.remove());
	content.textContent = "";
	rendered = [];
	renderedEdges = [];
	isolation = undefined;

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
		search.refresh(rendered);
		return;
	}

	({ rendered, renderedEdges, childrenById } = renderGraph({
		content,
		nodes: graph.nodes,
		edges: graph.edges,
		roots: graph.roots,
		buildCard,
		chipGuarded,
		chipText: chipTextFor,
		edgeClass,
	}));

	isolation = wireIsolation(rendered, renderedEdges, childrenById);
	if (showEffects) {
		wireEffectTooltips();
	}
	subscribeNavigators();
	search.refresh(rendered);
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

// A structural edge is the line from a category to the decisions in it: it carries no condition of
// its own, so nothing guards it.
function chipGuarded(edge: DecisionGraphEdge): boolean {
	return showConditions && !edge.structural && edge.condition !== true;
}

function edgeClass(edge: DecisionGraphEdge, guarded: boolean): string {
	return (
		"ev-edge" +
		(edge.structural ? " dec-edge-structural" : " dec-edge-call") +
		(edge.kind === "remove" ? " dec-edge-remove" : "") +
		(!edge.structural && guarded ? " ev-edge-guarded" : "") +
		(edge.skipped?.length ? " ev-edge-bridged" : "")
	);
}

//#endregion

//#region Search

const search = new SearchBox<RenderedNode<DecisionGraphNode>>({
	boxId: "dec-searchbox",
	countId: "dec-search-count",
	stateKey: "decisionSearchQuery",
	noMatchesKey: "decisiontree.nomatches",
	countKey: "decisiontree.searchmatches",
	matches: (item, query) => matchesQuery(item.node, query),
	target: (item) => ({ id: item.node.id, element: item.element, highlight: item.card }),
});

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

// Every toggle rebuilds the canvas, so the rebuild is bound once instead of at each call site.
const bindToggle = toggleBinder(buildContent);

// Owns the filter widget and the guard that tells a selection this module pushed into it from
// one the reader chose.
const filterControl = new FilterControl<DecisionFilter>({
	selectId: "dec-filters",
	containerId: "dec-filter-container",
	all: decisionFilters,
	emptyKey: "decisiontree.filterall",
	emptyText: "(All decisions)",
	onChange: (selection) => {
		filters = selection;
		setState({ decisionFilters: filters });
		buildContent();
	},
});

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
	filters = filterControl.gate(
		(filter) => flags[filterAvailability[filter]],
		readFilters(state.decisionFilters),
	);
}

//#endregion

//#region Hover effects

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

function effectSectionsOf(node: DecisionGraphNode): TooltipSection[] {
	if (node.kind !== "decision") {
		return [];
	}

	const sections: TooltipSection[] = [];
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
			wireEffectTooltip(item.element, sections, effectTooltipOptions);
		}
	}
}

//#endregion

// A card the pointer left on its way to the background can still be finishing its fade, so sweeping
// once guarantees nothing is left hanging over the canvas while it is being moved.
panning$.subscribe((panning) => {
	if (!panning) {
		return;
	}
	document.querySelectorAll("." + effectTooltipClass).forEach((el) => el.remove());
	isolation?.clear();
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
		filterControl.wire(filters);

		// Before the first buildContent, so the restored query is applied by the first render rather
		// than only by the next one.
		search.wire();

		buildContent();
	}),
);

