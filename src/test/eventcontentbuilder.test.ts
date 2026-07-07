import * as assert from 'assert';
import * as vscode from 'vscode';
import { renderEventFile } from '../previewdef/event/contentbuilder';
import { serializeUpdate, LoaderRenderResult } from '../previewdef/loaderpreview';

// renderEventFile returns the in-place update parts { html, update } on success and a plain html string
// on the error branch. These drive it against a stub loader (a single root event in one namespace) to
// assert the return shape and that serializeUpdate is stable for identical input -- the property the
// LoaderPreview skip relies on -- and differs when the input changed.

const webview = { asWebviewUri: (u: unknown) => u, cspSource: '' } as unknown as vscode.Webview;
const uri = vscode.Uri.file('/tmp/events/test.txt');

function loaderFor(ids: string | string[]): any {
    const events = (Array.isArray(ids) ? ids : [ids]).map(id => ({
        type: 'country',
        id,
        title: `${id}.t`,
        namespace: 'test',
        immediate: { childEvents: [], token: undefined },
        options: [],
        token: undefined,
        major: false,
        hidden: false,
        isTriggeredOnly: false,
        meanTimeToHappenBase: 0,
        fire_only_once: false,
        file: 'test.txt',
    }));
    return {
        load: async () => ({
            result: {
                events: { eventItemsByNamespace: { test: events } },
                mainNamespaces: ['test'],
                gfxFiles: [],
            },
        }),
    };
}

// The class list on an element carrying id="<id>", read out of the rendered html.
function classOf(html: string, id: string): string {
    const m = new RegExp(`id="${id}"[^>]*?class="([^"]*)"`).exec(html);
    assert.ok(m, `expected an element with id="${id}"`);
    return m![1].trim();
}

describe('previewdef/event renderEventFile in-place update', () => {
    it('returns { html, update } carrying contentHtml', async () => {
        const rendered = await renderEventFile(loaderFor('test.1'), uri, webview) as LoaderRenderResult;
        assert.strictEqual(typeof rendered, 'object');
        assert.strictEqual(typeof rendered.html, 'string');
        assert.ok(rendered.update);
        assert.strictEqual(typeof rendered.update.styleCss, 'string');
        const data = rendered.update.data as { contentHtml: string };
        assert.strictEqual(typeof data.contentHtml, 'string');
    });

    it('serializeUpdate is stable for identical input, even though the full html nonces differ', async () => {
        const a = await renderEventFile(loaderFor('test.1'), uri, webview) as LoaderRenderResult;
        const b = await renderEventFile(loaderFor('test.1'), uri, webview) as LoaderRenderResult;
        // The full html carries fresh CSP nonces per render so it never hashes equal; the update parts
        // must be byte-identical so a no-op edit skips.
        assert.notStrictEqual(a.html, b.html);
        assert.strictEqual(serializeUpdate(a.update!), serializeUpdate(b.update!));
    });

    it('serializeUpdate differs when the input changed', async () => {
        const a = await renderEventFile(loaderFor('test.1'), uri, webview) as LoaderRenderResult;
        const c = await renderEventFile(loaderFor('test.2'), uri, webview) as LoaderRenderResult;
        assert.notStrictEqual(serializeUpdate(a.update!), serializeUpdate(c.update!));
    });

    it('keeps the shell class names stable across renders so an in-place update never strands them', async () => {
        // Content oneTimeStyles are allocated per node before the shell styles, so adding an event
        // would shift a suffixed shell class. The shell must use suffix-free style() names instead, or
        // the pushed styleCss would carry no rule for the class still on the live #dragger/#eventtreecontent.
        const one = await renderEventFile(loaderFor('test.1'), uri, webview) as LoaderRenderResult;
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

    it('returns a plain string for the error page when the loader throws', async () => {
        const throwing: any = { load: async () => { throw new Error('boom'); } };
        const rendered = await renderEventFile(throwing, uri, webview);
        assert.strictEqual(typeof rendered, 'string');
    });
});
