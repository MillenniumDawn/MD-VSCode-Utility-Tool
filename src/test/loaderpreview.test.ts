import * as assert from 'assert';
import { hashHtml, shouldReplaceHtml } from '../previewdef/loaderpreview';

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
});
