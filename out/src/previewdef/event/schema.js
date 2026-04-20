"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEvents = getEvents;
const schema_1 = require("../../hoiformat/schema");
const effect_1 = require("../../hoiformat/effect");
const lodash_1 = require("lodash");
const eventOptionDefSchema = {
    name: "string",
    trigger: "raw",
    ai_chance: "string",
    original_recipient_only: "boolean",
};
const eventDefSchema = {
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
};
const eventFileSchema = {
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
const eventEffectDefSchema = {
    id: "string",
    days: "number",
    hours: "number",
    random: "number",
    random_hours: "number",
    random_days: "number",
};
function getEvents(node, filePath) {
    const eventFile = (0, schema_1.convertNodeToJson)(node, eventFileSchema);
    const eventItemsByNamespace = {};
    for (const namespace of eventFile.add_namespace) {
        if (namespace) {
            eventItemsByNamespace[namespace] = [];
        }
    }
    fillEvents(eventFile.country_event, 'country', filePath, eventItemsByNamespace);
    fillEvents(eventFile.news_event, 'news', filePath, eventItemsByNamespace);
    fillEvents(eventFile.state_event, 'state', filePath, eventItemsByNamespace);
    fillEvents(eventFile.unit_leader_event, 'unit_leader', filePath, eventItemsByNamespace);
    fillEvents(eventFile.operative_leader_event, 'operative_leader', filePath, eventItemsByNamespace);
    return {
        eventItemsByNamespace,
    };
}
function fillEvents(eventDefs, type, filePath, eventItemsByNamespace) {
    for (const eventDef of eventDefs) {
        const converted = convertEvent(eventDef, filePath, type);
        if (converted) {
            const listOfNamespace = eventItemsByNamespace[converted.namespace];
            if (listOfNamespace) {
                listOfNamespace.push(converted);
            }
        }
    }
}
function eventTypeToScopeType(eventType) {
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
function convertEvent(eventDef, file, type) {
    if (!eventDef.id) {
        return undefined;
    }
    const id = eventDef.id;
    const title = eventDef.title ?? (id + '.t');
    const namespace = id.split('.')[0];
    const picture = eventDef.picture;
    const scopeType = eventTypeToScopeType(type);
    const scope = { scopeName: `{event_target}`, scopeType };
    const immediate = convertOption(eventDef.immediate, scope);
    const options = eventDef.option.map(o => convertOption(o, scope));
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
        options,
        token: eventDef._token,
        major: !!eventDef.major,
        hidden: !!eventDef.hidden,
        isTriggeredOnly: !!eventDef.is_triggered_only,
        meanTimeToHappenBase,
        fire_only_once: !!eventDef.fire_only_once,
    };
}
function convertOption(optionRaw, scope) {
    if (optionRaw === undefined) {
        return { childEvents: [], token: undefined };
    }
    const optionDef = (0, schema_1.convertNodeToJson)(optionRaw._raw, eventOptionDefSchema);
    const name = optionDef.name;
    const effect = (0, effect_1.extractEffectValue)(optionRaw._raw.value, scope);
    const childEventItems = findChildEventItems(effect.effect);
    const childEvents = childEventItems
        .map(effectItemToChildEvent)
        .filter((e) => e !== undefined);
    const uniqueChildEvents = (0, lodash_1.uniqBy)(childEvents, e => e.eventName + '@' + e.scopeName);
    return {
        name,
        childEvents: uniqueChildEvents,
        token: optionDef._token,
    };
}
const eventTypes = ['country_event', 'news_event', 'state_event', 'unit_leader_event', 'operative_leader_event'];
function findChildEventItems(effect, result = []) {
    if (effect === null) {
        return result;
    }
    if ('nodeContent' in effect) {
        if (effect.node.name && eventTypes.includes(effect.node.name?.toLowerCase())) {
            result.push(effect);
        }
    }
    else if ('condition' in effect) {
        effect.items.forEach(item => findChildEventItems(item, result));
    }
    else {
        effect.items.forEach(item => findChildEventItems(item.effect, result));
    }
    return result;
}
function effectItemToChildEvent(item) {
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
    };
}
function getEventEffectDef(node) {
    if ((0, schema_1.isSymbolNode)(node.value)) {
        return { id: node.value.name, days: 0, hours: 0, random: 0, random_days: 0, random_hours: 0 };
    }
    if (typeof node.value === 'string') {
        return { id: node.value, days: 0, hours: 0, random: 0, random_days: 0, random_hours: 0 };
    }
    const callEventDef = (0, schema_1.convertNodeToJson)(node, eventEffectDefSchema);
    return callEventDef.id === undefined ? undefined : {
        id: callEventDef.id,
        days: callEventDef.days ?? 0,
        hours: callEventDef.hours ?? 0,
        random: callEventDef.random ?? 0,
        random_days: callEventDef.random_days ?? 0,
        random_hours: callEventDef.random_hours ?? 0,
    };
}
//# sourceMappingURL=schema.js.map