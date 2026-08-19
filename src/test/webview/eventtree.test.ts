import './setup';
import * as assert from 'assert';
import { ConditionComplexExpr } from '../../hoiformat/condition';
import {
    EventGraphEdge,
    EventGraphEventNode,
    EventGraphNode,
    EventGraphOptionNode,
    EventGraphPayload,
} from '../../previewdef/event/payload';

// eventtree.ts reads window.eventGraph and builds its shell references at module scope, so both
// the payload and the DOM the host renders have to exist before the import runs. This mirrors the
// arab_spring.0 chain: one event with a trigger, one option, and two calls -- one guarded, one not.
const integrationPayload: EventGraphPayload = {
    roots: ['arab_spring.0:0'],
    conditionExprs: [],
    nodes: [
        {
            id: 'arab_spring.0:0', kind: 'event', eventId: 'arab_spring.0', eventType: 'country',
            scope: 'EVENT_TARGET', title: { key: 'arab_spring.0.t', text: 'Mass Protests Erupt' },
            major: false, hidden: false, fireOnlyOnce: false, isTriggeredOnly: true, loop: false,
            meanTimeToHappenBase: 1,
            trigger: { type: 'and', items: [
                { scopeName: '', nodeContent: 'is_in_array = { global.arabic_countries = THIS.id }' },
                { scopeName: '', nodeContent: 'has_country_flag = AS_arab_spring_completed' },
            ] },
            nav: { start: 10, end: 20, file: '00_arab_spring.txt' },
        },
        {
            id: 'arab_spring.0.a:1', kind: 'option',
            name: { key: 'arab_spring.0.a', text: 'We must mitigate this crisis!' },
            trigger: { scopeName: '', nodeContent: 'tag = FROM' },
        },
        {
            id: 'arab_spring.1:2', kind: 'event', eventId: 'arab_spring.1', eventType: 'news',
            scope: 'EVENT_TARGET', title: { key: 'arab_spring.1.t', text: 'Protests Erupt' },
            major: true, hidden: false, fireOnlyOnce: false, isTriggeredOnly: true, loop: false,
            meanTimeToHappenBase: 1, trigger: true,
        },
        {
            id: 'arab_spring.3:3', kind: 'event', eventId: 'arab_spring.3', eventType: 'country',
            scope: 'EVENT_TARGET.overlord', title: { key: 'arab_spring.3.t', text: 'Ally under Threat' },
            major: false, hidden: true, fireOnlyOnce: false, isTriggeredOnly: true, loop: false,
            meanTimeToHappenBase: 1, trigger: true,
        },
    ] as EventGraphNode[],
    edges: [
        { from: 'arab_spring.0:0', to: 'arab_spring.0.a:1', structural: true, immediate: false,
          scope: '', days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true },
        { from: 'arab_spring.0.a:1', to: 'arab_spring.1:2', structural: false, immediate: false,
          scope: '{event_target}', days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true },
        { from: 'arab_spring.0.a:1', to: 'arab_spring.3:3', structural: false, immediate: false,
          scope: 'OVERLORD', days: 1, hours: 0, randomDays: 0, randomHours: 0,
          condition: { scopeName: '', nodeContent: 'is_subject = yes' } },
    ],
};

(global as any).window.eventGraph = integrationPayload;

