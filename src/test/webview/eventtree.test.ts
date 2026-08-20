import './setup';
import * as assert from 'assert';
import { ConditionComplexExpr } from '../../hoiformat/condition';
import {
    EffectTreeNode,
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
    toolbarFlags: {
        hasChains: true,
        hasEffects: true,
        hasHidden: true,
        hasMajor: true,
        hasNews: true,
        hasMtth: false,
        hasTriggered: true,
        hasLocalisation: true,
        hasPicture: false,
    },
    effectBlocks: [
        [{ kind: 'line', scopeName: '', content: 'add_political_power = 50' }],
    ],
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
            effectsRef: 0,
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
        { from: 'arab_spring.0:0', to: 'arab_spring.0.a:1', structural: true, source: 'option',
          scope: '', days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true },
        { from: 'arab_spring.0.a:1', to: 'arab_spring.1:2', structural: false, source: 'option',
          scope: '{event_target}', days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true },
        { from: 'arab_spring.0.a:1', to: 'arab_spring.3:3', structural: false, source: 'option',
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
        <input type="checkbox" id="show-option-triggers">
        <input type="checkbox" id="show-edge-conditions">
        <input type="checkbox" id="show-event-conditions">
        <input type="checkbox" id="show-picture">
        <input type="checkbox" id="show-effects">
        <div id="ev-filter-container">
            <div class="select-container">
                <div id="ev-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    <div class="option" value="mtth" data-glyph="ev-marker ev-marker-mtth">MTTH events</div>
                    <div class="option" value="triggered" data-glyph="ev-marker ev-marker-triggered">Triggered only</div>
                    <div class="option" value="news" data-glyph="ev-marker ev-marker-news">News events</div>
                    <div class="option" value="hidden" data-glyph="ev-marker ev-marker-hidden">Hidden</div>
                    <div class="option" value="major" data-glyph="ev-marker ev-marker-major">Major</div>
                    <div class="option" value="chains" data-glyph="">Event chains</div>
                </div>
            </div>
        </div>
        <input type="text" id="ev-searchbox">
        <span id="ev-search-count"></span>
    </div></div>
    <div id="dragger"></div>
    <div id="eventtreecontent"></div>`;

const eventtree = require('../../../webviewsrc/eventtree') as typeof import('../../../webviewsrc/eventtree');
const {
    chipTextFor, conditionToDom, conditionToLabel, effectsToDom, filteredGraph, readFilters,
    matchesQuery, layoutGraph, separateChips,
} = eventtree;
type EventFilter = import('../../../webviewsrc/eventtree').EventFilter;

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
        source: 'option',
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
    return {
        nodes, edges, roots, conditionExprs: [], effectBlocks: [],
        toolbarFlags: {
            hasChains: true, hasEffects: true, hasHidden: true, hasMajor: true, hasNews: true,
            hasMtth: true, hasTriggered: true, hasLocalisation: true, hasPicture: true,
        },
    };
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
        assert.strictEqual(label('andnot'), 'not all of');
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

    it('keeps the negation on a multi-item andnot and ornot', () => {
        assert.strictEqual(
            conditionToLabel({ type: 'ornot', items: [leaf('a'), leaf('b')] }),
            'none of (a, b)',
        );
        assert.strictEqual(
            conditionToLabel({ type: 'andnot', items: [leaf('a'), leaf('b')] }),
            'not all of (a, b)',
        );
    });

    it('keeps the threshold on a count folder', () => {
        assert.strictEqual(
            conditionToLabel({ type: 'count', amount: 2, items: [leaf('a'), leaf('b')] }),
            'count == 2 (a, b)',
        );
    });

    it('leaves no empty slot behind an item that is always true', () => {
        assert.strictEqual(conditionToLabel({ type: 'and', items: [leaf('a'), true, leaf('b')] }), 'a, b');
    });
});

describe('webview/eventtree effectsToDom', () => {
    function line(content: string, scopeName = ''): EffectTreeNode {
        return { kind: 'line', scopeName, content };
    }

    it('renders a plain effect as one item', () => {
        const list = effectsToDom([line('add_political_power = 50')]);
        assert.strictEqual(list.children.length, 1);
        assert.strictEqual(list.textContent, 'add_political_power = 50');
    });

    it('prefixes an effect that runs in another scope', () => {
        const list = effectsToDom([line('add_stability = 0.05', 'FROM')]);
        assert.ok(list.textContent!.includes('[FROM]'), list.textContent!);
    });

    it('nests a guarded group under the condition that guards it', () => {
        const list = effectsToDom([
            { kind: 'group', condition: leaf('is_subject = yes'), items: [line('set_country_flag = paid')] },
        ]);

        const fold = list.querySelector('.ev-fold')!;
        assert.strictEqual(fold.textContent, 'if is_subject = yes');
        assert.strictEqual(list.querySelector('li ul')!.children.length, 1, 'the effect hangs under the fold');
        assert.ok(list.textContent!.includes('set_country_flag = paid'));
    });

    it('shows a random_list as one branch per weight, as written', () => {
        const list = effectsToDom([
            {
                kind: 'choice',
                items: [
                    { possibility: 30, effect: [line('add_stability = 0.05')] },
                    { possibility: 70, effect: [line('add_war_support = 0.05')] },
                ],
            },
        ]);

        const folds = Array.from(list.querySelectorAll('.ev-fold')).map(f => f.textContent);
        assert.deepStrictEqual(folds, ['weight 30', 'weight 70']);
        assert.ok(list.textContent!.includes('add_stability = 0.05'));
        assert.ok(list.textContent!.includes('add_war_support = 0.05'));
    });

    it('renders nothing for an empty block', () => {
        assert.strictEqual(effectsToDom([]).children.length, 0);
    });

    it('summarises the tail rather than filling the screen', () => {
        const many = Array.from({ length: 50 }, (_, i) => line(`add_political_power = ${i}`));
        const list = effectsToDom(many);

        assert.strictEqual(list.children.length, 41, 'forty lines and one summary');
        assert.strictEqual(list.lastElementChild!.textContent, '+10 more');
    });

    it('counts what it skipped inside a group it did not render', () => {
        const many = Array.from({ length: 40 }, (_, i) => line(`add_political_power = ${i}`));
        const list = effectsToDom([
            ...many,
            { kind: 'group', condition: leaf('is_subject = yes'), items: [line('a'), line('b')] },
        ]);

        assert.strictEqual(list.querySelectorAll('.ev-fold').length, 1, 'the group is summarised, not half drawn');
        assert.strictEqual(list.lastElementChild!.textContent, '+2 more');
    });
});

describe('webview/eventtree readFilters', () => {
    it('reads nothing out of a state that has never held a selection', () => {
        assert.deepStrictEqual(readFilters(undefined), []);
        assert.deepStrictEqual(readFilters('major'), []);
    });

    it('drops a value that is not a filter', () => {
        assert.deepStrictEqual(readFilters(['major', 'show-hidden', 7]), ['major']);
    });

    it('normalises the order, so the same selection is the same list however it was ticked', () => {
        assert.deepStrictEqual(readFilters(['chains', 'mtth', 'major']), ['mtth', 'major', 'chains']);
    });
});

describe('webview/eventtree filteredGraph', () => {
    const source = payload(
        [
            eventNode('plain:0'),
            eventNode('hidden:1', { hidden: true }),
            eventNode('major:2', { major: true }),
            eventNode('news:3', { eventType: 'news' }),
            eventNode('mtth:4', { isTriggeredOnly: false }),
        ],
        [],
        ['plain:0', 'hidden:1', 'major:2', 'news:3', 'mtth:4'],
    );

    const idsOf = (filters: EventFilter[]) =>
        filteredGraph(source, filters).nodes.map(n => n.id).sort();

    it('is not a filter at all when nothing is selected', () => {
        const result = filteredGraph(source, []);
        assert.strictEqual(result.nodes, source.nodes);
        assert.strictEqual(result.edges, source.edges);
        assert.strictEqual(result.roots, source.roots);
    });

    it('keeps only the events matching the one selected filter', () => {
        assert.deepStrictEqual(idsOf(['hidden']), ['hidden:1']);
        assert.deepStrictEqual(idsOf(['major']), ['major:2']);
        assert.deepStrictEqual(idsOf(['news']), ['news:3']);
    });

    it('splits every event between mtth and triggered only, and nowhere else', () => {
        assert.deepStrictEqual(idsOf(['mtth']), ['mtth:4']);
        assert.deepStrictEqual(idsOf(['triggered']), ['hidden:1', 'major:2', 'news:3', 'plain:0']);
        assert.strictEqual(idsOf(['mtth', 'triggered']).length, source.nodes.length);
    });

    it('ors two filters together, so selecting more shows more', () => {
        assert.deepStrictEqual(idsOf(['major', 'news']), ['major:2', 'news:3']);
    });

    it('does not mutate the payload it was given', () => {
        const roots = [...source.roots];
        filteredGraph(source, ['major']);
        assert.deepStrictEqual(source.roots, roots);
        assert.strictEqual(source.nodes.length, 5);
    });
});

describe('webview/eventtree filteredGraph keeps chains connected', () => {
    // a -> b -> c, each call going through an option, with only a and c kept by the filter.
    const bridged = payload(
        [
            eventNode('a:0', { major: true }), optionNode('ao:1'),
            eventNode('b:2'), optionNode('bo:3'),
            eventNode('c:4', { major: true }),
        ],
        [
            edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2'),
            edge('b:2', 'bo:3', { structural: true }), edge('bo:3', 'c:4'),
        ],
        ['a:0'],
    );

    it('redirects the call over the event it dropped rather than cutting the chain', () => {
        const result = filteredGraph(bridged, ['major']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:0', 'ao:1', 'c:4']);
        assert.deepStrictEqual(
            result.edges.map(e => `${e.from}->${e.to}`),
            ['a:0->ao:1', 'ao:1->c:4'],
        );
    });

    it('says on the arrow which events it now steps over', () => {
        const bridge = filteredGraph(bridged, ['major']).edges.find(e => e.to === 'c:4');
        assert.deepStrictEqual(bridge?.skipped, ['b:2']);
    });

    it('names every event in a longer run, in the order they were walked', () => {
        const longer = payload(
            [
                eventNode('a:0', { major: true }), optionNode('ao:1'),
                eventNode('b:2'), eventNode('c:3'),
                eventNode('d:4', { major: true }),
            ],
            [
                edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2'),
                edge('b:2', 'c:3', { source: 'immediate' }), edge('c:3', 'd:4', { source: 'immediate' }),
            ],
            ['a:0'],
        );
        const bridge = filteredGraph(longer, ['major']).edges.find(e => e.to === 'd:4');
        assert.deepStrictEqual(bridge?.skipped, ['b:2', 'c:3']);
    });

    it('keeps what the call was, so the delay and the guard on it are not invented anew', () => {
        const guarded = payload(
            [
                eventNode('a:0', { major: true }), optionNode('ao:1'),
                eventNode('b:2'), optionNode('bo:3'), eventNode('c:4', { major: true }),
            ],
            [
                edge('a:0', 'ao:1', { structural: true }),
                edge('ao:1', 'b:2', { days: 5, scope: 'OVERLORD', condition: leaf('tag = FROM') }),
                edge('b:2', 'bo:3', { structural: true }), edge('bo:3', 'c:4'),
            ],
            ['a:0'],
        );
        const bridge = filteredGraph(guarded, ['major']).edges.find(e => e.to === 'c:4');
        assert.strictEqual(bridge?.days, 5);
        assert.strictEqual(bridge?.scope, 'OVERLORD');
        assert.deepStrictEqual(bridge?.condition, leaf('tag = FROM'));
    });

    it('drops the arrow when nothing kept is left downstream of it', () => {
        const deadEnd = payload(
            [eventNode('a:0', { major: true }), optionNode('ao:1'), eventNode('b:2')],
            [edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2')],
            ['a:0'],
        );
        const result = filteredGraph(deadEnd, ['major']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:0', 'ao:1']);
        assert.deepStrictEqual(result.edges.map(e => `${e.from}->${e.to}`), ['a:0->ao:1']);
    });

    it('terminates on a cycle of dropped events instead of hanging', () => {
        const cycle = payload(
            [
                eventNode('a:0', { major: true }), optionNode('ao:1'),
                eventNode('b:2'), eventNode('c:3'),
            ],
            [
                edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2'),
                edge('b:2', 'c:3', { source: 'immediate' }), edge('c:3', 'b:2', { source: 'immediate' }),
            ],
            ['a:0'],
        );
        const result = filteredGraph(cycle, ['major']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:0', 'ao:1']);
    });

    it('never leaves an edge pointing at a dropped node', () => {
        const result = filteredGraph(bridged, ['major']);
        const ids = new Set(result.nodes.map(n => n.id));
        for (const e of result.edges) {
            assert.ok(ids.has(e.from) && ids.has(e.to), `edge ${e.from} -> ${e.to} dangles`);
        }
    });
});

describe('webview/eventtree filteredGraph chains', () => {
    // E1 offers two options: one calls E2, the other leads nowhere. E9 stands alone.
    const chain = payload(
        [
            eventNode('e1:0'), optionNode('a:1'), optionNode('b:2'), eventNode('e2:3'),
            eventNode('e9:4'), optionNode('x:5'),
        ],
        [
            edge('e1:0', 'a:1', { structural: true }),
            edge('e1:0', 'b:2', { structural: true }),
            edge('a:1', 'e2:3'),
            edge('e9:4', 'x:5', { structural: true }),
        ],
        ['e1:0', 'e9:4'],
    );

    it('keeps a chained event and every option it offers, dead ends included', () => {
        const ids = filteredGraph(chain, ['chains']).nodes.map(n => n.id).sort();
        assert.deepStrictEqual(ids, ['a:1', 'b:2', 'e1:0', 'e2:3']);
    });

    it('drops an event that calls nothing, and its options with it', () => {
        const ids = new Set(filteredGraph(chain, ['chains']).nodes.map(n => n.id));
        assert.ok(!ids.has('e9:4'));
        assert.ok(!ids.has('x:5'));
    });

    it('keeps an unresolved target and the event that calls it', () => {
        const result = filteredGraph(payload(
            [eventNode('e1:0'), optionNode('a:1'), {
                id: 'gone:2', kind: 'unresolved', eventId: 'other.4', scope: 'EVENT_TARGET',
            } as EventGraphNode],
            [edge('e1:0', 'a:1', { structural: true }), edge('a:1', 'gone:2')],
            ['e1:0'],
        ), ['chains']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:1', 'e1:0', 'gone:2']);
    });

    it('drops an unresolved target under a filter it has nothing to match with', () => {
        const result = filteredGraph(payload(
            [eventNode('e1:0', { major: true }), optionNode('a:1'), {
                id: 'gone:2', kind: 'unresolved', eventId: 'other.4', scope: 'EVENT_TARGET',
            } as EventGraphNode],
            [edge('e1:0', 'a:1', { structural: true }), edge('a:1', 'gone:2')],
            ['e1:0'],
        ), ['major']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:1', 'e1:0']);
    });

    it('keeps an event linked by an immediate call with no option in between', () => {
        const result = filteredGraph(payload(
            [eventNode('a:0'), eventNode('b:1')],
            [edge('a:0', 'b:1', { source: 'immediate' })],
            ['a:0'],
        ), ['chains']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:0', 'b:1']);
    });

    it('keeps an event linked by a call from the after block', () => {
        // The after block runs once the event is dismissed, so its calls continue the chain exactly
        // like an immediate one -- and used to be dropped before they ever reached the canvas.
        const result = filteredGraph(payload(
            [eventNode('a:0'), eventNode('b:1')],
            [edge('a:0', 'b:1', { source: 'after' })],
            ['a:0'],
        ), ['chains']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:0', 'b:1']);
    });

    it('keeps an event that fires itself', () => {
        const result = filteredGraph(payload(
            [eventNode('e:0'), optionNode('a:1')],
            [edge('e:0', 'a:1', { structural: true }), edge('a:1', 'e:0')],
            ['e:0'],
        ), ['chains']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['a:1', 'e:0']);
    });

    it('counts every owner of an option reached from two events', () => {
        // The same option node is emitted once per scope situation, so it can hang off two events.
        const result = filteredGraph(payload(
            [eventNode('e1:0'), eventNode('e2:1'), optionNode('shared:2'), eventNode('e3:3')],
            [
                edge('e1:0', 'shared:2', { structural: true }),
                edge('e2:1', 'shared:2', { structural: true }),
                edge('shared:2', 'e3:3'),
            ],
            ['e1:0', 'e2:1'],
        ), ['chains']);
        assert.deepStrictEqual(result.nodes.map(n => n.id).sort(), ['e1:0', 'e2:1', 'e3:3', 'shared:2']);
    });

    it('makes an event whose only caller was dropped a root', () => {
        const result = filteredGraph(payload(
            [
                eventNode('caller:0', { major: true }), optionNode('co:1'),
                eventNode('called:2'), optionNode('xo:3'), eventNode('last:4'),
            ],
            [
                edge('caller:0', 'co:1', { structural: true }), edge('co:1', 'called:2'),
                edge('called:2', 'xo:3', { structural: true }), edge('xo:3', 'last:4'),
            ],
            ['caller:0'],
        ), ['triggered']);
        // caller is major but also triggered, so all three survive; nothing is re-rooted here.
        assert.deepStrictEqual(result.roots, ['caller:0']);

        const withoutCaller = filteredGraph(payload(
            [
                eventNode('caller:0', { isTriggeredOnly: false }), optionNode('co:1'),
                eventNode('called:2'),
            ],
            [edge('caller:0', 'co:1', { structural: true }), edge('co:1', 'called:2')],
            ['caller:0'],
        ), ['triggered']);
        assert.deepStrictEqual(withoutCaller.roots, ['called:2']);
    });

    it('keeps the declared root of a group that is nothing but a cycle', () => {
        const result = filteredGraph(payload(
            [eventNode('a:0'), optionNode('ao:1'), eventNode('b:2'), optionNode('bo:3')],
            [
                edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2'),
                edge('b:2', 'bo:3', { structural: true }), edge('bo:3', 'a:0'),
            ],
            ['a:0'],
        ), ['chains']);
        assert.deepStrictEqual(result.roots, ['a:0']);
    });
});

describe('webview/eventtree chipTextFor', () => {
    it('says the scope and the delay of a call an option makes', () => {
        assert.strictEqual(
            chipTextFor(edge('a:0', 'b:1', { scope: 'ANQ', days: 239 }), false),
            'ANQ · 239 day(s)',
        );
    });

    it('leaves the scope off a call that stays in the event target', () => {
        assert.strictEqual(chipTextFor(edge('a:0', 'b:1', { scope: '{event_target}', hours: 5 }), false), '5 hour(s)');
    });

    it('names the block an event fires a call from', () => {
        assert.strictEqual(
            chipTextFor(edge('a:0', 'b:1', { source: 'immediate', scope: 'GXC', days: 1 }), false),
            'GXC · 1 day(s) · immediate',
        );
        assert.strictEqual(
            chipTextFor(edge('a:0', 'b:1', { source: 'after', scope: 'ANQ', hours: 5 }), false),
            'ANQ · 5 hour(s) · after',
        );
    });

    it('writes a random delay as the range it can land in', () => {
        assert.strictEqual(chipTextFor(edge('a:0', 'b:1', { days: 1, randomDays: 7 }), false), '1-8 day(s)');
    });

    it('adds the weight, the filtered-out count and the guard behind them', () => {
        const text = chipTextFor(
            edge('a:0', 'b:1', {
                source: 'after',
                days: 3,
                possibility: 70,
                skipped: ['x:2'],
                condition: leaf('is_subject = yes'),
            }),
            true,
        );
        assert.strictEqual(text, '3 day(s) · after · weight 70 · 1 filtered out · is_subject = yes');
    });
});

describe('webview/eventtree matchesQuery', () => {
    const event = eventNode('arab_spring.1', { title: { key: 'arab_spring.1.t', text: 'Protests Erupt' } });

    it('matches on the event id', () => {
        assert.ok(matchesQuery(event, 'spring.1'));
    });

    it('matches on the localised title', () => {
        assert.ok(matchesQuery(event, 'protests'));
    });

    it('matches on the localisation key', () => {
        assert.ok(matchesQuery(event, 'arab_spring.1.t'));
    });

    it('is case insensitive', () => {
        assert.ok(matchesQuery(event, 'erupt'));
    });

    it('never matches an option', () => {
        assert.ok(!matchesQuery(optionNode('arab_spring.0.a'), 'arab_spring'));
    });

    it('matches an unresolved node by id, with or without a title', () => {
        const bare = { id: 'gone:0', kind: 'unresolved', eventId: 'other.4', scope: 'EVENT_TARGET' } as EventGraphNode;
        assert.ok(matchesQuery(bare, 'other.4'));
        assert.ok(!matchesQuery(bare, 'nothing'));
    });

    it('matches nothing for an empty query', () => {
        assert.ok(!matchesQuery(event, ''));
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

    it('places a node reached twice to the right of both callers', () => {
        // a -> b -> c -> d and a -> d: ranking on the first edge into d would put it in column 1,
        // left of c, and the edge from c would point backwards.
        const result = layoutGraph(
            [size('a'), size('b'), size('c'), size('d')],
            [
                { from: 'a', to: 'd' },
                { from: 'a', to: 'b' },
                { from: 'b', to: 'c' },
                { from: 'c', to: 'd' },
            ],
            ['a'],
        );
        const x = (id: string) => result.positions[id]!.x;
        assert.ok(x('d') > x('a'), 'd must sit right of a');
        assert.ok(x('d') > x('c'), 'd must sit right of c, its deeper caller');
    });

    it('stacks a node with two callers beside the nearer one', () => {
        const result = layoutGraph(
            [size('a'), size('b'), size('c')],
            [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
            ['a'],
        );
        assert.ok(result.positions['c']!.x > result.positions['b']!.x);
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

describe('webview/eventtree layout never overlaps', () => {
    const size = (id: string, width = 100, height = 50) => ({ id, width, height });

    // The only assertion that matters: no two cards may share a pixel. Turning "show triggers" and
    // "show event conditions" on is what makes a card tall enough to reach into its neighbours.
    function assertNoOverlap(
        result: ReturnType<typeof layoutGraph>,
        nodes: { id: string; width: number; height: number }[],
    ): void {
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]!;
                const b = nodes[j]!;
                const pa = result.positions[a.id]!;
                const pb = result.positions[b.id]!;
                const apart =
                    pa.x + a.width <= pb.x || pb.x + b.width <= pa.x ||
                    pa.y + a.height <= pb.y || pb.y + b.height <= pa.y;
                assert.ok(apart, `${a.id} and ${b.id} overlap: ${JSON.stringify(pa)} ${JSON.stringify(pb)}`);
            }
        }
    }

    it('keeps a parent taller than its children clear of the next subtree', () => {
        // p1 is 400 tall because its condition panel is expanded, while its only child is 50. Centring
        // p1 on that child used to reach far above and below the child's band, into p2's rows.
        const nodes = [
            size('root'), size('p1', 100, 400), size('c1'), size('p2'), size('c2'),
        ];
        const result = layoutGraph(
            nodes,
            [
                { from: 'root', to: 'p1' }, { from: 'p1', to: 'c1' },
                { from: 'root', to: 'p2' }, { from: 'p2', to: 'c2' },
            ],
            ['root'],
        );
        assertNoOverlap(result, nodes);
    });

    it('keeps two tall roots apart', () => {
        const nodes = [size('r1', 100, 300), size('l1'), size('r2', 100, 300), size('l2')];
        const result = layoutGraph(
            nodes,
            [{ from: 'r1', to: 'l1' }, { from: 'r2', to: 'l2' }],
            ['r1', 'r2'],
        );
        assertNoOverlap(result, nodes);
    });

    it('separates every card of a mixed-height tree', () => {
        // Heights chosen so several parents outgrow their children's band at once.
        const heights = [30, 420, 60, 250, 40, 380, 55, 90, 310, 45, 70, 200];
        const nodes = heights.map((height, i) => size('n' + i, 100, height));
        const edges = [];
        for (let i = 1; i < nodes.length; i++) {
            edges.push({ from: 'n' + Math.floor((i - 1) / 2), to: 'n' + i });
        }
        const result = layoutGraph(nodes, edges, ['n0']);
        assertNoOverlap(result, nodes);
    });

    it('separates cards that several callers share', () => {
        // A node reached from three places is placed once and reused, which used to drag its parent's
        // centre far from its siblings.
        const nodes = [
            size('a', 100, 200), size('b', 100, 60), size('c', 100, 300), size('shared'), size('d'),
        ];
        const result = layoutGraph(
            nodes,
            [
                { from: 'a', to: 'shared' }, { from: 'b', to: 'shared' }, { from: 'c', to: 'shared' },
                { from: 'a', to: 'd' },
            ],
            ['a', 'b', 'c'],
        );
        assertNoOverlap(result, nodes);
    });

    it('never places a card above the canvas, where the toolbar would cover it', () => {
        const nodes = [size('p', 100, 500), size('c')];
        const result = layoutGraph(nodes, [{ from: 'p', to: 'c' }], ['p']);
        for (const node of nodes) {
            assert.ok(result.positions[node.id]!.y >= 0, `${node.id} is above the canvas`);
            assert.ok(result.positions[node.id]!.y + node.height <= result.height);
        }
    });

    it('still centres a parent when its children leave room for it', () => {
        const result = layoutGraph(
            [size('p'), size('c1'), size('c2')],
            [{ from: 'p', to: 'c1' }, { from: 'p', to: 'c2' }],
            ['p'],
        );
        const middle = (result.positions['c1']!.y + result.positions['c2']!.y + 50) / 2;
        assert.ok(Math.abs(result.positions['p']!.y + 25 - middle) < 1, 'the parent must stay centred');
    });
});

describe('webview/eventtree chip spacing', () => {
    const size = (id: string, width = 100, height = 50) => ({ id, width, height });

    it('widens the gap so a wide condition label clears both columns', () => {
        const nodes = [size('a'), size('b')];
        const edges = [{ from: 'a', to: 'b' }];
        const narrow = layoutGraph(nodes, edges, ['a'], [{ from: 'a', to: 'b', width: 20 }]);
        const wide = layoutGraph(nodes, edges, ['a'], [{ from: 'a', to: 'b', width: 220 }]);

        assert.ok(wide.gapWidth[0]! >= 220, 'the gap must hold the chip');
        assert.ok(wide.gapWidth[0]! > narrow.gapWidth[0]!, 'a wider chip must widen the gap');
        // The chip is centred in the gap, so clearing the gap is what keeps it off the cards.
        const chipLeft = wide.gapX[0]! + wide.gapWidth[0]! / 2 - 110;
        const chipRight = chipLeft + 220;
        assert.ok(chipLeft >= wide.positions['a']!.x + 100, 'the chip must clear the source card');
        assert.ok(chipRight <= wide.positions['b']!.x, 'the chip must clear the target card');
    });

    it('leaves the gap alone when no chip needs the room', () => {
        const result = layoutGraph([size('a'), size('b')], [{ from: 'a', to: 'b' }], ['a']);
        assert.strictEqual(result.gapWidth[0], 78);
    });

    it('sizes the gap after the source column even when the arrow skips a column', () => {
        // a -> c jumps over b's column. Parking the label in the gap after a keeps it off b's card.
        const result = layoutGraph(
            [size('a'), size('b'), size('c')],
            [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }],
            ['a'],
            [{ from: 'a', to: 'c', width: 200 }],
        );
        assert.ok(result.gapWidth[0]! >= 200, 'the gap after a holds the label');
        assert.strictEqual(result.gapWidth[1], 78, 'the gap after b is untouched');
    });

    it('pushes two labels in one gap apart', () => {
        const chips = [
            { gap: 0, y: 100, height: 20 },
            { gap: 0, y: 105, height: 20 },
            { gap: 0, y: 108, height: 20 },
        ];
        separateChips(chips);
        for (let i = 1; i < chips.length; i++) {
            assert.ok(
                chips[i]!.y >= chips[i - 1]!.y + chips[i - 1]!.height,
                'labels in one gap must not overlap',
            );
        }
    });

    it('leaves labels in different gaps alone', () => {
        const chips = [{ gap: 0, y: 100, height: 20 }, { gap: 1, y: 100, height: 20 }];
        separateChips(chips);
        assert.strictEqual(chips[0]!.y, 100);
        assert.strictEqual(chips[1]!.y, 100);
    });

    it('leaves labels that already clear each other where they are', () => {
        const chips = [{ gap: 0, y: 100, height: 20 }, { gap: 0, y: 300, height: 20 }];
        separateChips(chips);
        assert.strictEqual(chips[0]!.y, 100);
        assert.strictEqual(chips[1]!.y, 300);
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
    // The effects panel waits out a hover delay before it appears, so the tests that drive it have
    // to wait too.
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    function setToggle(id: string, value: boolean): void {
        const input = toggle(id);
        input.checked = value;
        input.dispatchEvent(new (window as any).Event('change'));
    }

    const push = (next: EventGraphPayload) => window.dispatchEvent(new (window as any).MessageEvent('message', {
        data: { type: 'updateBody', styleCss: '', data: { eventGraph: next } },
    }));

    // What the closed combobox reads, which is the only place the current selection is shown.
    const filterValue = () => document.querySelector('#ev-filters > span.value')!.textContent;

    // The entries the file can use. A gated-out entry is hidden rather than removed, which is what
    // stops DivDropdown from offering it.
    const offeredFilters = () => Array.from(document.querySelectorAll('#ev-filters .option'))
        .filter(option => !option.hasAttribute('hidden'))
        .map(option => option.getAttribute('value'));

    // Drives the real widget rather than reaching past it: open the menu, tick the boxes that
    // should be on and untick the rest, then close it. The items follow the offered options in
    // order, so an entry the flags took away cannot be selected here either.
    function setFilters(values: string[]): void {
        const select = document.getElementById('ev-filters')!;
        select.dispatchEvent(new (window as any).MouseEvent('mousedown'));
        const list = document.querySelector('ul.select-dropdown');
        if (!list) {
            assert.deepStrictEqual(values, [], 'the filter list is not open, so nothing can be selected');
            return;
        }
        const offered = offeredFilters();
        Array.from(list.querySelectorAll('li')).forEach((item, index) => {
            const checkbox = item.querySelector('input[type=checkbox]') as HTMLInputElement;
            if (checkbox.checked !== values.includes(offered[index] ?? '')) {
                checkbox.click();
            }
        });
        window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { code: 'Escape' }));
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

    it('announces a toggle that is on as checked', () => {
        // The shared widget is built before the saved values are restored, so without a resync it
        // would report every toggle as unchecked until the first click.
        for (const id of ['show-localisation', 'show-option-triggers', 'show-edge-conditions',
            'show-event-conditions']) {
            const input = toggle(id);
            const widget = input.parentElement!.querySelector('[role=checkbox]')!;
            assert.strictEqual(
                widget.getAttribute('aria-checked'),
                input.checked.toString(),
                `${id} announces the wrong state`,
            );
            assert.strictEqual(input.checked, true, `${id} should default to on`);
        }
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

    // The glyph row, which is what says at a glance what kind of event a card is.
    describe('the kind markers', () => {
        const cardFor = (eventId: string) => Array.from(content().querySelectorAll('.ev-card-event'))
            .find(c => c.textContent!.includes(eventId))!;
        const glyphsOf = (eventId: string) => Array.from(
            cardFor(eventId).querySelectorAll('.ev-markers > .ev-marker'),
        ).map(glyph => glyph.className.replace('ev-marker ', ''));

        it('gives a plain triggered-only event one square and nothing else', () => {
            assert.deepStrictEqual(glyphsOf('arab_spring.0'), ['ev-marker-triggered']);
        });

        it('shows every kind an event is at once, in a fixed order', () => {
            // arab_spring.1 is a major news event that is triggered only: all three, news first.
            assert.deepStrictEqual(
                glyphsOf('arab_spring.1'),
                ['ev-marker-news', 'ev-marker-major', 'ev-marker-triggered'],
            );
        });

        it('marks a hidden event hollow', () => {
            assert.deepStrictEqual(
                glyphsOf('arab_spring.3'),
                ['ev-marker-hidden', 'ev-marker-triggered'],
            );
        });

        // Each shape owns a colour in the stylesheet, so the row must not paint over them with one.
        it('leaves the colour to the shapes and names the scope on the row', () => {
            const row = cardFor('arab_spring.1').querySelector('.ev-markers') as HTMLElement;
            assert.strictEqual(row.style.getPropertyValue('--ev-dot'), '');
            assert.strictEqual(row.title, 'news_event');
        });

        const badgesOf = (eventId: string) => Array.from(
            cardFor(eventId).querySelectorAll('.ev-meta > .ev-badge'),
        ).map(b => b.textContent);

        it('writes out the scope kind the row colour used to carry', () => {
            assert.ok(badgesOf('arab_spring.1').includes('news_event'), badgesOf('arab_spring.1').join());
        });

        it('leaves a country event unbadged, since that is nearly every event', () => {
            assert.ok(!badgesOf('arab_spring.0').some(t => t!.endsWith('_event')), badgesOf('arab_spring.0').join());
        });

        it('names each glyph, so what it stands for can be read off it', () => {
            const glyphs = Array.from(
                cardFor('arab_spring.1').querySelectorAll('.ev-markers > .ev-marker'),
            ) as HTMLElement[];
            assert.deepStrictEqual(
                glyphs.map(g => g.title),
                ['News', 'Major', 'Is triggered only'],
            );
        });
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

    it('drops only the option trigger panel when option triggers are hidden', () => {
        setToggle('show-option-triggers', false);
        assert.strictEqual(content().querySelectorAll('.ev-marker-decision').length, 0);
        assert.strictEqual(content().querySelectorAll('.ev-card-option .ev-cond').length, 0);
        // The arrows have their own toggle and must be untouched.
        assert.strictEqual(content().querySelectorAll('path.ev-edge-guarded').length, 1);
        assert.strictEqual(content().querySelectorAll('.ev-chip-guarded').length, 1);
        setToggle('show-option-triggers', true);
        assert.strictEqual(content().querySelectorAll('.ev-marker-decision').length, 1);
        assert.ok(content().querySelector('.ev-card-option .ev-cond'));
    });

    it('drops only the arrow conditions when they are hidden', () => {
        setToggle('show-edge-conditions', false);
        assert.strictEqual(content().querySelectorAll('path.ev-edge-guarded').length, 0);
        assert.strictEqual(content().querySelectorAll('.ev-chip-guarded').length, 0);
        // The option card keeps its trigger, which is a different condition.
        assert.strictEqual(content().querySelectorAll('.ev-marker-decision').length, 1);
        assert.ok(content().querySelector('.ev-card-option .ev-cond'));
        setToggle('show-edge-conditions', true);
        assert.strictEqual(content().querySelectorAll('path.ev-edge-guarded').length, 1);
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

    it('narrows the canvas to the hidden event and puts the rest back', () => {
        setFilters(['hidden']);
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 1);
        assert.strictEqual(content().querySelectorAll('svg.ev-edges path').length, 0);
        assert.ok(content().textContent!.includes('Ally under Threat'));
        setFilters([]);
        assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
    });

    it('marks a card that has effects and shows them on hover', async () => {
        const tips = () => document.querySelectorAll('.ev-effects-tip').length;
        const hover = (type: string) => content()
            .querySelector('.ev-card-option')!
            .parentElement!
            .dispatchEvent(new (window as any).MouseEvent(type));

        assert.ok(content().querySelector('.ev-card-option .ev-effects-dot'), 'the option must be marked');

        hover('mouseenter');
        assert.strictEqual(tips(), 0, 'nothing may appear before the hover delay');
        await wait(250);
        assert.strictEqual(tips(), 1, 'the panel must appear once the delay is up');
        const panel = document.querySelector('.ev-effects-tip')!;
        assert.ok(panel.textContent!.includes('Effects'));
        assert.ok(panel.textContent!.includes('add_political_power = 50'), panel.textContent!);

        hover('mouseleave');
        assert.strictEqual(tips(), 0, 'the panel must go away again');
    });

    it('drops the dot and the panel when effects are off', async () => {
        setToggle('show-effects', false);
        assert.strictEqual(content().querySelectorAll('.ev-effects-dot').length, 0);

        content().querySelector('.ev-card-option')!.parentElement!
            .dispatchEvent(new (window as any).MouseEvent('mouseenter'));
        await wait(250);
        assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 0);

        setToggle('show-effects', true);
        assert.strictEqual(content().querySelectorAll('.ev-effects-dot').length, 1);
    });

    // The panel is a <body> child placed by hand, and the toolbar strip is drawn over it, so a panel
    // put under the strip would simply be invisible.
    it('keeps the effects panel clear of the toolbar strip', async () => {
        content().querySelector('.ev-card-option')!.parentElement!
            .dispatchEvent(new (window as any).MouseEvent('mouseenter'));
        await wait(250);
        const panel = document.querySelector('.ev-effects-tip') as HTMLElement;
        assert.ok(panel, 'the panel must be open');
        assert.ok(parseFloat(panel.style.top) >= 52, `panel placed at ${panel.style.top}`);

        content().querySelector('.ev-card-option')!.parentElement!
            .dispatchEvent(new (window as any).MouseEvent('mouseleave'));
    });

    it('leaves no panel behind when the file is re-rendered mid-hover', async () => {
        content().querySelector('.ev-card-option')!.parentElement!
            .dispatchEvent(new (window as any).MouseEvent('mouseenter'));
        await wait(250);
        assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 1);

        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: integrationPayload } },
        }));
        assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 0);
    });

    // Dragging the canvas moves the cards under a stationary cursor, so every card the graph slides
    // past would otherwise announce itself. The drag layer publishes the press; these check the
    // preview acts on it, and that letting go puts hovering back exactly as it was.
    describe('while the canvas is being dragged', () => {
        const press = () => document.getElementById('dragger')!
            .dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true }));
        const release = () => document.body
            .dispatchEvent(new (window as any).MouseEvent('mouseup', { bubbles: true }));
        const hover = (type: string) => content()
            .querySelector('.ev-card-option')!
            .parentElement!
            .dispatchEvent(new (window as any).MouseEvent(type));

        // A nested suite runs after every test of its parent, so the chain and the toggles are put
        // back rather than assumed: whichever payload the last of those left behind is not this
        // suite's concern.
        before(() => {
            window.dispatchEvent(new (window as any).MessageEvent('message', {
                data: { type: 'updateBody', styleCss: '', data: { eventGraph: integrationPayload } },
            }));
            setToggle('show-effects', true);
        });

        afterEach(() => {
            release();
            hover('mouseleave');
        });

        it('marks the body so the cursor can show the drag, and clears it on release', () => {
            press();
            assert.ok(document.body.classList.contains('panning'));
            release();
            assert.ok(!document.body.classList.contains('panning'));
        });

        it('opens no effects panel for a card the drag passes under', async () => {
            press();
            hover('mouseenter');
            await wait(250);
            assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 0);
        });

        it('does not dim the chain for a card the drag passes under', () => {
            press();
            hover('mouseenter');
            assert.strictEqual(content().querySelectorAll('.ev-node.ev-dim').length, 0);
        });

        it('closes a panel that was already open when the drag starts', async () => {
            hover('mouseenter');
            await wait(250);
            assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 1);

            press();
            assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 0);
        });

        it('hovers normally again once the button is released', async () => {
            press();
            release();
            hover('mouseenter');
            await wait(250);
            assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 1);
        });

        // The drag layer spans the toolbar strip too. The layering keeps a press off it, but if
        // anything ever puts the layer back on top, a mis-hit on a checkbox must not pan the view.
        it('starts no drag from a press inside the toolbar strip', () => {
            const toolbar = document.querySelector('.toolbar-outer') as HTMLElement;
            const previous = toolbar.getBoundingClientRect;
            toolbar.getBoundingClientRect = () => ({
                left: 0, top: 0, right: 800, bottom: 40, width: 800, height: 40, x: 0, y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
            try {
                document.getElementById('dragger')!.dispatchEvent(
                    new (window as any).MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 20 }));
                assert.ok(!document.body.classList.contains('panning'), 'a toolbar press is not a drag');

                document.getElementById('dragger')!.dispatchEvent(
                    new (window as any).MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 200 }));
                assert.ok(document.body.classList.contains('panning'), 'a press below the strip still drags');
            } finally {
                toolbar.getBoundingClientRect = previous;
            }
        });
    });

    it('shows the event picture on hover only while the toggle is on', () => {
        const pictured: EventGraphPayload = payload(
            [eventNode('pictured:0', {
                picture: { styleKey: 'event-picture-GFX_test', width: 400 },
            } as Partial<EventGraphEventNode>)],
            [],
            ['pictured:0'],
        );
        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: pictured } },
        }));

        assert.ok(content().querySelector('.event-picture-host'), 'the pictured event must be a hover host');
        const popups = () => document.querySelectorAll('.event-hover-picture').length;
        // Each toggle rebuilds the cards, so the host has to be looked up again every time -- the
        // element captured before a toggle is a detached copy that still carries its old listener.
        const send = (type: string) => content()
            .querySelector('.event-picture-host')!
            .dispatchEvent(new (window as any).MouseEvent(type));

        setToggle('show-picture', false);
        send('mouseenter');
        assert.strictEqual(popups(), 0, 'no picture may appear while the toggle is off');

        setToggle('show-picture', true);
        send('mouseenter');
        assert.strictEqual(popups(), 1, 'the picture must appear while the toggle is on');
        // Placed by hand on <body>, under a toolbar strip that is drawn over it.
        const picture = document.querySelector('.event-hover-picture') as HTMLElement;
        assert.ok(parseFloat(picture.style.top) >= 52, `picture placed at ${picture.style.top}`);
        send('mouseleave');
        assert.strictEqual(popups(), 0, 'the picture must go away again');

        window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: integrationPayload } },
        }));
    });

    it('re-renders from a pushed update instead of reloading', () => {
        const next: EventGraphPayload = payload([eventNode('only:0', { eventId: 'replaced.1' })], [], ['only:0']);
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

    // A nested suite runs after every test of its parent, so each of these puts the chain and the
    // toggles back rather than assuming what the last one left behind.
    describe('the search box', () => {
        const searchbox = () => document.getElementById('ev-searchbox') as HTMLInputElement;
        const counter = () => document.getElementById('ev-search-count')!;
        const hits = () => content().querySelectorAll('.ev-card.ev-hit');
        const current = () => content().querySelectorAll('.ev-card.ev-hit-current');

        function type(text: string): void {
            searchbox().value = text;
            searchbox().dispatchEvent(new (window as any).Event('keyup'));
        }

        function enter(shiftKey = false): void {
            searchbox().dispatchEvent(new (window as any).KeyboardEvent('keypress', { key: 'Enter', shiftKey }));
        }

        const restore = () => window.dispatchEvent(new (window as any).MessageEvent('message', {
            data: { type: 'updateBody', styleCss: '', data: { eventGraph: integrationPayload } },
        }));

        before(restore);
        afterEach(() => type(''));

        it('highlights the matching card without moving anything', () => {
            const before = content().querySelectorAll('.ev-node').length;
            type('arab_spring.1');
            assert.strictEqual(hits().length, 1);
            assert.ok(hits()[0]!.textContent!.includes('arab_spring.1'));
            assert.strictEqual(content().querySelectorAll('.ev-node').length, before,
                'search highlights, it does not filter');
        });

        it('matches the localised title as well as the id', () => {
            type('mass protests');
            assert.strictEqual(hits().length, 1);
            assert.ok(hits()[0]!.textContent!.includes('arab_spring.0'));
        });

        it('never matches an option card', () => {
            type('mitigate this crisis');
            assert.strictEqual(hits().length, 0);
        });

        it('counts the matches, and says so when there are none', () => {
            type('arab_spring');
            // No hit is picked until Enter, so the left half is a dash rather than a number.
            assert.strictEqual(counter().textContent, '-/3');
            type('no_such_event');
            assert.strictEqual(counter().textContent, 'no matches');
            type('');
            assert.strictEqual(counter().textContent, '');
        });

        it('walks the matches with Enter, one at a time, and back with Shift+Enter', () => {
            type('arab_spring');
            assert.strictEqual(current().length, 0, 'typing highlights, Enter is what jumps');

            enter();
            assert.strictEqual(current().length, 1);
            const first = current()[0]!.textContent;
            assert.ok(counter().textContent!.startsWith('1/'), counter().textContent!);

            enter();
            assert.strictEqual(current().length, 1);
            assert.notStrictEqual(current()[0]!.textContent, first);

            enter(true);
            assert.strictEqual(current()[0]!.textContent, first);
        });

        it('wraps around at the end', () => {
            type('arab_spring');
            enter(true);
            assert.ok(counter().textContent!.startsWith('3/'), counter().textContent!);
            enter();
            assert.ok(counter().textContent!.startsWith('1/'), counter().textContent!);
        });

        it('keeps the highlight across a toggle change and an in-place update', () => {
            type('arab_spring.1');
            setToggle('show-localisation', false);
            assert.strictEqual(hits().length, 1, 'the cards were rebuilt, the query was not');
            setToggle('show-localisation', true);

            restore();
            assert.strictEqual(hits().length, 1);
        });

        it('counts only the matches a filter left on the canvas', () => {
            type('arab_spring');
            assert.ok(counter().textContent!.endsWith('/3'), counter().textContent!);
            setFilters(['hidden']);
            assert.ok(counter().textContent!.endsWith('/1'), counter().textContent!);
            setFilters([]);
        });

        // The two states live on different elements on purpose, so neither needs !important.
        it('leaves the highlight on the card while hover isolation dims the wrapper', () => {
            type('arab_spring.3');
            const wrapper = content().querySelector('.ev-card-option')!.parentElement!;
            wrapper.dispatchEvent(new (window as any).MouseEvent('mouseenter'));
            assert.ok(content().querySelectorAll('.ev-node.ev-dim').length > 0, 'something must be dimmed');
            assert.strictEqual(hits().length, 1, 'the highlight survives the dimming');
            wrapper.dispatchEvent(new (window as any).MouseEvent('mouseleave'));
        });
    });

    // An event whose chain continues from `after`, the way league_collapse_events.11 does.
    describe('a call fired from the after block', () => {
        const afterPayload = {
            ...payload(
                [eventNode('a:0', { effectsRef: 0, afterEffectsRef: 1 } as Partial<EventGraphEventNode>),
                    eventNode('b:1')],
                [edge('a:0', 'b:1', { source: 'after', scope: 'ANQ', hours: 5 })],
                ['a:0'],
            ),
            effectBlocks: [
                [{ kind: 'line', scopeName: '', content: 'set_country_flag = war' }],
                [{ kind: 'line', scopeName: '', content: 'swap_ideas = { }' }],
            ] as EffectTreeNode[][],
        };

        afterEach(() => {
            push(integrationPayload);
        });

        it('draws it as an arrow the event fires itself, labelled after', () => {
            push(afterPayload);
            assert.strictEqual(content().querySelectorAll('path.ev-edge-immediate').length, 1);
            const chip = content().querySelector('.ev-chip')!;
            assert.strictEqual(chip.textContent, 'ANQ · 5 hour(s) · after');
        });

        it('shows what the after block does under its own heading', async () => {
            push(afterPayload);
            const wrapper = content().querySelector('.ev-card-event')!.parentElement!;
            wrapper.dispatchEvent(new (window as any).MouseEvent('mouseenter'));
            await wait(250);

            const panel = document.querySelector('.ev-effects-tip')!;
            assert.ok(panel, 'the event card must have a panel');
            assert.strictEqual(document.querySelectorAll('.ev-effects-tip').length, 1);
            const heads = Array.from(panel.querySelectorAll('.ev-cond-head')).map(h => h.textContent);
            assert.deepStrictEqual(heads, ['Immediate effects', 'After effects']);
            assert.ok(panel.textContent!.includes('swap_ideas = { }'), panel.textContent!);

            wrapper.dispatchEvent(new (window as any).MouseEvent('mouseleave'));
        });
    });

    describe('the filter list', () => {
        // One chain (e1 -> a -> e2) plus a standalone event that calls nothing.
        const mixed = payload(
            [eventNode('e1:0'), optionNode('a:1'), eventNode('e2:2'), eventNode('alone:3')],
            [edge('e1:0', 'a:1', { structural: true }), edge('a:1', 'e2:2')],
            ['e1:0', 'alone:3'],
        );

        afterEach(() => {
            setFilters([]);
            push(integrationPayload);
        });

        it('starts with nothing selected, so nothing is hidden when the preview is first opened', () => {
            assert.strictEqual(filterValue(), '(All events)');
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
        });

        it('removes the unlinked event and puts it back', () => {
            push(mixed);
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);

            setFilters(['chains']);
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 3);
            assert.ok(!content().textContent!.includes('alone:3'));

            setFilters([]);
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 4);
        });

        it('shows more when a second filter is selected, not less', () => {
            push(mixed);
            setFilters(['major']);
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 0);
            setFilters(['major', 'chains']);
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 3);
        });

        it('says on the card and on the arrow which events it stepped over', () => {
            push(payload(
                [
                    eventNode('a:0', { major: true }), optionNode('ao:1'),
                    eventNode('b:2'), optionNode('bo:3'), eventNode('c:4', { major: true }),
                ],
                [
                    edge('a:0', 'ao:1', { structural: true }), edge('ao:1', 'b:2'),
                    edge('b:2', 'bo:3', { structural: true }), edge('bo:3', 'c:4'),
                ],
                ['a:0'],
            ));
            setFilters(['major']);

            assert.strictEqual(content().querySelectorAll('path.ev-edge-bridged').length, 1);
            const chip = content().querySelector('.ev-chip-bridged');
            assert.ok(chip, 'the bridged arrow must be labelled');
            assert.ok(chip!.textContent!.includes('1 filtered out'), chip!.textContent!);

            const badge = content().querySelector('.ev-badge-skipped');
            assert.ok(badge, 'the card the arrow leaves must say so too');
            assert.ok(badge!.getAttribute('title')!.includes('b:2'), badge!.getAttribute('title')!);
        });
    });

    describe('the toolbar', () => {
        const widgetOf = (id: string) => toggle(id).nextElementSibling as HTMLElement;
        const noFlags = {
            hasChains: false, hasEffects: false, hasHidden: false, hasMajor: false, hasNews: false,
            hasMtth: false, hasTriggered: false, hasLocalisation: false, hasPicture: false,
        };

        afterEach(() => {
            setFilters([]);
            push(integrationPayload);
        });

        it('offers every control the file can use', () => {
            for (const id of ['show-localisation', 'show-effects']) {
                assert.notStrictEqual(widgetOf(id).style.display, 'none', `${id} must be offered`);
            }
            // Nothing in this chain has a picture, so that one control is not offered.
            assert.strictEqual(widgetOf('show-picture').style.display, 'none');
        });

        it('offers only the filters some event in the file matches', () => {
            // Every event in this chain is triggered only, so filtering on a mean time cannot help.
            assert.deepStrictEqual(offeredFilters(), ['triggered', 'news', 'hidden', 'major', 'chains']);
        });

        // The filter list is where the shapes on the cards are learned, so every entry that has one
        // carries it. Event chains has no shape on any card and gets an empty cell, which still holds
        // the column open so the six labels start at the same place.
        it('puts each filter behind the glyph its events wear on the canvas', () => {
            const select = document.getElementById('ev-filters')!;
            select.dispatchEvent(new (window as any).MouseEvent('mousedown'));
            const items = Array.from(document.querySelectorAll('ul.select-dropdown li'));
            try {
                assert.deepStrictEqual(
                    items.map(item => item.querySelector('.checkbox-glyph')!.className),
                    [
                        'checkbox-glyph ev-marker ev-marker-triggered',
                        'checkbox-glyph ev-marker ev-marker-news',
                        'checkbox-glyph ev-marker ev-marker-hidden',
                        'checkbox-glyph ev-marker ev-marker-major',
                        'checkbox-glyph',
                    ],
                );
            } finally {
                window.dispatchEvent(new (window as any).KeyboardEvent('keydown', { code: 'Escape' }));
            }
        });

        it('hides a toggle that cannot change anything for this file', () => {
            push({ ...payload([eventNode('lonely:0')], [], ['lonely:0']), toolbarFlags: noFlags });
            for (const id of ['show-localisation', 'show-picture', 'show-effects']) {
                assert.strictEqual(widgetOf(id).style.display, 'none', `${id} must be hidden`);
            }
            // The three condition toggles are never gated -- they would flip on every typed trigger.
            assert.notStrictEqual(widgetOf('show-option-triggers').style.display, 'none');
        });

        it('takes the whole filter list away when there is nothing left to filter on', () => {
            push({ ...payload([eventNode('lonely:0')], [], ['lonely:0']), toolbarFlags: noFlags });
            assert.strictEqual(document.getElementById('ev-filter-container')!.style.display, 'none');
            assert.deepStrictEqual(offeredFilters(), []);
        });

        it('forces a filter it cannot offer off, so the canvas cannot be emptied with no way back', () => {
            setFilters(['hidden']);
            push({ ...payload([eventNode('lonely:0')], [], ['lonely:0']), toolbarFlags: noFlags });
            assert.strictEqual(content().querySelectorAll('.ev-node').length, 1, 'the event must still be drawn');
            assert.strictEqual(filterValue(), '(All events)');
        });

        it('gives a filter that comes back the position its reader last put it in', () => {
            setFilters(['hidden']);
            push({ ...payload([eventNode('lonely:0')], [], ['lonely:0']), toolbarFlags: noFlags });
            assert.strictEqual(filterValue(), '(All events)', 'forced off while unusable');

            push(integrationPayload);
            assert.strictEqual(filterValue(), 'Hidden',
                'the forced value must not survive the filter coming back');
        });

        it('shows every control again for a payload that carries no flags at all', () => {
            window.dispatchEvent(new (window as any).MessageEvent('message', {
                data: { type: 'updateBody', data: { eventGraph: { roots: [], nodes: [], edges: [], conditionExprs: [] } } },
            }));
            assert.notStrictEqual(widgetOf('show-localisation').style.display, 'none');
            assert.deepStrictEqual(offeredFilters(), ['mtth', 'triggered', 'news', 'hidden', 'major', 'chains']);
        });
    });
});
