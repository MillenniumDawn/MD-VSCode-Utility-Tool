"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEventFile = void 0;
const tslib_1 = require("tslib");
const loader_1 = require("../../util/loader/loader");
const debug_1 = require("../../util/debug");
const html_1 = require("../../util/html");
const i18n_1 = require("../../util/i18n");
const styletable_1 = require("../../util/styletable");
const lodash_1 = require("lodash");
const common_1 = require("../../util/common");
const schema_1 = require("../../hoiformat/schema");
const gridbox_1 = require("../../util/hoi4gui/gridbox");
const imagecache_1 = require("../../util/image/imagecache");
const localisationIndex_1 = require("../../util/localisationIndex");
const featureflags_1 = require("../../util/featureflags");
function renderEventFile(loader, uri, webview) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const setPreviewFileUriScript = { content: `window.previewedFileUri = "${uri.toString()}";` };
        try {
            const session = new loader_1.LoaderSession(false);
            const loadResult = yield loader.load(session);
            const loadedLoaders = Array.from(session.loadedLoader).map(v => v.toString());
            (0, debug_1.debug)('Loader session event tree', loadedLoaders);
            const styleTable = new styletable_1.StyleTable();
            const baseContent = yield renderEvents(loadResult.result, styleTable);
            return (0, html_1.html)(webview, baseContent, [
                setPreviewFileUriScript,
                'common.js',
                'eventtree.js',
            ], [
                'codicon.css',
                styleTable
            ]);
        }
        catch (e) {
            const baseContent = `${(0, i18n_1.localize)('error', 'Error')}: <br/>  <pre>${(0, html_1.htmlEscape)((0, common_1.forceError)(e).toString())}</pre>`;
            return (0, html_1.html)(webview, baseContent, [setPreviewFileUriScript], []);
        }
    });
}
exports.renderEventFile = renderEventFile;
const leftPaddingBase = 50;
const topPaddingBase = 50;
const xGridSize = 180;
const yGridSize = 150;
function renderEvents(eventsLoaderResult, styleTable) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const leftPadding = leftPaddingBase;
        const topPadding = topPaddingBase;
        const gridBox = {
            position: { x: (0, schema_1.toNumberLike)(leftPadding), y: (0, schema_1.toNumberLike)(topPadding) },
            format: (0, schema_1.toStringAsSymbolIgnoreCase)('up'),
            size: { width: (0, schema_1.toNumberLike)(xGridSize), height: undefined },
            slotsize: { width: (0, schema_1.toNumberLike)(xGridSize), height: (0, schema_1.toNumberLike)(yGridSize) },
        };
        const eventIdToEvent = (0, common_1.arrayToMap)((0, lodash_1.flatten)(Object.values(eventsLoaderResult.events.eventItemsByNamespace)), 'id');
        const graph = eventsToGraph(eventIdToEvent, eventsLoaderResult.mainNamespaces);
        const idToContentMap = {};
        const gridBoxItems = yield graphToGridBoxItems(graph, idToContentMap, eventsLoaderResult, styleTable);
        const renderedGridBox = yield (0, gridbox_1.renderGridBox)(gridBox, {
            size: { width: 0, height: 0 },
            orientation: 'upper_left'
        }, {
            styleTable,
            items: (0, common_1.arrayToMap)(gridBoxItems, 'id'),
            onRenderItem: (item) => tslib_1.__awaiter(this, void 0, void 0, function* () { return idToContentMap[item.id]; }),
            cornerPosition: 0.5,
        });
        return `
        <div id="dragger" class="${styleTable.oneTimeStyle('dragger', () => `
            width: 100vw;
            height: 100vh;
            position: fixed;
            left:0;
            top:0;
        `)}"></div>
        <div id="eventtreecontent" class="${styleTable.oneTimeStyle('eventtreecontent', () => `
            left: -20px;
            position: relative;
        `)}">
            ${renderedGridBox}
        </div>
    `;
    });
}
function eventsToGraph(eventIdToEvent, mainNamespaces) {
    const eventIdToNode = {};
    const eventHasParent = {};
    const eventStack = [];
    for (const event of Object.values(eventIdToEvent)) {
        eventToNode(event, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
    }
    const result = [];
    for (const event of Object.values(eventIdToEvent)) {
        if (!eventHasParent[event.id]) {
            const eventNode = eventIdToNode[event.id];
            if (eventNode.relatedNamespace.some(n => mainNamespaces.includes(n))) {
                result.push(eventNode);
            }
        }
    }
    return result;
}
function eventToNode(event, eventIdToEvent, eventStack, eventIdToNode, eventHasParent) {
    var _a;
    const cachedNode = eventIdToNode[event.id];
    if (cachedNode) {
        return cachedNode;
    }
    eventStack.push(event);
    const eventNode = {
        event,
        children: [],
        relatedNamespace: [event.namespace],
        token: event.token,
        loop: false,
    };
    eventIdToNode[event.id] = eventNode;
    for (const option of [event.immediate, ...event.options]) {
        const isImmediate = !option.name;
        const optionNode = {
            optionName: (_a = option.name) !== null && _a !== void 0 ? _a : ':immediate',
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
            let toNode;
            if (!childEventItem) {
                toNode = childEvent.eventName;
            }
            else if (eventStack.includes(childEventItem)) {
                toNode = eventToNode(childEventItem, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
                toNode = Object.assign(Object.assign({}, toNode), { children: [], loop: true });
            }
            else {
                toNode = eventToNode(childEventItem, eventIdToEvent, eventStack, eventIdToNode, eventHasParent);
                toNode.relatedNamespace.forEach(n => {
                    if (!eventNode.relatedNamespace.includes(n)) {
                        eventNode.relatedNamespace.push(n);
                    }
                });
            }
            const eventEdge = {
                toNode,
                toScope: childEvent.scopeName,
                days: childEvent.days,
                hours: childEvent.hours,
                randomDays: childEvent.randomDays,
                randomHours: childEvent.randomHours,
            };
            if (isImmediate) {
                eventNode.children.push(eventEdge);
            }
            else {
                optionNode.children.push(eventEdge);
            }
        }
    }
    eventStack.pop();
    return eventNode;
}
function graphToGridBoxItems(graph, idToContentMap, eventsLoaderResult, styleTable) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const resultTree = {
            id: '',
            items: [],
            starts: [],
            ends: [],
        };
        const idContainer = { id: 0 };
        for (const eventNode of graph) {
            const scopeContext = {
                fromStack: [],
                currentScopeName: 'EVENT_TARGET',
            };
            const tree = yield eventNodeToGridBoxItems(eventNode, undefined, idToContentMap, scopeContext, eventsLoaderResult, styleTable, idContainer);
            idToContentMap[tree.id] = yield makeEventNode(scopeContext.currentScopeName, eventNode, undefined, eventsLoaderResult, styleTable);
            appendChildToTree(resultTree, tree);
        }
        return resultTree.items;
    });
}
function eventNodeToGridBoxItems(node, edge, idToContentMap, scopeContext, eventsLoaderResult, styleTable, idContainer) {
    var _a, _b;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        const result = {
            id: '',
            items: [],
            starts: [],
            ends: [],
        };
        const childIds = [];
        if (typeof node === 'object') {
            for (const child of node.children) {
                let tree;
                if ('toNode' in child) {
                    const toNode = child.toNode;
                    const nextScopeContext = nextScope(scopeContext, child.toScope);
                    tree = yield eventNodeToGridBoxItems(toNode, child, idToContentMap, nextScopeContext, eventsLoaderResult, styleTable, idContainer);
                }
                else {
                    tree = yield eventNodeToGridBoxItems(child, undefined, idToContentMap, scopeContext, eventsLoaderResult, styleTable, idContainer);
                }
                childIds.push(tree.id);
                appendChildToTree(result, tree, 1, true);
            }
        }
        const isOption = typeof node === 'object' && !('event' in node);
        const id = (typeof node === 'object' ? ('event' in node ? node.event.id : node.optionName) : node) + ':' + (idContainer.id++);
        if (isOption) {
            idToContentMap[id] = yield makeOptionNode(node, eventsLoaderResult, styleTable);
        }
        else {
            idToContentMap[id] = yield makeEventNode(scopeContext.currentScopeName, typeof node === 'object' ? node : node, edge, eventsLoaderResult, styleTable);
        }
        const x = result.starts.length < 2 ? 0 : Math.floor((result.ends[1] + result.starts[1] - 1) / 2);
        result.id = id;
        result.items.push({
            id,
            gridX: x,
            gridY: 0,
            connections: childIds.map(id => ({
                target: id,
                targetType: 'child',
                style: '1px solid #88aaff'
            })),
        });
        if (result.starts.length === 0) {
            result.starts.push(0);
            result.ends.push(1);
        }
        else {
            if (result.starts[0] === result.ends[0]) {
                result.starts[0] = x;
                result.ends[0] = x + 1;
            }
            else {
                result.starts[0] = Math.min(x, (_a = result.starts[0]) !== null && _a !== void 0 ? _a : 0);
                result.ends[0] = Math.max(x + 1, (_b = result.ends[0]) !== null && _b !== void 0 ? _b : 0);
            }
        }
        return result;
    });
}
function nextScope(scopeContext, toScope) {
    let currentScopeName;
    if (toScope.match(/^from(?:\.from)*$/)) {
        const fromCount = toScope.split('.').length;
        const fromIndex = scopeContext.fromStack.length - fromCount;
        if (fromIndex < 0) {
            currentScopeName = (scopeContext.fromStack.length > 0 ? scopeContext.fromStack[0] : scopeContext.currentScopeName) +
                (0, lodash_1.repeat)('.FROM', -fromIndex);
        }
        else {
            currentScopeName = scopeContext.fromStack[fromIndex];
        }
    }
    else {
        currentScopeName = toScope.replace(/\{event_target\}/g, scopeContext.currentScopeName);
    }
    return {
        fromStack: [...scopeContext.fromStack, scopeContext.currentScopeName],
        currentScopeName,
    };
}
const typeToIcon = {
    state: 'location',
    country: 'globe',
    unit_leader: 'account',
    news: 'note',
    operative_leader: 'device-camera',
};
const flagIcons = [
    'eye-closed',
    'sync-ignored',
    'broadcast',
    'refresh',
];
function makeEventNode(scope, eventNode, edge, eventsLoaderResult, styleTable) {
    var _a;
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (typeof eventNode === 'object') {
            const { localizationDict, gfxFiles } = eventsLoaderResult;
            const event = eventNode.event;
            const eventId = event.id;
            const title = `${event.type}_event\n${(0, i18n_1.localize)('eventtree.eventid', 'Event ID: ')}${eventId}\n` +
                (event.major ? (0, i18n_1.localize)('eventtree.major', 'Major') + '\n' : '') +
                (event.hidden ? (0, i18n_1.localize)('eventtree.hidden', 'Hidden') + '\n' : '') +
                (event.fire_only_once ? (0, i18n_1.localize)('eventtree.fireonlyonce', 'Fire only once') + '\n' : '') +
                (event.isTriggeredOnly ? (0, i18n_1.localize)('eventtree.istriggeredonly', 'Is triggered only') :
                    `${(0, i18n_1.localize)('eventtree.mtthbase', 'Mean time to happen (base): ')}${event.meanTimeToHappenBase} ${(0, i18n_1.localize)('days', 'day(s)')}`) + '\n' +
                (edge !== undefined && (edge.days > 0 || edge.hours > 0 || edge.randomDays > 0 || edge.randomHours > 0) ?
                    (0, i18n_1.localize)('eventtree.delay', 'Delay: ') + (edge.days > 0 || edge.hours > 0 ?
                        `${edge.randomDays > 0 ? `${edge.days}-${edge.days + edge.randomDays}` : edge.days} ${(0, i18n_1.localize)('days', 'day(s)')}` :
                        `${edge.randomHours > 0 ? `${edge.hours}-${edge.hours + edge.randomHours}` : edge.hours} ${(0, i18n_1.localize)('hours', 'hour(s)')}`) + '\n' :
                    '') +
                `${(0, i18n_1.localize)('eventtree.scope', 'Scope: ')}${scope}\n${(0, i18n_1.localize)('eventtree.title', 'Title: ')}${featureflags_1.localisationIndex ? yield (0, localisationIndex_1.getLocalisedTextQuick)(event.title) : event.title}`;
            const flags = [event.hidden, event.fire_only_once, event.major, eventNode.loop];
            const content = `<p class="
                ${styleTable.style('paragraph', () => 'margin: 5px 0; text-overflow: ellipsis; overflow: hidden;')}
                ${styleTable.style('white-space-nowrap', () => 'white-space: nowrap;')}
            ">
                ${makeIcon(typeToIcon[event.type], styleTable)}
                ${eventId}
                ${flags.includes(true) ? '<br/>' + flags.map((v, i) => v ? makeIcon(flagIcons[i], styleTable) : '').join(' ') : ''}
                ${!event.isTriggeredOnly ?
                `<br/>${makeIcon('history', styleTable)} ${event.meanTimeToHappenBase} ${(0, i18n_1.localize)('days', 'day(s)')}` :
                ''}
                <br/>
                ${makeIcon('symbol-namespace', styleTable)} ${scope}
                ${edge !== undefined && (edge.days > 0 || edge.hours > 0 || edge.randomDays > 0 || edge.randomHours > 0) ?
                `<br/>${makeIcon('watch', styleTable)} ${edge.days > 0 || edge.hours > 0 ?
                    `${edge.randomDays > 0 ? `${edge.days}-${edge.days + edge.randomDays}` : edge.days} ${(0, i18n_1.localize)('days', 'day(s)')}` :
                    `${edge.randomHours > 0 ? `${edge.hours}-${edge.hours + edge.randomHours}` : edge.hours} ${(0, i18n_1.localize)('hours', 'hour(s)')}`}`
                : ''}
            </p>
            <p class="${styleTable.style('paragraph', () => 'margin: 5px 0; text-overflow: ellipsis; overflow: hidden;')}">
                ${featureflags_1.localisationIndex ? yield (0, localisationIndex_1.getLocalisedTextQuick)(event.title) : event.title}
            </p>`;
            const extraAttributes = [];
            const extraClasses = [
                styleTable.style('event-item', () => 'background: rgba(255, 80, 80, 0.5);'),
                styleTable.style('cursor-pointer', () => 'cursor: pointer;'),
            ];
            if (event.token) {
                extraAttributes.push(`
                start="${event.token.start}"
                end="${event.token.end}"
                ${event.file ? `file="${event.file}"` : ''}
            `);
                extraClasses.push('navigator');
            }
            const picture = event.picture ? yield (0, imagecache_1.getSpriteByGfxName)(event.picture, gfxFiles) : undefined;
            if (picture) {
                const pictureStyle = styleTable.style('event-picture-' + (0, styletable_1.normalizeForStyle)((_a = event.picture) !== null && _a !== void 0 ? _a : '-empty'), () => `
                background-image: url(${picture.image.uri});
                background-size: ${picture.image.width}px;
                width: ${picture.image.width}px;
                height: ${picture.image.height}px;
            `);
                extraAttributes.push(`
                picture-style-key="${pictureStyle}"
                picture-width="${picture.image.width}"
            `);
                extraClasses.push('event-picture-host');
            }
            return makeNode(content, title, styleTable, extraClasses.join(' '), extraAttributes.join(' '));
        }
        else {
            const eventId = eventNode;
            const title = `${(0, i18n_1.localize)('eventtree.eventid', 'Event ID: ')}${eventId}\n${(0, i18n_1.localize)('eventtree.scope', 'Scope: ')}${scope}`;
            let contentText = '';
            if (featureflags_1.localisationIndex) {
                let localizedTitle = yield (0, localisationIndex_1.getLocalisedTextQuick)(eventId);
                if (localizedTitle !== eventId && localizedTitle != null) {
                    contentText += `<br/>${localizedTitle}`;
                }
                else {
                    localizedTitle = yield (0, localisationIndex_1.getLocalisedTextQuick)(`${eventId}.t`);
                    if (localizedTitle !== `${eventId}.t` && localizedTitle != null) {
                        contentText += `<br/>${localizedTitle}`;
                    }
                }
            }
            const content = `<p class="
                ${styleTable.style('paragraph', () => 'margin: 5px 0; text-overflow: ellipsis; overflow: hidden;')}
                ${styleTable.style('white-space-nowrap', () => 'white-space: nowrap;')}
            ">
                ${makeIcon('question', styleTable)}
                ${eventId}
                <br/>
                ${makeIcon('symbol-namespace', styleTable)} ${scope}
                ${contentText}
            </p>`;
            return makeNode(content, title, styleTable, styleTable.style('event-item', () => 'background: rgba(255, 80, 80, 0.5);'));
        }
    });
}
function makeIcon(type, styleTable) {
    return `<i class="codicon codicon-${type} ${styleTable.style('bottom', () => 'vertical-align: bottom;')}"></i>`;
}
function makeOptionNode(option, eventsLoaderResult, styleTable) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let content = option.optionName;
        let title = option.optionName;
        if (featureflags_1.localisationIndex) {
            const optionName = yield (0, localisationIndex_1.getLocalisedTextQuick)(option.optionName);
            content = `${option.optionName} <br/> ${optionName}`;
            title = `${option.optionName} \n ${optionName}`;
        }
        const extraAttributes = option.token ? `
        start="${option.token.start}"
        end="${option.token.end}"
        ${option.file ? `file="${option.file}"` : ''}
        ` : '';
        return makeNode(content, title, styleTable, styleTable.style('event-option', () => 'background: rgba(80, 80, 255, 0.5); cursor: pointer;')
            + (option.token ? ' navigator' : ''), extraAttributes);
    });
}
function makeNode(content, title, styleTable, extraClasses, extraAttributes) {
    return `<div class=${styleTable.style('event-node-outer', () => `
        height: 100%;
        width: 100%;
        position: relative;
    `)}>
        <div
            class="${styleTable.style('event-node', () => `
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                width: calc(100% - 10px);
                text-align: center;
                padding: 10px 5px;
                margin: 0 5px;
                overflow: hidden;
                box-sizing: border-box;
                text-overflow: ellipsis;`)}
                ${extraClasses}"
            title='${(0, html_1.htmlEscape)(title.trim())}'
            ${extraAttributes !== null && extraAttributes !== void 0 ? extraAttributes : ''}
        >
            ${content}
        </div>
    </div>`;
}
function appendChildToTree(target, nextChild, yOffset = 0, canBeLessThanZero = false) {
    var _a, _b;
    const minXOffset = target.starts.length === 0 ? -((_a = (0, lodash_1.max)(nextChild.starts)) !== null && _a !== void 0 ? _a : 0) : -Infinity;
    const xOffset = Math.max(minXOffset, (_b = (0, lodash_1.max)(nextChild.starts.map((s, i) => {
        var _a;
        if (!canBeLessThanZero) {
            const e = (_a = target.ends[i + yOffset]) !== null && _a !== void 0 ? _a : 0;
            return e - s;
        }
        else {
            if (target.ends[i + yOffset] === target.starts[i + yOffset]) {
                return -Infinity;
            }
            else {
                return target.ends[i + yOffset] - s;
            }
        }
    }))) !== null && _b !== void 0 ? _b : 0);
    target.items.push(...nextChild.items.map(v => (Object.assign(Object.assign({}, v), { gridX: v.gridX + xOffset, gridY: v.gridY + yOffset }))));
    nextChild.ends.forEach((e, i) => {
        var _a, _b;
        if (target.starts[i + yOffset] === target.ends[i + yOffset]) {
            target.starts[i + yOffset] = ((_a = nextChild.starts[i]) !== null && _a !== void 0 ? _a : 0) + xOffset;
        }
        else {
            target.starts[i + yOffset] = (_b = target.starts[i + yOffset]) !== null && _b !== void 0 ? _b : 0;
        }
        target.ends[i + yOffset] = e + xOffset;
    });
}
//# sourceMappingURL=contentbuilder.js.map