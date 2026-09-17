import * as assert from 'assert';
import * as vscode from 'vscode';
import { html, htmlEscape } from '../util/html';
import { StyleTable } from '../util/styletable';

describe('util/html', () => {
    describe('htmlEscape', () => {
        it('escapes ampersands', () => {
            // Note: every space is also replaced with &nbsp; -- the function
            // is space-aggressive, so we test without surrounding spaces.
            assert.strictEqual(htmlEscape('foo&bar'), 'foo&amp;bar');
        });

        it('escapes angle brackets', () => {
            assert.strictEqual(htmlEscape('<div>'), '&lt;div&gt;');
        });

        it('escapes double and single quotes', () => {
            assert.strictEqual(htmlEscape('"hi"\'there\''), '&quot;hi&quot;&#039;there&#039;');
        });

        it('escapes newlines and spaces', () => {
            // The function encodes every space and newline, which is unusual for HTML, but is
            // the project's actual contract: callers feed it pre-trimmed text.
            assert.strictEqual(htmlEscape('a\nb'), 'a&#10;b');
            assert.strictEqual(htmlEscape('a b'), 'a&nbsp;b');
        });

        it('escapes the ampersand before other characters so & does not double-encode', () => {
            // The function does & first, so an input `&lt;` becomes `&amp;lt;` -- the & is
            // escaped but the existing `lt;` is left alone. Document the behaviour.
            assert.strictEqual(htmlEscape('&lt;'), '&amp;lt;');
        });

        it('returns an empty string unchanged', () => {
            assert.strictEqual(htmlEscape(''), '');
        });
    });

    describe('html', () => {
        const webview = { asWebviewUri: (u: unknown) => u, cspSource: 'stub-csp' } as unknown as vscode.Webview;

        it('allows inline style attributes and does not pin styles to a nonce', () => {
            const table = new StyleTable();
            table.style('x', () => 'color: red;');
            const page = html(webview, '<div style="left: 1px;"></div>', [{ content: 'void 0;' }], [table, { nonce: 'abc' }]);
            const styleSrc = /style-src ([^;]*);/.exec(page)?.[1] ?? '';
            assert.ok(styleSrc.includes("'unsafe-inline'"));
            assert.ok(styleSrc.includes('stub-csp'));
            assert.ok(!styleSrc.includes('nonce-'));
            assert.ok(/script-src ('nonce-[^']+' )+stub-csp/.test(page));
            assert.ok(page.includes('.st-x { color: red; }'));
        });
    });
});
