import * as assert from 'assert';
import * as vscode from 'vscode';
import { renderEventFile } from '../previewdef/event/contentbuilder';
import { serializeUpdate, LoaderRenderResult } from '../previewdef/loaderpreview';
import { EventGraphEventNode, EventGraphOptionNode, EventGraphPayload } from '../previewdef/event/payload';
import { conditionToString } from '../hoiformat/condition';
import { contextContainer } from '../context';

// renderEventFile returns the in-place update parts { html, update } on success and a plain html
// string on the error branch. The graph is laid out and rendered in the webview, so the update
// payload carries data rather than markup. These drive it against a stub loader to assert the
// return shape, that serializeUpdate is stable for identical input -- the property the
// LoaderPreview skip relies on -- and that the triggers and per-call conditions reach the payload.

const webview = { asWebviewUri: (u: unknown) => u, cspSource: '' } as unknown as vscode.Webview;
const uri = vscode.Uri.file('/tmp/events/test.txt');

interface StubOption {
    name?: string;
    trigger?: unknown;
    childEvents?: unknown[];
}

interface StubEvent {
    id: string;
    options?: StubOption[];
    immediate?: StubOption;
    trigger?: unknown;
    hidden?: boolean;
}

function makeOption(option: StubOption | undefined): any {
    return {
        name: option?.name,
        trigger: option?.trigger ?? true,
        childEvents: option?.childEvents ?? [],
        token: undefined,
    };
}

function loaderFor(events: (string | StubEvent)[]): any {
    const items = events.map(entry => {
        const event: StubEvent = typeof entry === 'string' ? { id: entry } : entry;
        return {
            type: 'country',
            id: event.id,
            title: `${event.id}.t`,
            namespace: 'test',
            immediate: makeOption(event.immediate),
            options: (event.options ?? []).map(makeOption),
            token: undefined,
            major: false,
            hidden: !!event.hidden,
            isTriggeredOnly: false,
            meanTimeToHappenBase: 0,
            fire_only_once: false,
            file: 'test.txt',
            trigger: event.trigger ?? true,
        };
    });
    return {
        load: async () => ({
            result: {
                events: { eventItemsByNamespace: { test: items }, conditionExprs: [] },
                mainNamespaces: ['test'],
                gfxFiles: [],
            },
        }),
    };
}

function payloadOf(rendered: LoaderRenderResult): EventGraphPayload {
    return (rendered.update!.data as { eventGraph: EventGraphPayload }).eventGraph;
}

// The class list on an element carrying id="<id>", read out of the rendered html.
function classOf(html: string, id: string): string {
    const m = new RegExp(`id="${id}"[^>]*?class="([^"]*)"`).exec(html);
    assert.ok(m, `expected an element with id="${id}"`);
    return m![1].trim();
}

