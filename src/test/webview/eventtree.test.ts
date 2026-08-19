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

// eventtree.ts reads window.eventGraph at module scope, so it has to exist before the import runs.
(global as any).window.eventGraph = { roots: [], nodes: [], edges: [], conditionExprs: [] };

const { conditionToDom, conditionToLabel, visibleGraph, layoutGraph } =
    require('../../../webviewsrc/eventtree') as typeof import('../../../webviewsrc/eventtree');

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
