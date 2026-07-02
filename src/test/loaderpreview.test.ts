import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    hashHtml,
    shouldReplaceHtml,
    normalizeRender,
    serializeUpdate,
    normalizeNoncesForHash,
    decideLoaderRender,
    LoaderRenderResult,
    LoaderRender,
    LoaderPreview,
} from '../previewdef/loaderpreview';

// The LoaderPreview class itself is bound to a live WebviewPanel, so the tests exercise
// the pure hash-skip decision it delegates to: same rendered HTML -> skip the reassign,
// different HTML (or no prior render) -> reassign.

describe('previewdef/loaderpreview', () => {
    describe('hashHtml', () => {
        it('returns the same hash for identical strings', () => {
            assert.strictEqual(hashHtml('<html>a</html>'), hashHtml('<html>a</html>'));
        });

        it('returns different hashes for different strings', () => {
            assert.notStrictEqual(hashHtml('<html>a</html>'), hashHtml('<html>b</html>'));
        });

        it('returns an unsigned 32-bit integer', () => {
            const h = hashHtml('anything');
            assert.ok(Number.isInteger(h));
            assert.ok(h >= 0 && h <= 0xffffffff);
        });
    });

    describe('shouldReplaceHtml', () => {
        it('replaces on the first render (no prior hash)', () => {
            assert.strictEqual(shouldReplaceHtml(undefined, hashHtml('<a>')), true);
        });

        it('skips when the rendered HTML is unchanged', () => {
            const html = '<div>same output</div>';
            const last = hashHtml(html);
            assert.strictEqual(shouldReplaceHtml(last, hashHtml(html)), false);
        });

        it('replaces when the rendered HTML changed', () => {
            const last = hashHtml('<div>before</div>');
            assert.strictEqual(shouldReplaceHtml(last, hashHtml('<div>after</div>')), true);
        });
    });

    describe('normalizeRender', () => {
        it('wraps a plain string as html with no update parts', () => {
            assert.deepStrictEqual(normalizeRender('<html>a</html>'), { html: '<html>a</html>' });
        });

        it('passes a structured result through unchanged', () => {
            const r: LoaderRenderResult = { html: '<html>a</html>', update: { styleCss: '.x{}' } };
            assert.strictEqual(normalizeRender(r), r);
        });
    });

    describe('serializeUpdate', () => {
        it('is stable for equal payloads (unlike nonce-laden full html)', () => {
            const a = { styleCss: '.x{}', data: { mios: [1, 2] } };
            const b = { styleCss: '.x{}', data: { mios: [1, 2] } };
            assert.strictEqual(serializeUpdate(a), serializeUpdate(b));
        });

        it('differs when the payload changes', () => {
            const a = { styleCss: '.x{}', data: { mios: [1] } };
            const b = { styleCss: '.x{}', data: { mios: [2] } };
            assert.notStrictEqual(serializeUpdate(a), serializeUpdate(b));
        });
    });

    describe('normalizeNoncesForHash', () => {
        it('collapses script/style tag nonces and CSP directive nonces to a constant', () => {
            const a = normalizeNoncesForHash(`<meta content="script-src 'nonce-AAA'; style-src 'nonce-BBB'"><script nonce="AAA"></script><style nonce="BBB"></style>`);
            const b = normalizeNoncesForHash(`<meta content="script-src 'nonce-CCC'; style-src 'nonce-DDD'"><script nonce="CCC"></script><style nonce="DDD"></style>`);
            assert.strictEqual(a, b);
        });

        it('leaves non-nonce content intact so real changes still differ', () => {
            const a = normalizeNoncesForHash('<script nonce="AAA">bodyA</script>');
            const b = normalizeNoncesForHash('<script nonce="BBB">bodyB</script>');
            assert.notStrictEqual(a, b);
        });
    });

    describe('decideLoaderRender', () => {
        it('skips a plain-string render that differs only by nonce values', () => {
            // Two event/gui/technology renders with identical content but fresh CSP nonces: the html
            // strings differ, but normalizing the nonces out makes them hash equal so the skip fires.
            const a = normalizeRender(`<meta content="script-src 'nonce-AAA'"><script nonce="AAA">same</script>`);
            const first = decideLoaderRender(a, undefined, true, false);
            assert.strictEqual(first.kind, 'assign');
            const b = normalizeRender(`<meta content="script-src 'nonce-BBB'"><script nonce="BBB">same</script>`);
            const d = decideLoaderRender(b, first.hash, true, false);
            assert.strictEqual(d.kind, 'skip');
        });

        it('does not skip a plain-string render whose content changed (beyond the nonce)', () => {
            const a = normalizeRender('<script nonce="AAA">bodyA</script>');
            const first = decideLoaderRender(a, undefined, true, false);
            const b = normalizeRender('<script nonce="BBB">bodyB</script>');
            const d = decideLoaderRender(b, first.hash, true, false);
            assert.strictEqual(d.kind, 'assign');
        });

        it('posts (not assigns) when there is no prior hash but the panel is visible, update-capable, and the loaded page has the listener', () => {
            // The initial full assign is done by getContent; once initialized, a first differing
            // sendPartialUpdate against an update-capable, visible page posts in place.
            const rendered: LoaderRenderResult = { html: '<h/>', update: { styleCss: '.a{}' } };
            const d = decideLoaderRender(rendered, undefined, true, true);
            assert.strictEqual(d.kind, 'post');
        });

        it('posts an in-place update when the content changed and the panel is visible', () => {
            const rendered: LoaderRenderResult = { html: '<h/>', update: { styleCss: '.a{}' } };
            const first = decideLoaderRender(rendered, undefined, true, true);
            const changed: LoaderRenderResult = { html: '<h2/>', update: { styleCss: '.b{}' } };
            const d = decideLoaderRender(changed, first.hash, true, true);
            assert.strictEqual(d.kind, 'post');
            if (d.kind === 'post') {
                assert.strictEqual(d.message.type, 'updateBody');
                assert.strictEqual(d.message.styleCss, '.b{}');
            }
        });

        it('skips when the update payload is unchanged (even if the html nonces differ)', () => {
            const first = decideLoaderRender({ html: '<a nonce="1"/>', update: { styleCss: '.a{}' } }, undefined, true, true);
            // Same update parts, different html (fresh nonce), same page kind: must still skip.
            const d = decideLoaderRender({ html: '<a nonce="2"/>', update: { styleCss: '.a{}' } }, first.hash, true, true);
            assert.strictEqual(d.kind, 'skip');
        });

        it('assigns html (no in-place post) for an update-capable preview when the panel is hidden', () => {
            const first = decideLoaderRender({ html: '<a/>', update: { styleCss: '.a{}' } }, undefined, true, true);
            const d = decideLoaderRender({ html: '<b/>', update: { styleCss: '.b{}' } }, first.hash, false, true);
            assert.strictEqual(d.kind, 'assign');
        });

        it('assigns full html for a plain-string preview (no update support) and skips when unchanged', () => {
            const changed = decideLoaderRender(normalizeRender('<div>a</div>'), undefined, true, false);
            assert.strictEqual(changed.kind, 'assign');
            const same = decideLoaderRender(normalizeRender('<div>a</div>'), changed.hash, true, false);
            assert.strictEqual(same.kind, 'skip');
        });

        it('assigns (never posts) when the loaded page has no listener, even though the render is update-capable, visible', () => {
            // Loaded page is the no-mio / error page (not update-capable). A post here would be
            // dropped and strand the preview, so the fixed render must full-reload.
            const rendered: LoaderRenderResult = { html: '<full/>', update: { styleCss: '.a{}' } };
            const d = decideLoaderRender(rendered, undefined, true, false);
            assert.strictEqual(d.kind, 'assign');
            if (d.kind === 'assign') {
                assert.strictEqual(d.updateCapable, true);
            }
        });

        it('assigns (does not skip) when the hash matches but the loaded page kind flipped', () => {
            const rendered: LoaderRenderResult = { html: '<full/>', update: { styleCss: '.a{}' } };
            // Get this render's hash, then feed it back with a not-update-capable loaded page: the
            // hash matches but the kind differs, so it must not be treated as an already-applied skip.
            const seed = decideLoaderRender(rendered, undefined, true, true);
            const d = decideLoaderRender(rendered, seed.hash, true, false);
            assert.strictEqual(d.kind, 'assign');
        });

        it('after an error-page assign, the next valid render assigns (regains the listener)', () => {
            // Error page: plain string, assign, page becomes not update-capable.
            const err = decideLoaderRender(normalizeRender('<pre>Error</pre>'), 123, true, true);
            assert.strictEqual(err.kind, 'assign');
            assert.strictEqual(err.kind === 'assign' && err.updateCapable, false);
            // Error fixed: update-capable render, visible, but the loaded page has no listener.
            const valid: LoaderRenderResult = { html: '<full/>', update: { styleCss: '.a{}', data: {} } };
            const next = decideLoaderRender(valid, err.hash, true, err.kind === 'assign' ? err.updateCapable : true);
            assert.strictEqual(next.kind, 'assign');
        });
    });

    // Exercises the instance state-advance ordering: bookkeeping is advanced only after the apply
    // succeeds, so a throwing apply leaves lastRenderHash un-advanced and the next render retries.
    describe('LoaderPreview.sendPartialUpdate ordering', () => {
        class TestPreview extends LoaderPreview<any> {
            public run(document: any): Promise<void> {
                return this.sendPartialUpdate(document);
            }
        }

        function makePreview(render: () => Promise<LoaderRender>) {
            let htmlSetCount = 0;
            let lastAssignedHtml: string | undefined;
            const webview = {
                postMessage: () => Promise.resolve(true),
                get html() { return lastAssignedHtml ?? ''; },
                set html(v: string) {
                    htmlSetCount++;
                    if (htmlSetCount === 1) {
                        throw new Error('apply failed');
                    }
                    lastAssignedHtml = v;
                },
                onDidReceiveMessage: () => ({ dispose() { /* no-op */ } }),
                asWebviewUri: (u: unknown) => u,
                cspSource: '',
            };
            const panel = {
                webview,
                visible: false, // hidden -> the changed render takes the assign path
                onDidChangeViewState: () => ({ dispose() { /* no-op */ } }),
                onDidDispose: () => ({ dispose() { /* no-op */ } }),
            };
            const createLoader = () => ({ onLoadDone: () => ({ dispose() { /* no-op */ } }), file: 'x' });
            const preview = new TestPreview(
                vscode.Uri.file('/tmp/mio.txt'),
                panel as any,
                createLoader as any,
                render as any,
            );
            return { preview, get htmlSetCount() { return htmlSetCount; }, get lastAssignedHtml() { return lastAssignedHtml; } };
        }

        it('leaves lastRenderHash un-advanced when the apply throws, so the next render retries', async () => {
            const render = () => Promise.resolve('<div>x</div>' as LoaderRender);
            const h = makePreview(render);
            const document = { getText: () => 'source', uri: vscode.Uri.file('/tmp/mio.txt') };

            // First apply throws (html setter throws on the first assignment).
            await assert.rejects(() => h.preview.run(document));
            assert.strictEqual(h.htmlSetCount, 1);

            // Same content again: had the hash been advanced before the throw, this would skip and
            // never re-assign. It must retry the assign instead.
            await h.preview.run(document);
            assert.strictEqual(h.htmlSetCount, 2);
            assert.strictEqual(h.lastAssignedHtml, '<div>x</div>');
        });
    });

    // A post whose postMessage resolves false (webview not ready/gone) must fall back to a full html
    // assign so the stored state reflects what actually got applied.
    describe('LoaderPreview.sendPartialUpdate dropped post', () => {
        class TestPreview extends LoaderPreview<any> {
            public run(document: any): Promise<void> {
                return this.sendPartialUpdate(document);
            }
        }

        function makePreview(postResult: boolean, render: () => Promise<LoaderRender>) {
            let htmlSetCount = 0;
            let postCount = 0;
            let lastAssignedHtml: string | undefined;
            const webview = {
                postMessage: () => { postCount++; return Promise.resolve(postResult); },
                get html() { return lastAssignedHtml ?? ''; },
                set html(v: string) { htmlSetCount++; lastAssignedHtml = v; },
                onDidReceiveMessage: () => ({ dispose() { /* no-op */ } }),
                asWebviewUri: (u: unknown) => u,
                cspSource: '',
            };
            const panel = {
                webview,
                visible: true, // visible + update-capable + listener present -> the post path
                onDidChangeViewState: () => ({ dispose() { /* no-op */ } }),
                onDidDispose: () => ({ dispose() { /* no-op */ } }),
            };
            const createLoader = () => ({ onLoadDone: () => ({ dispose() { /* no-op */ } }), file: 'x' });
            const preview = new TestPreview(
                vscode.Uri.file('/tmp/mio.txt'),
                panel as any,
                createLoader as any,
                render as any,
            );
            return {
                preview,
                get htmlSetCount() { return htmlSetCount; },
                get postCount() { return postCount; },
                get lastAssignedHtml() { return lastAssignedHtml; },
            };
        }

        // The first run assigns (the freshly-constructed page has no listener yet), which flips the
        // instance to update-capable; the second changed run takes the post path.
        function makeRender() {
            let call = 0;
            return () => {
                call++;
                return Promise.resolve({ html: `<full nonce="${call}">body${call}</full>`, update: { styleCss: `.a${call}{}`, data: {} } } as LoaderRender);
            };
        }

        it('falls back to a full html assign when postMessage resolves false', async () => {
            const h = makePreview(false, makeRender());
            const document = { getText: () => 'source', uri: vscode.Uri.file('/tmp/mio.txt') };

            await h.preview.run(document); // assign (page not yet update-capable)
            assert.strictEqual(h.htmlSetCount, 1);

            await h.preview.run(document); // post -> dropped -> assign fallback
            assert.strictEqual(h.postCount, 1);
            assert.strictEqual(h.htmlSetCount, 2);
            assert.strictEqual(h.lastAssignedHtml, '<full nonce="2">body2</full>');
        });

        it('does not assign again when postMessage resolves true', async () => {
            const h = makePreview(true, makeRender());
            const document = { getText: () => 'source', uri: vscode.Uri.file('/tmp/mio.txt') };

            await h.preview.run(document); // assign (page not yet update-capable)
            assert.strictEqual(h.htmlSetCount, 1);

            await h.preview.run(document); // post -> delivered -> no fallback assign
            assert.strictEqual(h.postCount, 1);
            assert.strictEqual(h.htmlSetCount, 1);
        });
    });
});
