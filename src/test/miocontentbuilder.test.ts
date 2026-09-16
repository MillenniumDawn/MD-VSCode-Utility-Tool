import * as assert from 'assert';
import * as vscode from 'vscode';
import { renderMioFile } from '../previewdef/mio/contentbuilder';
import { LoaderRenderResult } from '../previewdef/loaderpreview';
import { getMiosFromFile } from '../previewdef/mio/schema';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { stubLocalisation, restoreLocalisation } from './_localisation_stub';

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

// A loader over a real parsed file, so a quoted trait token reaches the renderer the way the mod
// writes it.
function loaderForFile(content: string): any {
    const file = 'common/military_industrial_organization/organizations/test.txt';
    return {
        file,
        load: async () => ({
            result: { mios: getMiosFromFile(parseHoi4File(content), [], file), gfxFiles: [], frame: undefined },
        }),
    };
}

// The rendered trait cards of the one organization in the file.
function traitHtmlOf(rendered: LoaderRenderResult): string {
    const renderedTrait = (rendered.update!.data as { renderedTrait: Record<string, Record<string, string>> }).renderedTrait;
    return Object.values(renderedTrait).flatMap(traits => Object.values(traits)).join('\n');
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

    // The strip is `overflow: auto hidden`, so its scrollbar is laid out inside this height. It has
    // to clear the 20px controls and that scrollbar both, and the canvas has to start where the
    // strip ends -- one constant, so the two can't drift and leave a gap or a covered dropdown.
    it('gives the toolbar and the canvas offset the same height', async () => {
        const rendered = await renderMioFile(loaderFor(1), uri, webview) as LoaderRenderResult;
        const styleCss = rendered.update!.styleCss!;

        assert.ok(/\.st-toolbar-height \{[^}]*height: 52px;/.test(styleCss), styleCss);
        assert.ok(/\.st-miopreviewcontent \{[^}]*top:52px/.test(styleCss), styleCss);
        assert.ok(rendered.html.includes('window.toolbarHeight = 52'));
    });

    // The parser accepts quoted identifiers, so an organization or trait id is workspace text. The
    // HTML parser ends the script at the first `</script`, whatever the JavaScript around it means.
    it('escapes an id that would otherwise end the inline script', async () => {
        const hostileId = 'mio_</script><img src=x>';
        const trait = {
            id: hostileId,
            name: hostileId,
            icon: undefined,
            anyParent: [],
            allParents: [],
            exclusive: [],
            parent: undefined,
            x: 0,
            y: 0,
            relativePositionId: undefined,
            visible: true,
            hasVisible: false,
            specialTraitBackground: false,
            effects: [],
            token: undefined,
            file: 'common/military_industrial_organization/organizations/test.txt',
            sourceMioId: hostileId,
        };
        const loader: any = {
            file: trait.file,
            load: async () => ({
                result: {
                    mios: [{ id: hostileId, traits: { [hostileId]: trait }, textHeaders: [{ text: hostileId, x: 0 }], conditionExprs: [], warnings: [] }],
                    gfxFiles: [],
                    frame: undefined,
                },
            }),
        };
        const rendered = await renderMioFile(loader, uri, webview) as LoaderRenderResult;

        for (const name of ['mios', 'renderedTrait', 'renderedHeaders']) {
            const script = new RegExp(`window\\.${name} = (.*?)</script>`, 's').exec(rendered.html);
            assert.ok(script, `expected the ${name} payload script`);
            assert.ok(!script![1]!.includes('</script'), script![1]!);
        }
        const mios = JSON.parse(/window\.mios = (.*?)<\/script>/s.exec(rendered.html)![1]!);
        assert.strictEqual(mios[0].id, hostileId);
        assert.strictEqual(mios[0].traits[hostileId].id, hostileId);
        const renderedTrait = JSON.parse(/window\.renderedTrait = (.*?)<\/script>/s.exec(rendered.html)![1]!);
        assert.ok(renderedTrait[hostileId]?.[hostileId], Object.keys(renderedTrait).join(','));
    });

    // The toolbar toggles are stored by the host, because the webview's own state dies with the
    // panel. The page cannot read globalState, so it is rendered in.
    it('hands the page the stored toolbar options', async () => {
        const rendered = await renderMioFile(loaderFor(1), uri, webview) as LoaderRenderResult;
        assert.ok(rendered.html.includes('window.previewOptions = '));
    });
});

// The trait card html is inserted into the page as markup, so everything the mod wrote into it has
// to arrive escaped: the token (which the parser accepts quoted) and the localised name (which the
// localisation index copies verbatim out of the .yml).
describe('previewdef/mio renderMioFile escaping', () => {
    afterEach(() => restoreLocalisation());

    it('escapes a quoted trait token in the card body and its tooltip', async () => {
        const hostileToken = 'trait" onmouseover="alert(1)" x="<b>';
        const rendered = await renderMioFile(loaderForFile(`
            test_org = {
                name = test_org
                trait = {
                    token = "${hostileToken.replace(/"/g, '\\"')}"
                    name = test_org_trait
                    position = { x = 0 y = 0 }
                }
            }
        `), uri, webview) as LoaderRenderResult;
        const traitHtml = traitHtmlOf(rendered);

        assert.ok(!traitHtml.includes(hostileToken), traitHtml);
        assert.ok(!traitHtml.includes('onmouseover="'), traitHtml);
        assert.ok(!traitHtml.includes('<b>'), traitHtml);
        assert.ok(traitHtml.includes('title="trait&quot; onmouseover=&quot;alert(1)&quot; x=&quot;&lt;b&gt;'), traitHtml);
        assert.ok(traitHtml.includes('trait&quot;&nbsp;onmouseover=&quot;alert(1)&quot;&nbsp;x=&quot;&lt;b&gt;'), traitHtml);
    });

    it('escapes a localised trait name carrying quotes and angle brackets', async () => {
        // The greedy value regex keeps everything between the first and last quote, so the inner
        // quotes survive into the index exactly as a hostile .yml wrote them.
        stubLocalisation({ test_org_trait: 'x" onmouseover="alert(1)" y="<b>' });
        const rendered = await renderMioFile(loaderForFile(`
            test_org = {
                name = test_org
                trait = {
                    token = test_org_trait
                    name = test_org_trait
                    position = { x = 0 y = 0 }
                }
            }
        `), uri, webview) as LoaderRenderResult;
        const traitHtml = traitHtmlOf(rendered);

        assert.ok(!traitHtml.includes('onmouseover="'), traitHtml);
        assert.ok(!traitHtml.includes('<b>'), traitHtml);
        assert.ok(traitHtml.includes('title="test_org_trait\nx&quot; onmouseover=&quot;alert(1)&quot; y=&quot;&lt;b&gt;'), traitHtml);
        assert.ok(traitHtml.includes('x&quot;&nbsp;onmouseover=&quot;alert(1)&quot;&nbsp;y=&quot;&lt;b&gt;'), traitHtml);
    });
});