// The shell the host renders. Installed from the rendering suite's before hook rather than at
// module scope: every webview test file shares one jsdom document, and writing body.innerHTML
// here would clobber whichever other file's fixture happened to load after this one.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <input type="checkbox" id="show-localisation">
        <input type="checkbox" id="show-triggers">
        <input type="checkbox" id="show-event-conditions">
        <input type="checkbox" id="show-hidden">
    </div></div>
    <div id="dragger"></div>
    <div id="eventtreecontent"></div>`;

const eventtree = require('../../../webviewsrc/eventtree') as typeof import('../../../webviewsrc/eventtree');
const { conditionToDom, conditionToLabel, visibleGraph, layoutGraph } = eventtree;

function leaf(nodeContent: string, scopeName = ''): ConditionComplexExpr {
    return { scopeName, nodeContent };
}

function eventNode(id: string, extra: Partial<EventGraphEventNode> = {}): EventGraphNode {
    return {
        id,
        kind: 'event',
        eventId: id,
        eventType: 'country',
        scope: 'EVENT_TARGET',
        title: { key: `${id}.t`, text: `Title of ${id}` },
        major: false,
        hidden: false,
        fireOnlyOnce: false,
        isTriggeredOnly: true,
        loop: false,
        meanTimeToHappenBase: 1,
        trigger: true,
        ...extra,
    } as EventGraphEventNode;
}

function optionNode(id: string, extra: Partial<EventGraphOptionNode> = {}): EventGraphNode {
    return {
        id,
        kind: 'option',
        name: { key: id, text: `Name of ${id}` },
        trigger: true,
        ...extra,
    } as EventGraphOptionNode;
}

function edge(from: string, to: string, extra: Partial<EventGraphEdge> = {}): EventGraphEdge {
    return {
        from,
        to,
        structural: false,
        immediate: false,
        scope: '',
        days: 0,
        hours: 0,
        randomDays: 0,
        randomHours: 0,
        condition: true,
        ...extra,
    };
}

function payload(nodes: EventGraphNode[], edges: EventGraphEdge[], roots: string[]): EventGraphPayload {
    return { nodes, edges, roots, conditionExprs: [] };
}

describe('webview/eventtree conditionToDom', () => {
    it('renders a bare leaf as a single item', () => {
        const list = conditionToDom(leaf('tag = FROM'));
        assert.strictEqual(list.children.length, 1);
        assert.strictEqual(list.textContent, 'tag = FROM');
    });

    it('prefixes a scoped leaf with its scope', () => {
        const list = conditionToDom(leaf('is_subject = yes', 'OVERLORD'));
        assert.strictEqual(list.textContent, '[OVERLORD] is_subject = yes');
        assert.strictEqual(list.querySelectorAll('.ev-cond-scope').length, 1);
    });

    it('unwraps a single-item and folder so a one-condition trigger reads as one line', () => {
        const list = conditionToDom({ type: 'and', items: [leaf('tag = FROM')] });
        assert.strictEqual(list.querySelectorAll('.ev-fold').length, 0);
        assert.strictEqual(list.textContent, 'tag = FROM');
    });

    it('renders a multi-item folder as a labelled nested list', () => {
        const list = conditionToDom({
            type: 'and',
            items: [leaf('a = yes'), leaf('b = yes')],
        });
        const fold = list.querySelector('.ev-fold');
        assert.ok(fold);
        assert.strictEqual(fold!.textContent, 'all of');
        // One item holding the fold label, whose nested list holds one item per leaf.
        assert.strictEqual(list.children.length, 1);
        assert.strictEqual(list.querySelector('ul')!.children.length, 2);
    });

    it('nests a folder inside a folder', () => {
        const list = conditionToDom({
            type: 'and',
            items: [
                leaf('has_completed_focus = ENG_the_prince_trust'),
                { type: 'or', items: [leaf('x = 1'), leaf('y = 1')] },
            ],
        });
        const folds = Array.from(list.querySelectorAll('.ev-fold')).map(f => f.textContent);
        assert.deepStrictEqual(folds, ['all of', 'any of']);
    });

    it('names every folder type', () => {
        const label = (type: string) =>
            conditionToDom({ type, items: [leaf('a'), leaf('b')] } as ConditionComplexExpr)
                .querySelector('.ev-fold')!.textContent;
        assert.strictEqual(label('and'), 'all of');
        assert.strictEqual(label('or'), 'any of');
        assert.strictEqual(label('ornot'), 'none of');
        assert.strictEqual(label('andnot'), 'not');
    });

    it('shows the threshold on a count folder', () => {
        const list = conditionToDom({ type: 'count', amount: 2, items: [leaf('a'), leaf('b')] } as ConditionComplexExpr);
        assert.strictEqual(list.querySelector('.ev-fold')!.textContent, 'count == 2');
    });

    it('renders a boolean condition rather than throwing', () => {
        assert.strictEqual(conditionToDom(true).textContent, 'true');
        assert.strictEqual(conditionToDom(false).textContent, 'false');
    });
});

describe('webview/eventtree conditionToLabel', () => {
    it('is empty for an unconditional call, so no chip is drawn', () => {
        assert.strictEqual(conditionToLabel(true), '');
    });

    it('renders a leaf with its scope', () => {
        assert.strictEqual(conditionToLabel(leaf('is_subject = yes', 'OVERLORD')), '[OVERLORD] is_subject = yes');
    });

    it('collapses a single-item and, and negates a single-item andnot', () => {
        assert.strictEqual(conditionToLabel({ type: 'and', items: [leaf('tag = FROM')] }), 'tag = FROM');
        assert.strictEqual(conditionToLabel({ type: 'andnot', items: [leaf('tag = FROM')] }), 'not tag = FROM');
    });

    it('joins an or with or and an and with commas', () => {
        assert.strictEqual(conditionToLabel({ type: 'or', items: [leaf('a'), leaf('b')] }), 'a or b');
        assert.strictEqual(conditionToLabel({ type: 'and', items: [leaf('a'), leaf('b')] }), 'a, b');
    });
});

describe('webview/eventtree visibleGraph', () => {
    const nodes = [
        eventNode('root:0'),
        eventNode('hidden:1', { hidden: true }),
        eventNode('afterHidden:2'),
        eventNode('afterImmediate:3'),
    ];
    const edges = [
        edge('root:0', 'hidden:1'),
        edge('hidden:1', 'afterHidden:2'),
        edge('root:0', 'afterImmediate:3', { immediate: true }),
    ];
    const source = payload(nodes, edges, ['root:0']);

    it('passes the graph through untouched when hidden events are shown', () => {
        const visible = visibleGraph(source, true);
        assert.strictEqual(visible.nodes.length, 4);
        assert.strictEqual(visible.edges.length, 3);
    });

    it('drops a hidden event and everything reachable only through it', () => {
        const visible = visibleGraph(source, false);
        const ids = visible.nodes.map(n => n.id).sort();
        assert.deepStrictEqual(ids, ['root:0']);
    });

    it('drops the target of an immediate call', () => {
        const visible = visibleGraph(payload(
            [eventNode('a:0'), eventNode('b:1')],
            [edge('a:0', 'b:1', { immediate: true })],
            ['a:0'],
        ), false);
        assert.deepStrictEqual(visible.nodes.map(n => n.id), ['a:0']);
        assert.strictEqual(visible.edges.length, 0);
    });

    it('never leaves an edge pointing at a dropped node', () => {
        const visible = visibleGraph(source, false);
        const ids = new Set(visible.nodes.map(n => n.id));
        for (const e of visible.edges) {
            assert.ok(ids.has(e.from) && ids.has(e.to), `edge ${e.from} -> ${e.to} dangles`);
        }
    });
});

describe('webview/eventtree layoutGraph', () => {
    const size = (id: string, width = 100, height = 50) => ({ id, width, height });

    it('puts each rank in its own column, left to right', () => {
        const result = layoutGraph(
            [size('a'), size('b'), size('c')],
            [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
            ['a'],
        );
        const x = (id: string) => result.positions[id]!.x;
        assert.ok(x('a') < x('b'), 'b must sit right of a');
        assert.ok(x('b') < x('c'), 'c must sit right of b');
        assert.strictEqual(result.columnX.length, 3);
    });

    it('sizes a column from its widest card, so a wide card never overlaps the next column', () => {
        const narrow = layoutGraph([size('a', 100), size('b')], [{ from: 'a', to: 'b' }], ['a']);
        const wide = layoutGraph([size('a', 300), size('b')], [{ from: 'a', to: 'b' }], ['a']);
        assert.ok(
            wide.positions['b']!.x - wide.positions['a']!.x >= 300,
            'the second column must clear the wider first card',
        );
        assert.ok(wide.positions['b']!.x > narrow.positions['b']!.x);
    });

    it('stacks siblings vertically without overlapping', () => {
        const result = layoutGraph(
            [size('p'), size('c1'), size('c2')],
            [{ from: 'p', to: 'c1' }, { from: 'p', to: 'c2' }],
            ['p'],
        );
        const first = result.positions['c1']!;
        const second = result.positions['c2']!;
        assert.strictEqual(first.x, second.x, 'siblings share a column');
        assert.ok(Math.abs(first.y - second.y) >= 50, 'siblings must not overlap');
    });

    it('grows the row when a card gets taller, which is what expanding a condition panel does', () => {
        const short = layoutGraph(
            [size('p'), size('c1', 100, 50), size('c2')],
            [{ from: 'p', to: 'c1' }, { from: 'p', to: 'c2' }],
            ['p'],
        );
        const tall = layoutGraph(
            [size('p'), size('c1', 100, 200), size('c2')],
            [{ from: 'p', to: 'c1' }, { from: 'p', to: 'c2' }],
            ['p'],
        );
        const gapShort = short.positions['c2']!.y - short.positions['c1']!.y;
        const gapTall = tall.positions['c2']!.y - tall.positions['c1']!.y;
        assert.ok(gapTall > gapShort, 'the taller card must push its sibling down');
        assert.ok(tall.height > short.height);
    });

    it('centres a parent over its children', () => {
        const result = layoutGraph(
            [size('p'), size('c1'), size('c2')],
            [{ from: 'p', to: 'c1' }, { from: 'p', to: 'c2' }],
            ['p'],
        );
        const parentMid = result.positions['p']!.y + 25;
        const childMid = (result.positions['c1']!.y + result.positions['c2']!.y + 50) / 2;
        assert.ok(Math.abs(parentMid - childMid) < 1, `${parentMid} vs ${childMid}`);
    });

    it('lays out several roots without overlapping them', () => {
        const result = layoutGraph([size('a'), size('b')], [], ['a', 'b']);
        assert.strictEqual(result.positions['a']!.x, result.positions['b']!.x);
        assert.ok(Math.abs(result.positions['a']!.y - result.positions['b']!.y) >= 50);
    });

    it('places a node that no declared root reaches', () => {
        const result = layoutGraph([size('a'), size('orphan')], [], []);
        assert.ok(result.positions['orphan'], 'an unreferenced node must still be positioned');
    });

    it('terminates on a cycle instead of hanging', () => {
        const result = layoutGraph(
            [size('a'), size('b')],
            [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
            ['a'],
        );
        assert.ok(result.positions['a']);
        assert.ok(result.positions['b']);
    });

    it('reports a canvas large enough for every node', () => {
        const result = layoutGraph(
            [size('a'), size('b')],
            [{ from: 'a', to: 'b' }],
            ['a'],
        );
        for (const id of ['a', 'b']) {
            assert.ok(result.positions[id]!.x + 100 <= result.width);
            assert.ok(result.positions[id]!.y + 50 <= result.height);
        }
    });
});

describe('webview/eventtree layout over a realistic chain', () => {
    // arab_spring.0 -> option .0.a -> { arab_spring.1, arab_spring.3 }, with the two guarded
    // calls to arab_spring.3 that the schema now keeps apart.
    it('ranks the chain by depth', () => {
        const nodes = [
            eventNode('arab_spring.0:0'),
            optionNode('arab_spring.0.a:1'),
            eventNode('arab_spring.1:2', { eventType: 'news', major: true }),
            eventNode('arab_spring.3:3'),
        ];
        const edges = [
            edge('arab_spring.0:0', 'arab_spring.0.a:1', { structural: true }),
            edge('arab_spring.0.a:1', 'arab_spring.1:2'),
            edge('arab_spring.0.a:1', 'arab_spring.3:3', {
                scope: 'OVERLORD',
                days: 1,
                condition: leaf('is_subject = yes'),
            }),
        ];
        const result = layoutGraph(
            nodes.map(n => ({ id: n.id, width: 250, height: 80 })),
            edges,
            ['arab_spring.0:0'],
        );

        const x = (id: string) => result.positions[id]!.x;
        assert.ok(x('arab_spring.0:0') < x('arab_spring.0.a:1'));
        assert.ok(x('arab_spring.0.a:1') < x('arab_spring.1:2'));
        assert.strictEqual(x('arab_spring.1:2'), x('arab_spring.3:3'), 'both targets share a column');
    });
});

describe('webview/eventtree rendering', () => {
    const content = () => document.getElementById('eventtreecontent')!;
    const toggle = (id: string) => document.getElementById(id) as HTMLInputElement;

    function setToggle(id: string, value: boolean): void {
        const input = toggle(id);
        input.checked = value;
        input.dispatchEvent(new (window as any).Event('change'));
    }

    let previousBody = '';

    before(() => {
        previousBody = document.body.innerHTML;
        document.body.innerHTML = shellHtml;
        // The module binds its renderer to window load, as the webview does.
        window.dispatchEvent(new (window as any).Event('load'));
    });

    after(() => {
        document.body.innerHTML = previousBody;
    });

    it('renders a card per node', () => {
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
        assert.strictEqual(content().querySelectorAll('.ev-card-event').length, 3);
        assert.strictEqual(content().querySelectorAll('.ev-card-option').length, 1);
    });

    it('draws one svg path per edge', () => {
        assert.strictEqual(content().querySelectorAll('svg.ev-edges path').length, 3);
    });

    it('marks the guarded call with a dashed edge and a condition chip', () => {
        assert.strictEqual(content().querySelectorAll('path.ev-edge-guarded').length, 1);
        const guardedChip = content().querySelector('.ev-chip-guarded');
        assert.ok(guardedChip, 'the guarded call must be labelled');
        assert.ok(guardedChip!.textContent!.includes('is_subject = yes'), guardedChip!.textContent!);
        assert.ok(guardedChip!.textContent!.includes('OVERLORD'));
    });

    it('renders the option as a decision node carrying its trigger', () => {
        const option = content().querySelector('.ev-card-option')!;
        assert.ok(option.classList.contains('ev-card-gated'));
        assert.strictEqual(option.querySelectorAll('.ev-marker-decision').length, 1);
        const panel = option.querySelector('.ev-cond');
        assert.ok(panel, 'the option trigger must be shown');
        assert.ok(panel!.textContent!.includes('tag = FROM'));
    });

    it('renders the event trigger as a nested condition tree', () => {
        const card = Array.from(content().querySelectorAll('.ev-card-event'))
            .find(c => c.textContent!.includes('arab_spring.0'))!;
        const panel = card.querySelector('.ev-cond')!;
        assert.ok(panel.textContent!.includes('all of'));
        assert.ok(panel.textContent!.includes('is_in_array'));
    });

    it('marks the event card navigable so clicking it jumps to the definition', () => {
        const card = Array.from(content().querySelectorAll('.ev-card-event'))
            .find(c => c.textContent!.includes('arab_spring.0'))!;
        assert.ok(card.classList.contains('navigator'));
        assert.strictEqual(card.getAttribute('start'), '10');
        assert.strictEqual(card.getAttribute('file'), '00_arab_spring.txt');
    });

    it('swaps the localisation on and off without a host round trip', () => {
        setToggle('show-localisation', true);
        assert.ok(content().textContent!.includes('Mass Protests Erupt'));
        setToggle('show-localisation', false);
        assert.ok(!content().textContent!.includes('Mass Protests Erupt'));
        assert.ok(content().textContent!.includes('arab_spring.0.t'));
        setToggle('show-localisation', true);
    });

    it('drops the trigger panels and the guarded styling when triggers are hidden', () => {
        setToggle('show-triggers', false);
        assert.strictEqual(content().querySelectorAll('.ev-marker-decision').length, 0);
        assert.strictEqual(content().querySelectorAll('path.ev-edge-guarded').length, 0);
        assert.strictEqual(content().querySelectorAll('.ev-chip-guarded').length, 0);
        setToggle('show-triggers', true);
        assert.strictEqual(content().querySelectorAll('.ev-marker-decision').length, 1);
    });

    it('drops only the event trigger panel when event conditions are hidden', () => {
        setToggle('show-event-conditions', false);
        const card = Array.from(content().querySelectorAll('.ev-card-event'))
            .find(c => c.textContent!.includes('arab_spring.0'))!;
        assert.strictEqual(card.querySelectorAll('.ev-cond').length, 0);
        // The option trigger is governed by its own toggle and must survive.
        assert.ok(content().querySelector('.ev-card-option .ev-cond'));
        setToggle('show-event-conditions', true);
    });

    it('removes the hidden event and its edge when hidden events are off', () => {
        setToggle('show-hidden', false);
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 3);
        assert.strictEqual(content().querySelectorAll('svg.ev-edges path').length, 2);
        assert.ok(!content().textContent!.includes('Ally under Threat'));
        setToggle('show-hidden', true);
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
    });

    it('re-renders from a pushed update instead of reloading', () => {
        const next: EventGraphPayload = {
            roots: ['only:0'],
            conditionExprs: [],
            edges: [],
            nodes: [eventNode('only:0', { eventId: 'replaced.1' })],
        };
        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: next } },
        }));
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 1);
        assert.ok(content().textContent!.includes('replaced.1'));

        // Put the chain back so ordering between tests does not matter.
        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: integrationPayload } },
        }));
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
    });

    it('shows an empty state rather than a blank canvas when there is nothing to draw', () => {
        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', data: { eventGraph: { roots: [], nodes: [], edges: [], conditionExprs: [] } } },
        }));
        assert.ok(content().querySelector('.ev-empty'));
        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', data: { eventGraph: integrationPayload } },
        }));
    });
});
