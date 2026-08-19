import { repeat } from "lodash";
import { ConditionComplexExpr } from "../../hoiformat/condition";
import { Token } from "../../hoiformat/hoiparser";
import { localisationIndex } from "../../util/featureflags";
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { HOIEvent } from "./schema";
import {
	EventGraphEdge,
	EventGraphEventNode,
	EventGraphNode,
	EventGraphOptionNode,
	EventGraphPayload,
	EventGraphUnresolvedNode,
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
	immediate: boolean;
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
	for (const event of Object.values(eventIdToEvent)) {
		if (!eventHasParent[event.id]) {
			const eventNode = eventIdToNode[event.id];
			if (eventNode?.relatedNamespace.some((n) => mainNamespaces.includes(n))) {
				result.push(eventNode);
			}
		}
	}

	return result;
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

	for (const option of [event.immediate, ...event.options]) {
		const isImmediate = !option.name;
		const optionNode: OptionNode = {
			optionName: option.name ?? ":immediate",
			trigger: option.trigger,
			children: [],
			file: event.file,
			token: option.token,
		};
		if (!isImmediate) {
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
				immediate: isImmediate,
			};

			if (isImmediate) {
				eventNode.children.push(eventEdge);
			} else {
				optionNode.children.push(eventEdge);
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

function nextScope(scopeContext: ScopeContext, toScope: string): ScopeContext {
	let currentScopeName: string;
	if (toScope.match(/^from(?:\.from)*$/)) {
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
	// An event reached again under the same resolved scope is the same box in the diagram, so the
	// second arrival links to the box already emitted instead of walking its subtree again.
	//
	// Without this the payload is a tree, and a densely cross-linked file explodes: every extra
	// route into an event duplicates everything below it. Millennium Dawn's events/United States.txt
	// produced 94,951 nodes and a 55 MB payload from 588 events that way. Keying on the scope as
	// well as the event keeps the distinction that actually matters -- the same event fired at
	// OVERLORD and at FROM stays two boxes -- while collapsing the identical re-walks.
	visited: Map<EventNode | OptionNode, Map<string, string>>;
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
		visited: new Map(),
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

	const scopeKey = scopeContext.currentScopeName;
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
				immediate: child.immediate,
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
				immediate: false,
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
	_context: BuildContext,
): Promise<EventGraphOptionNode> {
	return {
		id,
		kind: "option",
		name: await localise(node.optionName),
		trigger: node.trigger,
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