describe('previewdef/event renderEventFile in-place update', () => {
    it('returns { html, update } carrying the event graph payload', async () => {
        const rendered = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        assert.strictEqual(typeof rendered, 'object');
        assert.strictEqual(typeof rendered.html, 'string');
        assert.ok(rendered.update);
        assert.strictEqual(typeof rendered.update.styleCss, 'string');

        const graph = payloadOf(rendered);
        assert.strictEqual(graph.roots.length, 1);
        assert.strictEqual(graph.nodes.length, 1);
        const node = graph.nodes[0] as EventGraphEventNode;
        assert.strictEqual(node.kind, 'event');
        assert.strictEqual(node.eventId, 'test.1');
    });

    it('serializeUpdate is stable for identical input, even though the full html nonces differ', async () => {
        const a = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        const b = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        // The full html carries fresh CSP nonces per render so it never hashes equal; the update parts
        // must be byte-identical so a no-op edit skips.
        assert.notStrictEqual(a.html, b.html);
        assert.strictEqual(serializeUpdate(a.update!), serializeUpdate(b.update!));
    });

    it('serializeUpdate differs when the input changed', async () => {
        const a = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        const c = await renderEventFile(loaderFor(['test.2']), uri, webview) as LoaderRenderResult;
        assert.notStrictEqual(serializeUpdate(a.update!), serializeUpdate(c.update!));
    });

    it('keeps the shell class names stable across renders so an in-place update never strands them', async () => {
        const one = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        const two = await renderEventFile(loaderFor(['test.1', 'test.2']), uri, webview) as LoaderRenderResult;

        const draggerOne = classOf(one.html, 'dragger');
        const contentOne = classOf(one.html, 'eventtreecontent');
        assert.strictEqual(draggerOne, 'st-dragger');
        assert.strictEqual(contentOne, 'st-eventtreecontent');
        assert.strictEqual(classOf(two.html, 'dragger'), draggerOne);
        assert.strictEqual(classOf(two.html, 'eventtreecontent'), contentOne);

        const styleCss = two.update!.styleCss!;
        assert.ok(styleCss.includes(`.${draggerOne} {`));
        assert.ok(styleCss.includes(`.${contentOne} {`));
    });

    it('renders the five toggles into the toolbar', async () => {
        const rendered = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        for (const id of ['show-localisation', 'show-triggers', 'show-event-conditions', 'show-hidden',
            'show-picture']) {
            assert.ok(rendered.html.includes(`id="${id}"`), `expected a toggle with id="${id}"`);
        }
        assert.ok(rendered.html.includes('class="toolbar-outer'));
    });

    it('loads common.css so the toolbar and its checkboxes are styled', async () => {
        // html() only resolves a stylesheet name to a URI when an extension context is installed,
        // so give it one -- otherwise every <link href> is empty and the assertion is vacuous.
        const previous = contextContainer.current;
        contextContainer.current = { extensionUri: vscode.Uri.file('/ext') } as any;
        try {
            const rendered = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
            assert.ok(rendered.html.includes('common.css'), 'the shared widget stylesheet must be loaded');
            assert.ok(rendered.html.includes('eventtree.css'), 'the workflow stylesheet must be loaded');
            assert.ok(rendered.html.includes('codicon.css'));
        } finally {
            contextContainer.current = previous;
        }
    });

    it('exposes the graph to the webview as window.eventGraph', async () => {
        const rendered = await renderEventFile(loaderFor(['test.1']), uri, webview) as LoaderRenderResult;
        assert.ok(rendered.html.includes('window.eventGraph = '));
    });

    it('escapes a payload string that would otherwise end the inline script', async () => {
        // The payload carries text straight from the workspace. The HTML parser ends the script at
        // the first `</script`, whatever the JavaScript around it means.
        const rendered = await renderEventFile(
            loaderFor(['test.</script><img src=x>']),
            uri,
            webview,
        ) as LoaderRenderResult;

        const script = /window\.eventGraph = (.*?);<\/script>/.exec(rendered.html);
        assert.ok(script, 'expected the payload script');
        assert.ok(!script![1]!.includes('</script'), script![1]!);
        const parsed = JSON.parse(script![1]!) as EventGraphPayload;
        const ids = parsed.nodes.filter(n => n.kind === 'event').map(n => (n as EventGraphEventNode).eventId);
        assert.ok(ids.includes('test.</script><img src=x>'), ids.join(','));
    });

    it('carries the option trigger and the per-call condition into the payload', async () => {
        const optionTrigger = { scopeName: '', nodeContent: 'tag = FROM' };
        const callCondition = { scopeName: '', nodeContent: 'is_subject = yes' };
        const rendered = await renderEventFile(loaderFor([
            {
                id: 'test.1',
                trigger: { scopeName: '', nodeContent: 'has_country_flag = gate' },
                options: [{
                    name: 'test.1.a',
                    trigger: optionTrigger,
                    childEvents: [{
                        scopeName: 'OVERLORD',
                        eventName: 'test.2',
                        days: 1,
                        hours: 0,
                        randomDays: 0,
                        randomHours: 0,
                        condition: callCondition,
                    }],
                }],
            },
            'test.2',
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);

        const event = graph.nodes.find(n => n.kind === 'event' && n.eventId === 'test.1') as EventGraphEventNode;
        assert.ok(event);
        assert.strictEqual(conditionToString(event.trigger), 'has_country_flag = gate');

        const option = graph.nodes.find(n => n.kind === 'option') as EventGraphOptionNode;
        assert.ok(option, 'expected an option node');
        assert.strictEqual(conditionToString(option.trigger), 'tag = FROM');

        // The event -> option link is structural; the option -> event link is the guarded call.
        const structural = graph.edges.filter(e => e.structural);
        const calls = graph.edges.filter(e => !e.structural);
        assert.strictEqual(structural.length, 1);
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0]!.scope, 'OVERLORD');
        assert.strictEqual(calls[0]!.days, 1);
        assert.strictEqual(conditionToString(calls[0]!.condition), 'is_subject = yes');
    });

    it('marks an immediate call so the hidden toggle can filter it', async () => {
        const rendered = await renderEventFile(loaderFor([
            {
                id: 'test.1',
                hidden: true,
                immediate: {
                    childEvents: [{
                        scopeName: '{event_target}',
                        eventName: 'test.2',
                        days: 30,
                        hours: 0,
                        randomDays: 0,
                        randomHours: 0,
                        condition: true,
                    }],
                },
            },
            'test.2',
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const call = graph.edges.find(e => !e.structural);
        assert.ok(call);
        assert.strictEqual(call!.immediate, true);
        assert.strictEqual(call!.days, 30);

        const event = graph.nodes.find(n => n.kind === 'event' && n.eventId === 'test.1') as EventGraphEventNode;
        assert.strictEqual(event.hidden, true);
    });

    it('reports a call to an undefined event id as an unresolved node', async () => {
        const rendered = await renderEventFile(loaderFor([
            {
                id: 'test.1',
                options: [{
                    name: 'test.1.a',
                    childEvents: [{
                        scopeName: '{event_target}',
                        eventName: 'test.missing',
                        days: 0,
                        hours: 0,
                        randomDays: 0,
                        randomHours: 0,
                        condition: true,
                    }],
                }],
            },
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const unresolved = graph.nodes.find(n => n.kind === 'unresolved');
        assert.ok(unresolved, 'expected an unresolved node');
        assert.strictEqual((unresolved as { eventId: string }).eventId, 'test.missing');
    });

    it('emits one node per event reached twice under the same scope, and links both callers to it', async () => {
        // Without this the payload is a tree and every extra route into an event duplicates its
        // whole subtree; Millennium Dawn's events/United States.txt reached 94,951 nodes that way.
        const call = (eventName: string, scopeName: string) => ({
            scopeName, eventName, days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        const rendered = await renderEventFile(loaderFor([
            {
                id: 'test.1',
                options: [
                    { name: 'test.1.a', childEvents: [call('test.shared', '{event_target}')] },
                    { name: 'test.1.b', childEvents: [call('test.shared', '{event_target}')] },
                ],
            },
            { id: 'test.shared', options: [{ name: 'test.shared.a' }] },
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const shared = graph.nodes.filter(n => n.kind === 'event' && n.eventId === 'test.shared');
        assert.strictEqual(shared.length, 1, 'the shared event must be emitted once');

        // Its option is emitted once too, rather than once per route in.
        assert.strictEqual(graph.nodes.filter(n => n.kind === 'option' && n.name.key === 'test.shared.a').length, 1);

        // Both callers still link to it, so the diagram shows the join instead of hiding it.
        const intoShared = graph.edges.filter(e => e.to === shared[0]!.id && !e.structural);
        assert.strictEqual(intoShared.length, 2);
    });

    it('keeps the same event under two different scopes as two nodes', async () => {
        const call = (eventName: string, scopeName: string) => ({
            scopeName, eventName, days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        const rendered = await renderEventFile(loaderFor([
            {
                id: 'test.1',
                options: [{
                    name: 'test.1.a',
                    childEvents: [call('test.shared', 'OVERLORD'), call('test.shared', 'FROM')],
                }],
            },
            'test.shared',
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const shared = graph.nodes.filter(n => n.kind === 'event' && n.eventId === 'test.shared');
        assert.strictEqual(shared.length, 2, 'a different scope is a different box');
        assert.notStrictEqual((shared[0] as EventGraphEventNode).scope, (shared[1] as EventGraphEventNode).scope);
    });

    // test.a is entered at ALPHA and test.b at BETA, and both call test.shared at SHARED -- so the
    // two routes converge on one scope but with different callers behind them.
    const joinChain = (tailOfShared: unknown[]) => {
        const call = (eventName: string, scopeName: string) => ({
            scopeName, eventName, days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        return [
            {
                id: 'test.1',
                options: [{
                    name: 'test.1.a',
                    childEvents: [call('test.a', 'ALPHA'), call('test.b', 'BETA')],
                }],
            },
            { id: 'test.a', options: [{ name: 'test.a.a', childEvents: [call('test.shared', 'SHARED')] }] },
            { id: 'test.b', options: [{ name: 'test.b.a', childEvents: [call('test.shared', 'SHARED')] }] },
            { id: 'test.shared', options: [{ name: 'test.shared.a', childEvents: tailOfShared }] },
            'test.last',
        ];
    };

    it('keeps a join apart when the callers differ and a later call reads FROM', async () => {
        // FROM resolves to whichever event fired this one, so merging the two arrivals at
        // test.shared would give the route through test.b the scope of the route through test.a.
        const rendered = await renderEventFile(loaderFor(joinChain([{
            scopeName: 'FROM', eventName: 'test.last',
            days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        }])), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const last = graph.nodes
            .filter(n => n.kind === 'event' && n.eventId === 'test.last')
            .map(n => (n as EventGraphEventNode).scope)
            .sort();
        assert.deepStrictEqual(last, ['ALPHA', 'BETA']);
    });

    it('still collapses that join when nothing downstream reads FROM', async () => {
        // The counterpart: with no FROM call anywhere in the file the caller history can never be
        // observed, so the two arrivals are one box and the payload stays small.
        const rendered = await renderEventFile(
            loaderFor(joinChain([])),
            uri,
            webview,
        ) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        const shared = graph.nodes.filter(n => n.kind === 'event' && n.eventId === 'test.shared');
        assert.strictEqual(shared.length, 1, 'the shared event must still be emitted once');
        assert.strictEqual(
            graph.edges.filter(e => e.to === shared[0]!.id && !e.structural).length,
            2,
            'both callers must still link to it',
        );
    });

    it('renders a group of events that only call each other', async () => {
        // ENG_inner_circle_charles.01 and .02 in Millennium Dawn are two hidden events whose
        // immediate blocks fire each other. Neither is parentless, so root selection found no way
        // in and the preview was blank for the whole group.
        const call = (eventName: string) => ({
            scopeName: '{event_target}', eventName, days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        const rendered = await renderEventFile(loaderFor([
            { id: 'test.1', hidden: true, immediate: { childEvents: [call('test.2')] } },
            { id: 'test.2', hidden: true, immediate: { childEvents: [call('test.1')] } },
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        assert.ok(graph.roots.length > 0, 'the group must get an entry point');
        const ids = graph.nodes.filter(n => n.kind === 'event').map(n => (n as EventGraphEventNode).eventId);
        assert.ok(ids.includes('test.1'), ids.join(','));
        assert.ok(ids.includes('test.2'), ids.join(','));
    });

    it('does not promote an event that a real root already reaches', async () => {
        const call = (eventName: string) => ({
            scopeName: '{event_target}', eventName, days: 0, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        const rendered = await renderEventFile(loaderFor([
            { id: 'test.0', options: [{ name: 'test.0.a', childEvents: [call('test.1')] }] },
            { id: 'test.1' },
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        assert.strictEqual(graph.roots.length, 1, 'test.1 hangs off test.0 and must not also be a root');
    });

    it('terminates on a cycle instead of recursing forever', async () => {
        const call = (eventName: string) => ({
            scopeName: '{event_target}', eventName, days: 1, hours: 0, randomDays: 0, randomHours: 0, condition: true,
        });
        // test.0 is the root; test.1 and test.2 call each other. Note that a cycle with no way in
        // renders nothing at all, because eventsToGraph only treats a parentless event as a root.
        const rendered = await renderEventFile(loaderFor([
            { id: 'test.0', options: [{ name: 'test.0.a', childEvents: [call('test.1')] }] },
            { id: 'test.1', options: [{ name: 'test.1.a', childEvents: [call('test.2')] }] },
            { id: 'test.2', options: [{ name: 'test.2.a', childEvents: [call('test.1')] }] },
        ]), uri, webview) as LoaderRenderResult;

        const graph = payloadOf(rendered);
        assert.ok(graph.nodes.length > 0, 'the chain must render');
        assert.ok(graph.nodes.length < 20, `the cycle must stay bounded, got ${graph.nodes.length} nodes`);
        assert.ok(graph.nodes.some(n => n.kind === 'event' && n.eventId === 'test.2'));
    });

    it('returns a plain string for the error page when the loader throws', async () => {
        const throwing: any = { load: async () => { throw new Error('boom'); } };
        const rendered = await renderEventFile(throwing, uri, webview);
        assert.strictEqual(typeof rendered, 'string');
    });
});
