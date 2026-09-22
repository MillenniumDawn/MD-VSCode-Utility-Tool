import * as assert from 'assert';
import * as vscode from 'vscode';
import { html, htmlEscape, loadingShellHtml } from '../util/html';
import { StyleTable } from '../util/styletable';
import { refreshFeatureFlags } from '../util/featureflags';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

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

        it('embeds the previewWheel setting so a hostile value cannot end the inline script', () => {
            // Issue #220: the setting is a workspace value, and the HTML parser ends a script at the
            // first `</script` whatever the JavaScript around it means.
            stubVscode({ configuration: { previewWheel: '</script><img src=x>' } });
            try {
                refreshFeatureFlags();
                const page = html(webview, '', []);
                const script = /window\.previewWheel = (.*?)<\/script>/s.exec(page);
                assert.ok(script, 'expected the previewWheel script');
                assert.ok(!script![1]!.includes('</script'), script![1]!);
                assert.strictEqual(JSON.parse(script![1]!.replace(/;\s*$/, '')), '</script><img src=x>');
            } finally {
                restoreVscodeStubs();
                refreshFeatureFlags();
            }
        });
    });

    // The shell is assigned to webview.html directly, not through html(), so it carries its own
    // policy: nothing from outside, and its one <style> and one <script> admitted by nonce.
    describe('loadingShellHtml', () => {
        it('locks the page down to its own style and script', () => {
            const page = loadingShellHtml('Loading <b>x</b>');
            const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
            assert.ok(meta, 'expected a CSP meta tag');
            const policy = meta![1];
            assert.ok(policy.includes("default-src 'none'"));
            assert.ok(!policy.includes('unsafe-inline'));
            const styleNonce = /style-src 'nonce-([A-Za-z0-9]+)'/.exec(policy)?.[1];
            const scriptNonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(policy)?.[1];
            assert.ok(styleNonce && scriptNonce);
            assert.ok(page.includes(`<style nonce="${styleNonce}">`));
            assert.ok(page.includes(`<script nonce="${scriptNonce}">`));
            assert.ok(!/<style>|<script>/.test(page));
            assert.ok(page.includes('Loading&nbsp;&lt;b&gt;x&lt;/b&gt;'));
        });

        it('uses a fresh nonce per page', () => {
            const nonceOf = (page: string) => /style-src 'nonce-([A-Za-z0-9]+)'/.exec(page)?.[1];
            assert.notStrictEqual(nonceOf(loadingShellHtml()), nonceOf(loadingShellHtml()));
        });
    });
});
