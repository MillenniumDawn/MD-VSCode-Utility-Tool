import { repeat } from "lodash";
import { ConditionComplexExpr } from "../../hoiformat/condition";
import { Token } from "../../hoiformat/hoiparser";
import { localisationIndex } from "../../util/featureflags";
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { HOIEvent, HOIEventOption } from "./schema";
import {
	EventGraphEdge,
	EventGraphEventNode,
	EventGraphNode,
	EventGraphOptionNode,
	EventGraphPayload,
	EventGraphUnresolvedNode,
	EventCallSource,
	EventToolbarFlags,
	EffectTreeNode,
	LocText,
} from "./payload";
import { EventsLoaderResult } from "./loader";

// The graph the preview walks. Built on the host, then projected into the plain-JSON
// EventGraphPayload below, which is what the webview lays out and renders.

export interface EventNode {
	event: HOIEvent;
	loop: boolean;
	children: (EventEdge | OptionNode)[];
	relatedNamespace: string[];
	token: Token | undefined;
}

export interface OptionNode {
	optionName: string;
	trigger: ConditionComplexExpr;
	children: EventEdge[];
	file: string;
	token: Token | undefined;
	effects: EffectTreeNode[];
}

export interface EventEdge {
	toScope: string;
	toNode: EventNode | string;
	days: number;
	hours: number;
	randomDays: number;
	randomHours: number;
	condition: ConditionComplexExpr;
	possibility: number | undefined;
	source: EventCallSource;
}

