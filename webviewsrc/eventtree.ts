import {
	tryRun,
	subscribeNavigators,
	enableZoom,
	initCommon,
	getState,
	setState,
	panning$,
	currentScale,
} from "./util/common";
import { SearchBox } from "./util/searchbox";
import { applyNav, badge } from "./util/card";
import { FilterControl, gateToggle, readFilterList, toggleBinder } from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { wireUpdateBody } from "./util/updatebody";
import {
	EventGraphEdge,
	EventGraphEventNode,
	EventGraphNode,
	EventGraphOptionNode,
	EventGraphPayload,
	EventGraphUnresolvedNode,
	EventToolbarFlags,
} from "../src/previewdef/event/payload";
import { conditionToLabel, conditionPanel } from "./util/conditiontree";
import {
	EffectTooltipOptions,
	TooltipSection,
	clampBelowToolbar,
	wireEffectTooltip,
} from "./util/hovertooltip";
import {
	IsolationHandle,
	RenderedEdge,
	RenderedNode,
	renderGraph,
	wireIsolation,
} from "./util/graphview";

// The condition/effect rendering and the graph layout are shared with the decision preview and now
// live in webviewsrc/util. They are re-exported here, the way loaderpreview.ts re-exports the update
// machinery, so this module's tests and any other importer keep reaching them from one place.
export {
	conditionToDom,
	conditionToLabel,
	conditionPanel,
	effectsToDom,
	countEffectLines,
} from "./util/conditiontree";
export {
	ChipInput,
	LayoutInput,
	LayoutResult,
	layoutGraph,
	separateChips,
} from "./util/graphlayout";

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
// The hover picture and the effects panel are both appended to <body> and both kept the same
// distance clear of the toolbar and of the window edge.
const popupMargin = 4;

const effectTooltipOptions: EffectTooltipOptions = {
	className: effectTooltipClass,
	toolbarHeight,
	gap: 8,
	margin: popupMargin,
};

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
	return readFilterList(eventFilters, stored);
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

//#region Node markup

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
	applyNav(card, node.nav);

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
	applyNav(card, node.nav);

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

let rendered: RenderedNode<EventGraphNode>[] = [];
let renderedEdges: RenderedEdge<EventGraphEdge>[] = [];
let childrenById = new Map<string, string[]>();
// Replaced by every rebuild, so a drag always puts back the graph that is actually on screen.
let isolation: IsolationHandle | undefined = undefined;
// Filled by buildContent before the cards are built, and read by buildEventCard. Empty whenever no
// filter is selected, because nothing can have been left out.
let skippedByEvent = new Map<string, string[]>();

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
	isolation = undefined;

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
		railLabel: (step: number) => feLocalize("eventtree.step", "step {0}", step),
	}));

	isolation = wireIsolation(rendered, renderedEdges, childrenById);
	if (showPicture) {
		showPictureWhenHover();
	}
	if (showEffects) {
		wireEffectTooltips();
	}
	subscribeNavigators();
	// The query survives every rebuild -- a toggle change, an in-place update, the first load -- so
	// the highlight is re-applied to the cards that were just built. Class flipping only, no layout.
	search.refresh(rendered);
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

function chipGuarded(edge: EventGraphEdge): boolean {
	return showEdgeConditions && edge.condition !== true;
}

function edgeClass(edge: EventGraphEdge, guarded: boolean): string {
	return (
		"ev-edge" +
		// The event fires this itself, from its immediate or its after block, rather than waiting for
		// the player to pick an option: both get the same dotted arrow.
		(edge.source !== "option" ? " ev-edge-immediate" : guarded ? " ev-edge-guarded" : "") +
		(edge.skipped?.length ? " ev-edge-bridged" : "")
	);
}

//#endregion

//#region Search

const search = new SearchBox<RenderedNode<EventGraphNode>>({
	boxId: "ev-searchbox",
	countId: "ev-search-count",
	stateKey: "eventSearchQuery",
	noMatchesKey: "eventtree.nomatches",
	countKey: "eventtree.searchmatches",
	matches: (item, query) => matchesQuery(item.node, query),
	target: (item) => ({ id: item.node.id, element: item.element, highlight: item.card }),
});

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

// Every toggle rebuilds the canvas, so the rebuild is bound once instead of at each call site.
const bindToggle = toggleBinder(buildContent);

// Owns the filter widget and the guard that tells a selection this module pushed into it from
// one the reader chose.
const filterControl = new FilterControl<EventFilter>({
	selectId: "ev-filters",
	containerId: "ev-filter-container",
	all: eventFilters,
	emptyKey: "eventtree.filterall",
	emptyText: "(All events)",
	onChange: (selection) => {
		filters = selection;
		setState({ eventFilters: filters });
		buildContent();
	},
});

function applyToolbarFlags(): void {
	const flags = payload.toolbarFlags ?? allToolbarControls;
	const state = getState();
	// The neutral value is the position that shows the most: with nothing to filter out, "show
	// everything" is the honest state.
	showLocalisation = gateToggle("show-localisation", flags.hasLocalisation, state.showLocalisation, true);
	showPicture = gateToggle("show-picture", flags.hasPicture, state.showPicture, true);
	showEffects = gateToggle("show-effects", flags.hasEffects, state.showEffects, true);
	filters = filterControl.gate(
		(filter) => flags[filterAvailability[filter]],
		readFilters(state.eventFilters),
	);
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
			clampBelowToolbar(position.top + position.height, toolbarHeight, popupMargin) +
			window.scrollY +
			"px";
		document.body.append(hoverElement);
	});

	eventNode.addEventListener("mouseleave", () => {
		hoverElement?.remove();
	});
}

//#endregion

//#region Hover effects

function effectSectionsOf(node: EventGraphNode): TooltipSection[] {
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

	const sections: TooltipSection[] = [];
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
			wireEffectTooltip(item.element, sections, effectTooltipOptions);
		}
	}
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
	isolation?.clear();
});

wireUpdateBody<EventGraphPayload>({
	contentId: "eventtreecontent",
	styleId: "event-server-styles",
	dataKey: "eventGraph",
	apply: (next) => {
		payload = next;
	},
	rebuild: buildContent,
});

window.addEventListener(
	"load",
	tryRun(function () {
		const contentElement = document.getElementById("eventtreecontent") as HTMLDivElement | null;
		if (!contentElement) {
			return;
		}
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
		filterControl.wire(filters);

		// Before the first buildContent, so the restored query is applied by the first render rather
		// than only by the next one.
		search.wire();

		buildContent();
	}),
);

