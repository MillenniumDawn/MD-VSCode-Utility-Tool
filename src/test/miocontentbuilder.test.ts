import * as assert from 'assert';
import * as vscode from 'vscode';
import { renderMioFile } from '../previewdef/mio/contentbuilder';
import { LoaderRenderResult } from '../previewdef/loaderpreview';

// The mio preview's updateBody replaces the whole #mio-server-styles sheet while the shell markup
// (#dragger, #miopreviewcontent, frame, toolbar) persists. These drive renderMioFile against a stub
// loader and assert the shell classes are suffix-free stable names present in every render's
// styleCss, so a content-size change (here: tree headers) can never strand the live shell.

const webview = { asWebviewUri: (u: unknown) => u, cspSource: '' } as unknown as vscode.Webview;
const uri = vscode.Uri.file('/tmp/common/military_industrial_organization/organizations/test.txt');

function loaderFor(headerCount: number): any {
    const textHeaders = Array.from({ length: headerCount }, (_, i) => ({ text: `header_${i}`, x: i }));
    return {
        file: 'common/military_industrial_organization/organizations/test.txt',
        load: async () => ({
            result: {
                mios: [{ id: 'mio_test', traits: {}, textHeaders }],
                gfxFiles: [],
                frame: undefined,
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

describe('previewdef/mio renderMioFile shell class stability', () => {
    it('returns { html, update } with styleCss and data', async () => {
        const rendered = await renderMioFile(loaderFor(1), uri, webview) as LoaderRenderResult;
        assert.strictEqual(typeof rendered.html, 'string');
        assert.ok(rendered.update);
        assert.strictEqual(typeof rendered.update.styleCss, 'string');
        assert.ok(rendered.update.data);
    });

    it('keeps the shell class names stable across renders so an in-place update never strands them', async () => {
        // Header oneTimeStyles are per-header, so adding one would shift a suffixed shell class.
        const one = await renderMioFile(loaderFor(1), uri, webview) as LoaderRenderResult;
        const two = await renderMioFile(loaderFor(2), uri, webview) as LoaderRenderResult;

        const dragger = classOf(one.html, 'dragger');
        const content = classOf(one.html, 'miopreviewcontent');
        assert.strictEqual(dragger, 'st-dragger');
        assert.strictEqual(content, 'st-miopreviewcontent');
        assert.strictEqual(classOf(two.html, 'dragger'), dragger);
        assert.strictEqual(classOf(two.html, 'miopreviewcontent'), content);

        for (const rendered of [one, two]) {
            const styleCss = rendered.update!.styleCss!;
            assert.ok(styleCss.includes(`.${dragger} {`));
            assert.ok(styleCss.includes(`.${content} {`));
        }
    });
});