export function eventsToGraph(
	eventIdToEvent: Record<string, HOIEvent>,
	mainNamespaces: string[],
): EventNode[] {
	const eventIdToNode: Record<string, EventNode> = {};
	const eventHasParent: Record<string, boolean> = {};
	const eventStack: HOIEvent[] = [];

	for (const event of Object.values(eventIdToEvent)) {
		eventToNode(event, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
	}

	const result: EventNode[] = [];
	const covered = new Set<string>();

	const addRoot = (eventNode: EventNode) => {
		result.push(eventNode);
		markReachable(eventNode, covered);
	};

	for (const event of Object.values(eventIdToEvent)) {
		if (!eventHasParent[event.id]) {
			const eventNode = eventIdToNode[event.id];
			if (eventNode?.relatedNamespace.some((n) => mainNamespaces.includes(n))) {
				addRoot(eventNode);
			}
		}
	}

	// A group of events that only call each other has no parentless member, so the pass above
	// finds no way in and the whole group renders as nothing. Millennium Dawn's
	// ENG_inner_circle_charles.01 and .02 are exactly that: two hidden events whose immediate
	// blocks fire each other, and the preview was blank for them. Anything still unreached is
	// therefore promoted to a root of its own, in file order so the result stays deterministic.
	for (const event of Object.values(eventIdToEvent)) {
		if (covered.has(event.id)) {
			continue;
		}
		const eventNode = eventIdToNode[event.id];
		if (eventNode?.relatedNamespace.some((n) => mainNamespaces.includes(n))) {
			addRoot(eventNode);
		}
	}

	return result;
}

// Every event id reachable from this node, following options and calls alike.
function markReachable(node: EventNode, covered: Set<string>): void {
	if (covered.has(node.event.id)) {
		return;
	}
	covered.add(node.event.id);
	for (const child of node.children) {
		if ("toNode" in child) {
			if (typeof child.toNode !== "string") {
				markReachable(child.toNode, covered);
			}
		} else {
			for (const edge of child.children) {
				if (typeof edge.toNode !== "string") {
					markReachable(edge.toNode, covered);
				}
			}
		}
	}
}

function eventToNode(
	event: HOIEvent,
	eventIdToEvent: Record<string, HOIEvent>,
	eventStack: HOIEvent[],
	eventIdToNode: Record<string, EventNode>,
	eventHasParent: Record<string, boolean>,
): EventNode {
	const cachedNode = eventIdToNode[event.id];
	if (cachedNode) {
		return cachedNode;
	}

	eventStack.push(event);
	const eventNode: EventNode = {
		event,
		children: [],
		relatedNamespace: [event.namespace],
		token: event.token,
		loop: false,
	};
	eventIdToNode[event.id] = eventNode;

	// The event's own two effect blocks first, then the options. Which block a call came from has to
	// be carried rather than guessed: `immediate` and `after` are both nameless, so the two would be
	// indistinguishable to anything reading the name.
	const blocks: { block: HOIEventOption; source: EventCallSource }[] = [
		{ block: event.immediate, source: "immediate" },
		{ block: event.after, source: "after" },
		...event.options.map((option) => ({ block: option, source: "option" as const })),
	];

	for (const { block: option, source } of blocks) {
		// A block gets a card of its own only when it has a name. That is the two event-level blocks,
		// and also an option whose name is a dynamic `name = { text = ... }` block the schema cannot
		// read as a string -- such an option has always hung its calls off the event, and still does.
		const hasCard = option.name !== undefined;
		const callSource: EventCallSource = hasCard
			? "option"
			: source === "option"
				? "immediate"
				: source;
		const optionNode: OptionNode = {
			optionName: option.name ?? ":" + source,
			trigger: option.trigger,
			children: [],
			file: event.file,
			token: option.token,
			effects: option.effects,
		};
		if (hasCard) {
			eventNode.children.push(optionNode);
		}

		for (const childEvent of option.childEvents) {
			const childEventItem = eventIdToEvent[childEvent.eventName];
			eventHasParent[childEvent.eventName] = true;

			let toNode: EventNode | string;
			if (!childEventItem) {
				toNode = childEvent.eventName;
			} else if (eventStack.includes(childEventItem)) {
				toNode = eventToNode(childEventItem, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
				toNode = {
					...toNode,
					children: [],
					loop: true,
				};
			} else {
				toNode = eventToNode(childEventItem, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
				toNode.relatedNamespace.forEach((n) => {
					if (!eventNode.relatedNamespace.includes(n)) {
						eventNode.relatedNamespace.push(n);
					}
				});
			}

			const eventEdge: EventEdge = {
				toNode,
				toScope: childEvent.scopeName,
				days: childEvent.days,
				hours: childEvent.hours,
				randomDays: childEvent.randomDays,
				randomHours: childEvent.randomHours,
				condition: childEvent.condition,
				possibility: childEvent.possibility,
				source: callSource,
			};

			if (hasCard) {
				optionNode.children.push(eventEdge);
			} else {
				eventNode.children.push(eventEdge);
			}
		}
	}

	eventStack.pop();
	return eventNode;
}

interface ScopeContext {
	fromStack: string[];
	currentScopeName: string;
}

// Case-insensitive because tryMoveScope keeps the scope name as the file spells it, and a file
// spells it FROM. Matching only the lowercase form left every FROM call resolving to the literal
// name instead of to the event that fired it.
const fromScopeRegex = /^from(?:\.from)*$/i;

// How deep a `FROM` chain the file actually uses: 1 for `from`, 2 for `from.from`, 0 when no call
// names FROM at all. Only that many entries at the top of the scope stack can ever be read back,
// which is what makes bounding the node identity in visitNode safe.
function maxFromDepthOf(graph: EventNode[]): number {
	let depth = 0;
	const seen = new Set<EventNode | OptionNode>();

	const visit = (node: EventNode | OptionNode): void => {
		if (seen.has(node)) {
			return;
		}
		seen.add(node);

		for (const child of node.children) {
			if ("toNode" in child) {
				if (fromScopeRegex.test(child.toScope)) {
					depth = Math.max(depth, child.toScope.split(".").length);
				}
				if (typeof child.toNode !== "string") {
					visit(child.toNode);
				}
			} else {
				visit(child);
			}
		}
	};

	graph.forEach(visit);
	return depth;
}

function nextScope(scopeContext: ScopeContext, toScope: string): ScopeContext {
	let currentScopeName: string;
	if (fromScopeRegex.test(toScope)) {
		const fromCount = toScope.split(".").length;
		const fromIndex = scopeContext.fromStack.length - fromCount;
		if (fromIndex < 0) {
			currentScopeName =
				(scopeContext.fromStack.length > 0
					? (scopeContext.fromStack[0] ?? scopeContext.currentScopeName)
					: scopeContext.currentScopeName) + repeat(".FROM", -fromIndex);
		} else {
			currentScopeName = scopeContext.fromStack[fromIndex] ?? scopeContext.currentScopeName;
		}
	} else {
		currentScopeName = toScope.replace(/\{event_target\}/g, scopeContext.currentScopeName);
	}

	return {
		fromStack: [...scopeContext.fromStack, scopeContext.currentScopeName],
		currentScopeName,
	};
}

//#region Serializable payload

interface BuildContext {
	nodes: EventGraphNode[];
	edges: EventGraphEdge[];
	loaderResult: EventsLoaderResult;
	styleTable: StyleTable;
	nextId: { value: number };
	// See maxFromDepthOf. Bounds how much of the scope stack takes part in node identity.
	maxFromDepth: number;
	// An event reached again in the same scope situation is the same box in the diagram, so the
	// second arrival links to the box already emitted instead of walking its subtree again.
	//
	// Without this the payload is a tree, and a densely cross-linked file explodes: every extra
	// route into an event duplicates everything below it. Millennium Dawn's events/United States.txt
	// produced 94,951 nodes and a 55 MB payload from 588 events that way. Keying on the scope as
	// well as the event keeps the distinction that actually matters -- the same event fired at
	// OVERLORD and at FROM stays two boxes -- while collapsing the identical re-walks.
	//
	// The key is the current scope plus the top maxFromDepth entries of the FROM stack, not the
	// current scope alone: two routes can arrive in the same scope with different callers behind
	// them, and a `FROM` call further down resolves against those callers. Anything deeper in the
	// stack than maxFromDepth is unreachable by any call in the file, so leaving it out of the key
	// cannot merge two boxes that would go on to differ -- and keeps the collapsing effective,
	// which keying on the whole stack would not.
	visited: Map<EventNode | OptionNode, Map<string, string>>;
	// Interned effect blocks, keyed on the array the schema built once per option. The same option
	// is emitted as a node once per scope situation it is reached in, so the nodes reference a
	// block by index instead of each carrying a copy.
	effectBlocks: EffectTreeNode[][];
	effectRefs: Map<EffectTreeNode[], number>;
}

function internEffects(effects: EffectTreeNode[], context: BuildContext): number | undefined {
	if (effects.length === 0) {
		return undefined;
	}

	const existing = context.effectRefs.get(effects);
	if (existing !== undefined) {
		return existing;
	}

	const index = context.effectBlocks.length;
	context.effectBlocks.push(effects);
	context.effectRefs.set(effects, index);
	return index;
}

export async function buildEventGraphPayload(
	graph: EventNode[],
	loaderResult: EventsLoaderResult,
	styleTable: StyleTable,
): Promise<EventGraphPayload> {
	const context: BuildContext = {
		nodes: [],
		edges: [],
		loaderResult,
		styleTable,
		nextId: { value: 0 },
		maxFromDepth: maxFromDepthOf(graph),
		visited: new Map(),
		effectBlocks: [],
		effectRefs: new Map(),
	};

	const roots: string[] = [];
	for (const eventNode of graph) {
		const scopeContext: ScopeContext = { fromStack: [], currentScopeName: "EVENT_TARGET" };
		roots.push(await visitNode(eventNode, scopeContext, context));
	}

	return {
		roots,
		nodes: context.nodes,
		edges: context.edges,
		conditionExprs: loaderResult.events.conditionExprs,
		toolbarFlags: toolbarFlagsOf(context.nodes, context.edges, context.effectBlocks),
		effectBlocks: context.effectBlocks,
	};
}

// Each predicate is exact: with the flag false, the toggle it gates produces the same output in
// either position, so hiding it takes nothing away.
export function toolbarFlagsOf(
	nodes: EventGraphNode[],
	edges: EventGraphEdge[],
	effectBlocks: EffectTreeNode[][],
): EventToolbarFlags {
	return {
		// Every non-structural edge is one option (or immediate or after block) calling an event,
		// which is exactly one chain link.
		hasChains: edges.some((e) => !e.structural),
		// The blocks are interned per referencing node, so a non-empty table means at least one card
		// carries a dot and a hover panel.
		hasEffects: effectBlocks.length > 0,
		// Each filter is offered only when some event matches it: filtering on a property nothing in
		// the file has could do nothing but empty the canvas.
		hasHidden: nodes.some((n) => n.kind === "event" && n.hidden),
		hasMajor: nodes.some((n) => n.kind === "event" && n.major),
		hasNews: nodes.some((n) => n.kind === "event" && n.eventType === "news"),
		hasMtth: nodes.some((n) => n.kind === "event" && !n.isTriggeredOnly),
		hasTriggered: nodes.some((n) => n.kind === "event" && n.isTriggeredOnly),
		// The flag, not "did anything resolve": with the index on the toggle is real even for a file
		// whose .yml is still missing, and gating on resolution would make the control come and go as
		// localisation files are edited. getConfiguration().get can hand back undefined, so coerce --
		// an undefined field would be dropped by JSON.stringify and read as "hide" in the webview.
		hasLocalisation: !!localisationIndex,
		hasPicture: nodes.some((n) => n.kind === "event" && n.picture !== undefined),
	};
}

async function visitNode(
	node: EventNode | OptionNode | string,
	scopeContext: ScopeContext,
	context: BuildContext,
): Promise<string> {
	if (typeof node === "string") {
		const id = node + ":" + context.nextId.value++;
		context.nodes.push(await makeUnresolvedNode(id, node, scopeContext, context));
		return id;
	}

	const scopeKey = [
		...scopeContext.fromStack.slice(scopeContext.fromStack.length - context.maxFromDepth),
		scopeContext.currentScopeName,
	].join(">");
	const perScope = context.visited.get(node);
	const seen = perScope?.get(scopeKey);
	if (seen !== undefined) {
		return seen;
	}

	const id = nodeKey(node) + ":" + context.nextId.value++;
	// Claim the id before recursing, so a cycle links back to this box rather than recursing
	// forever. eventToNode already breaks cycles with a `loop` clone, but a clone is a fresh
	// object and would not hit this memo, so the guard has to stand on its own.
	if (perScope) {
		perScope.set(scopeKey, id);
	} else {
		context.visited.set(node, new Map([[scopeKey, id]]));
	}

	if ("event" in node) {
		context.nodes.push(await makeEventGraphNode(id, node, scopeContext, context));
	} else {
		context.nodes.push(await makeOptionGraphNode(id, node, context));
	}

	for (const child of node.children) {
		if ("toNode" in child) {
			const childId = await visitNode(child.toNode, nextScope(scopeContext, child.toScope), context);
			context.edges.push({
				from: id,
				to: childId,
				structural: false,
				source: child.source,
				scope: child.toScope,
				days: child.days,
				hours: child.hours,
				randomDays: child.randomDays,
				randomHours: child.randomHours,
				condition: child.condition,
				possibility: child.possibility,
			});
		} else {
			const childId = await visitNode(child, scopeContext, context);
			context.edges.push({
				from: id,
				to: childId,
				structural: true,
				source: "option",
				scope: "",
				days: 0,
				hours: 0,
				randomDays: 0,
				randomHours: 0,
				condition: true,
			});
		}
	}

	return id;
}

function nodeKey(node: EventNode | OptionNode | string): string {
	if (typeof node === "string") {
		return node;
	}
	return "event" in node ? node.event.id : node.optionName;
}

async function makeEventGraphNode(
	id: string,
	node: EventNode,
	scopeContext: ScopeContext,
	context: BuildContext,
): Promise<EventGraphEventNode> {
	const event = node.event;
	const picture = event.picture
		? await getSpriteByGfxName(event.picture, context.loaderResult.gfxFiles)
		: undefined;

	return {
		id,
		kind: "event",
		eventId: event.id,
		eventType: event.type,
		scope: scopeContext.currentScopeName,
		title: await localise(event.title),
		major: event.major,
		hidden: event.hidden,
		fireOnlyOnce: event.fire_only_once,
		isTriggeredOnly: event.isTriggeredOnly,
		loop: node.loop,
		meanTimeToHappenBase: event.meanTimeToHappenBase,
		trigger: event.trigger,
		// Neither the immediate nor the after block gets a card of its own -- their calls hang off the
		// event -- so this is the only place their effects can surface.
		effectsRef: internEffects(event.immediate.effects, context),
		afterEffectsRef: internEffects(event.after.effects, context),
		nav: event.token
			? { start: event.token.start, end: event.token.end, file: event.file }
			: undefined,
		picture: picture
			? {
					styleKey: context.styleTable.style(
						"event-picture-" + normalizeForStyle(event.picture ?? "-empty"),
						() => `
                            background-image: url(${picture.image.uri});
                            background-size: ${picture.image.width}px;
                            width: ${picture.image.width}px;
                            height: ${picture.image.height}px;
                        `,
					),
					width: picture.image.width,
				}
			: undefined,
	};
}

async function makeOptionGraphNode(
	id: string,
	node: OptionNode,
	context: BuildContext,
): Promise<EventGraphOptionNode> {
	return {
		id,
		kind: "option",
		name: await localise(node.optionName),
		trigger: node.trigger,
		effectsRef: internEffects(node.effects, context),
		nav: node.token
			? { start: node.token.start, end: node.token.end, file: node.file }
			: undefined,
	};
}

async function makeUnresolvedNode(
	id: string,
	eventId: string,
	scopeContext: ScopeContext,
	_context: BuildContext,
): Promise<EventGraphUnresolvedNode> {
	// An unresolved id is not a localisation key itself, so try it and then its `.t` title key,
	// and report nothing rather than echoing the id back when neither resolves.
	let title: LocText | undefined = undefined;
	if (localisationIndex) {
		const direct = await getLocalisedTextQuick(eventId);
		if (direct && direct !== eventId) {
			title = { key: eventId, text: direct };
		} else {
			const titleKey = `${eventId}.t`;
			const viaTitle = await getLocalisedTextQuick(titleKey);
			if (viaTitle && viaTitle !== titleKey) {
				title = { key: titleKey, text: viaTitle };
			}
		}
	}

	return {
		id,
		kind: "unresolved",
		eventId,
		scope: scopeContext.currentScopeName,
		title,
	};
}

async function localise(key: string): Promise<LocText> {
	// getLocalisedTextQuick echoes the key back when nothing resolves, which is exactly the
	// fallback the preview wants, so an unresolved key simply reads the same either way.
	const text = localisationIndex ? await getLocalisedTextQuick(key) : key;
	return { key, text: text ?? key };
}

//#endregion
