import * as assert from 'assert';
import {
    hashHtml,
    shouldReplaceHtml,
    normalizeRender,
    serializeUpdate,
    decideLoaderRender,
    LoaderRenderResult,
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

    describe('decideLoaderRender', () => {
        it('posts (not assigns) when there is no prior hash but the panel is visible and update-capable', () => {
            // The initial full assign is done by getContent; once initialized, a first differing
            // sendPartialUpdate against an update-capable, visible panel posts in place.
            const rendered: LoaderRenderResult = { html: '<h/>', update: { styleCss: '.a{}' } };
            const d = decideLoaderRender(rendered, undefined, true);
            assert.strictEqual(d.kind, 'post');
        });

        it('posts an in-place update when the content changed and the panel is visible', () => {
            const rendered: LoaderRenderResult = { html: '<h/>', update: { styleCss: '.a{}' } };
            const first = decideLoaderRender(rendered, undefined, true);
            const changed: LoaderRenderResult = { html: '<h2/>', update: { styleCss: '.b{}' } };
            const d = decideLoaderRender(changed, first.hash, true);
            assert.strictEqual(d.kind, 'post');
            if (d.kind === 'post') {
                assert.strictEqual(d.message.type, 'updateBody');
                assert.strictEqual(d.message.styleCss, '.b{}');
            }
        });

        it('skips when the update payload is unchanged (even if the html nonces differ)', () => {
            const first = decideLoaderRender({ html: '<a nonce="1"/>', update: { styleCss: '.a{}' } }, undefined, true);
            // Same update parts, different html (fresh nonce): must still skip.
            const d = decideLoaderRender({ html: '<a nonce="2"/>', update: { styleCss: '.a{}' } }, first.hash, true);
            assert.strictEqual(d.kind, 'skip');
        });

        it('assigns html (no in-place post) for an update-capable preview when the panel is hidden', () => {
            const first = decideLoaderRender({ html: '<a/>', update: { styleCss: '.a{}' } }, undefined, true);
            const d = decideLoaderRender({ html: '<b/>', update: { styleCss: '.b{}' } }, first.hash, false);
            assert.strictEqual(d.kind, 'assign');
        });

        it('assigns full html for a plain-string preview (no update support) and skips when unchanged', () => {
            const changed = decideLoaderRender(normalizeRender('<div>a</div>'), undefined, true);
            assert.strictEqual(changed.kind, 'assign');
            const same = decideLoaderRender(normalizeRender('<div>a</div>'), changed.hash, true);
            assert.strictEqual(same.kind, 'skip');
        });
    });
});
