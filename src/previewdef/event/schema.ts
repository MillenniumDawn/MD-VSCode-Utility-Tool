import { Node, Token } from "../../hoiformat/hoiparser";
import { Raw, SchemaDef, convertNodeToJson, HOIPartial, isSymbolNode } from "../../hoiformat/schema";
import { extractEffectValue, GuardedEffectItem, findGuardedEffectItems, projectEffects } from "../../hoiformat/effect";
import { EffectTreeNode } from "./payload";
import {
    ConditionComplexExpr,
    ConditionItem,
    conditionToString,
    extractConditionValue,
    extractConditionalExprs,
} from "../../hoiformat/condition";
import { Scope, ScopeType } from "../../hoiformat/scope";
import { uniqBy } from "lodash";

export interface HOIEvents {
    eventItemsByNamespace: Record<string, HOIEvent[]>;
    // Every distinct condition leaf reached while parsing this file, flattened the way the focus
    // tree and MIO schemas collect theirs. The preview offers these as togglable expressions.
    conditionExprs: ConditionItem[];
}

export type HOIEventType = 'country' | 'state' | 'unit_leader' | 'news' | 'operative_leader';

export interface HOIEvent {
    type: HOIEventType;
    id: string;
    title: string;
    namespace: string;
    picture?: string;
    immediate: HOIEventOption;
    // The `after = { ... }` block: what the event does once it is dismissed, whichever option was
    // taken -- and for a hidden event with no options at all. Read exactly like the immediate block,
    // because a call it makes continues the chain just as much.
    after: HOIEventOption;
    options: HOIEventOption[];
    token: Token | undefined;
    major: boolean;
    hidden: boolean;
    isTriggeredOnly: boolean;
    meanTimeToHappenBase: number;
    fire_only_once: boolean;
    file: string;
    // The event's own `trigger = { ... }` gate. `true` when the event declares none.
    trigger: ConditionComplexExpr;
}

export interface HOIEventOption {
    name?: string;
    childEvents: ChildEvent[];
    token: Token | undefined;
    // The option's `trigger = { ... }` gate: the condition under which the option is offered at
    // all. `true` when the option declares none.
    trigger: ConditionComplexExpr;
    // Everything the option does, for the preview to show on hover. The same tree the child events
    // are found in, minus the parse nodes -- see projectEffects.
    effects: EffectTreeNode[];
}

export interface ChildEvent {
    scopeName: string;
    eventName: string;
    days: number;
    hours: number;
    randomDays: number;
    randomHours: number;
    // The condition guarding this particular call, folded from every `if` / `else_if` / `else`
    // enclosing it. `true` for an unconditional call.
    condition: ConditionComplexExpr;
    // Set when the call sits in a `random_list` branch, carrying that branch's weight.
    possibility?: number;
}

interface EventFile {
    add_namespace: string[];
    country_event: EventDef[];
    news_event: EventDef[];
    state_event: EventDef[];
    unit_leader_event: EventDef[];
    operative_leader_event: EventDef[];
}

interface EventDef {
    id: string;
    title: string;
    picture: string;
    is_triggered_only: boolean;
    major: boolean;
    hidden: boolean;
    mean_time_to_happen: MeanTimeToHappen;
    fire_only_once: boolean;
    option: Raw[];
    immediate: Raw;
    after: Raw;
    trigger: Raw;
    _token: Token;
}

interface MeanTimeToHappen {
    base: number;
    factor: number;
    days: number;
    months: number;
    years: number;
}

interface EventOptionDef {
    name: string;
    trigger: Raw;
    ai_chance: string;
    original_recipient_only: boolean;
    _token: Token;
}

interface EventEffectDef {
    id: string;
    days: number;
    hours: number;
    random: number;
    random_hours: number;
    random_days: number;
}

const eventOptionDefSchema: SchemaDef<EventOptionDef> = {
    name: "string",
    trigger: "raw",
    ai_chance: "string",
    original_recipient_only: "boolean",
};

const eventDefSchema: SchemaDef<EventDef> = {
    id: "string",
    title: "string",
    picture: "string",
    is_triggered_only: "boolean",
    major: "boolean",
    hidden: "boolean",
    fire_only_once: "boolean",
    mean_time_to_happen: {
        base: "number",
        factor: "number",
        days: "number",
        months: "number",
        years: "number",
    },
    option: {
        _innerType: "raw",
        _type: "array",
    },
    immediate: "raw",
    after: "raw",
    trigger: "raw",
};

const eventFileSchema: SchemaDef<EventFile> = {
    add_namespace: {
        _innerType: "string",
        _type: "array",
    },
    country_event: {
        _innerType: eventDefSchema,
        _type: "array",
    },
    news_event: {
        _innerType: eventDefSchema,
        _type: "array",
    },
    unit_leader_event: {
        _innerType: eventDefSchema,
        _type: "array",
    },
    state_event: {
        _innerType: eventDefSchema,
        _type: "array",
    },
    operative_leader_event: {
        _innerType: eventDefSchema,
        _type: "array",
    },
};

const eventEffectDefSchema: SchemaDef<EventEffectDef> = {
    id: "string",
    days: "number",
    hours: "number",
    random: "number",
    random_hours: "number",
    random_days: "number",
};

export function getEvents(node: Node, filePath: string): HOIEvents {
    const eventFile = convertNodeToJson<EventFile>(node, eventFileSchema);
    const eventItemsByNamespace: Record<string, HOIEvent[]> = {};
    for (const namespace of eventFile.add_namespace) {
        if (namespace) {
            eventItemsByNamespace[namespace] = [];
        }
    }

    const conditionExprs: ConditionItem[] = [];
    fillEvents(eventFile.country_event, 'country', filePath, eventItemsByNamespace, conditionExprs);
    fillEvents(eventFile.news_event, 'news', filePath, eventItemsByNamespace, conditionExprs);
    fillEvents(eventFile.state_event, 'state', filePath, eventItemsByNamespace, conditionExprs);
    fillEvents(eventFile.unit_leader_event, 'unit_leader', filePath, eventItemsByNamespace, conditionExprs);
    fillEvents(eventFile.operative_leader_event, 'operative_leader', filePath, eventItemsByNamespace, conditionExprs);

    return {
        eventItemsByNamespace,
        conditionExprs: uniqBy(conditionExprs, e => e.scopeName + '@' + e.nodeContent),
    };
}

function fillEvents(
    eventDefs: HOIPartial<EventDef>[],
    type: HOIEventType,
    filePath: string,
    eventItemsByNamespace: Record<string, HOIEvent[]>,
    conditionExprs: ConditionItem[],
) {
    for (const eventDef of eventDefs) {
        const converted = convertEvent(eventDef, filePath, type, conditionExprs);
        if (converted) {
            const listOfNamespace = eventItemsByNamespace[converted.namespace];
            if (listOfNamespace) {
                listOfNamespace.push(converted);
            }
        }
    }
}

function eventTypeToScopeType(eventType: HOIEventType): ScopeType {
    switch (eventType) {
        case 'country':
        case 'news':
            return 'country';
        case 'state':
            return 'state';
        case 'unit_leader':
            return 'leader';
        case 'operative_leader':
            return 'operative';
        default:
            return 'unknown';
    }
}

function convertEvent<T extends HOIEventType>(
    eventDef: HOIPartial<EventDef>,
    file: string,
    type: T,
    conditionExprs: ConditionItem[],
): HOIEvent & { type: T } | undefined {
    if (!eventDef.id) {
        return undefined;
    }

    const id = eventDef.id;
    const title = eventDef.title ?? (id + '.t');
    const namespace = id.split('.')[0] ?? '';
    const picture = eventDef.picture;

    const scopeType = eventTypeToScopeType(type);
    const scope: Scope = { scopeName: `{event_target}`, scopeType };

    const trigger = eventDef.trigger ?
        extractConditionValue(eventDef.trigger._raw.value, scope, conditionExprs).condition :
        true;

    const immediate = convertOption(eventDef.immediate, scope, conditionExprs);
    const after = convertOption(eventDef.after, scope, conditionExprs);
    const options = eventDef.option.map(o => convertOption(o, scope, conditionExprs));

    const meanTimeToHappenBase = eventDef.mean_time_to_happen ?
        Math.floor(eventDef.mean_time_to_happen.factor ??
            eventDef.mean_time_to_happen.base ??
            eventDef.mean_time_to_happen.days ??
            (eventDef.mean_time_to_happen.months ? Math.floor(eventDef.mean_time_to_happen.months) * 30 : undefined) ??
            (eventDef.mean_time_to_happen.years ? Math.floor(eventDef.mean_time_to_happen.years) * 365 : undefined) ??
            1) :
        1;

    return {
        type,
        id,
        title,
        namespace,
        picture,
        file,
        immediate,
        after,
        options,
        token: eventDef._token,
        major: !!eventDef.major,
        hidden: !!eventDef.hidden,
        isTriggeredOnly: !!eventDef.is_triggered_only,
        meanTimeToHappenBase,
        fire_only_once: !!eventDef.fire_only_once,
        trigger,
    };
}

function convertOption(optionRaw: Raw | undefined, scope: Scope, conditionExprs: ConditionItem[]): HOIEventOption {
    if (optionRaw === undefined) {
        return { childEvents: [], token: undefined, trigger: true, effects: [] };
    }

    const optionDef = convertNodeToJson<EventOptionDef>(optionRaw._raw, eventOptionDefSchema);
    const name = optionDef.name;

    const trigger = optionDef.trigger ?
        extractConditionValue(optionDef.trigger._raw.value, scope, conditionExprs).condition :
        true;

    // The option's own keys are metadata, not effects: without excluding them the tree lists
    // `name`, `trigger` and `ai_chance` next to the things the option actually does. They are only
    // excluded at the top level of the block, which is where they can appear -- a `trigger` nested
    // inside an effect is a different key and stays.
    const effect = extractEffectValue(optionRaw._raw.value, scope, optionOwnKeys);
    const childEventItems = findGuardedEffectItems(effect.effect, eventTypes);
    const childEvents = childEventItems
        .map(effectItemToChildEvent)
        .filter((e): e is ChildEvent => e !== undefined);
    // Two calls to the same event are only the same edge when everything the edge shows is the
    // same: scope, guarding condition, delay and `random_list` weight. Keying on all of it keeps
    // the `if` and the `else_if` branch of a fork apart -- which is what makes the chain readable
    // as a workflow -- and stops a call fired after a different delay from inheriting the first
    // call's timing.
    const uniqueChildEvents = uniqBy(
        childEvents,
        e => [
            e.eventName,
            e.scopeName,
            conditionToString(e.condition),
            e.days,
            e.hours,
            e.randomDays,
            e.randomHours,
            e.possibility ?? '',
        ].join('@'),
    );

    for (const childEvent of uniqueChildEvents) {
        extractConditionalExprs(childEvent.condition, conditionExprs);
    }

    return {
        name,
        childEvents: uniqueChildEvents,
        token: optionDef._token,
        trigger,
        effects: projectEffects(effect.effect),
    };
}

const optionOwnKeys = ['name', 'trigger', 'ai_chance', 'original_recipient_only'];

const eventTypes = ['country_event', 'news_event', 'state_event', 'unit_leader_event', 'operative_leader_event'];

function effectItemToChildEvent(guarded: GuardedEffectItem): ChildEvent | undefined {
    const { item, condition, possibility } = guarded;
    const eventEffectDef = getEventEffectDef(item.node);
    if (!eventEffectDef) {
        return undefined;
    }

    return {
        scopeName: item.scopeName,
        eventName: eventEffectDef.id,
        days: eventEffectDef.days,
        hours: eventEffectDef.hours,
        randomDays: eventEffectDef.random_days,
        randomHours: eventEffectDef.random_hours === 0 ? eventEffectDef.random : eventEffectDef.random_hours,
        condition,
        possibility,
    };
}

function getEventEffectDef(node: Node): EventEffectDef | undefined {
    if (isSymbolNode(node.value)) {
        return { id: node.value.name, days: 0, hours: 0, random: 0, random_days: 0, random_hours: 0 };
    }

    if (typeof node.value === 'string') {
        return { id: node.value, days: 0, hours: 0, random: 0, random_days: 0, random_hours: 0 };
    }

    const callEventDef = convertNodeToJson<EventEffectDef>(node, eventEffectDefSchema);
    return callEventDef.id === undefined ? undefined : {
        id: callEventDef.id,
        days: callEventDef.days ?? 0,
        hours: callEventDef.hours ?? 0,
        random: callEventDef.random ?? 0,
        random_days: callEventDef.random_days ?? 0,
        random_hours: callEventDef.random_hours ?? 0,
    };
}
