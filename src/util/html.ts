import * as vscode from 'vscode';
import { contextContainer } from '../context';
import { StyleTable } from './styletable';
import { forceError, randomString } from './common';
import { localize } from './i18n';

export interface DynamicScript {
    content: string;
    // Optional id for an inline <style>, so the webview can address it later and refresh its
    // textContent in place (e.g. LoaderPreview's updateBody path) instead of a full reload.
    id?: string;
}

export interface NonceOnly {
    nonce: string;
}

// Inline script exposing the previewed file's URI to the webview as window.previewedFileUri.
export function previewedFileUriScript(uri: vscode.Uri): DynamicScript {
    return { content: `window.previewedFileUri = "${uri.toString()}";` };
}

export function html(webview: vscode.Webview, body: string, scripts: (string | DynamicScript)[], styles?: (string | StyleTable | DynamicScript | NonceOnly)[]): string {
    const preparedScripts = scripts.map<[string, string]>(script => {
        if (typeof script === 'string') {
            const uri = contextContainer.current ?
                webview.asWebviewUri(vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/' + script)) :
                "";
            return [
                `<script src="${uri}"></script>`,
                '',
            ];
        } else {
            const nonce = randomString(32);
            return [
                `<script nonce="${nonce}">${script.content}</script>`,
                `'nonce-${nonce}'`,
            ];
        }
    });

    const preparedStyles = styles === undefined ? [['', `'unsafe-inline'`] as [string, string]] :
        styles.map<[string, string]>(style => {
            const nonce = randomString(32);
            if (style instanceof StyleTable) {
                return [
                    style.toStyleElement(nonce),
                    `'nonce-${nonce}'`
                ];
            } else if (typeof style === 'object') {
                if ('nonce' in style) {
                    return [
                        '',
                        `'nonce-${style.nonce}'`,
                    ];
                } else {
                    return [
                        `<style${style.id ? ` id="${style.id}"` : ''} nonce="${nonce}">${style.content}</style>`,
                        `'nonce-${nonce}'`,
                    ];
                }
            } else {
                const uri = contextContainer.current ?
                    webview.asWebviewUri(vscode.Uri.joinPath(contextContainer.current.extensionUri, 'static/' + style)) :
                    "";
                return [
                    `<link rel="stylesheet" href="${uri}"/>`,
                    ''
                ];
            }
        });

    return `
<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            style-src ${preparedStyles.map(v => v[1]).join(' ')} ${webview.cspSource};
            script-src ${preparedScripts.map(v => v[1]).filter(v => v.length > 0).join(' ')} ${webview.cspSource};
            img-src data: ${webview.cspSource};
            font-src ${webview.cspSource};
        ">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${preparedScripts.map(v => v[0]).join('')}
        ${preparedStyles.map(v => v[0]).join('')}
    </head>
    <body>${body.replace(/\s\s+/g, ' ')}</body>
</html>
`;
}

/**
 * Standalone loading shell shown in a preview webview while its content is being
 * built. Renders a centered spinner with a status line that listens for `progress`
 * messages (`{ type: 'progress', message, current, total }`) so previewers that
 * report progress can update the text and counter; previewers that don't simply
 * keep the initial message while the spinner animates.
 *
 * This is a self-contained HTML document assigned directly to `webview.html`
 * (not routed through `html()`), so inline <style>/<script> are used without a CSP.
 */
export function loadingShellHtml(message?: string): string {
    const initialText = htmlEscape(message ?? localize('preview.loading', 'Loading preview...'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
    html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editor-background); }
    .preview-loading {
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 16px;
        font: 13px var(--vscode-font-family);
        color: var(--vscode-foreground);
    }
    .preview-spinner {
        width: 32px; height: 32px;
        border-radius: 50%;
        border: 3px solid var(--vscode-progressBar-background, var(--vscode-foreground, #888));
        border-top-color: transparent;
        animation: preview-spin 0.9s linear infinite;
    }
    .preview-status { opacity: 0.85; text-align: center; max-width: 80%; }
    .preview-counter { opacity: 0.6; margin-left: 6px; font-variant-numeric: tabular-nums; }
    @keyframes preview-spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="preview-loading" role="status" aria-live="polite">
    <div class="preview-spinner" aria-hidden="true"></div>
    <div class="preview-status"><span id="loading-message">${initialText}</span><span id="loading-counter" class="preview-counter"></span></div>
</div>
<script>
(function () {
    var msgEl = document.getElementById('loading-message');
    var counterEl = document.getElementById('loading-counter');
    window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.type !== 'progress') return;
        if (typeof data.message === 'string' && msgEl) {
            msgEl.textContent = data.message;
        }
        if (counterEl) {
            if (typeof data.current === 'number' && typeof data.total === 'number' && data.total > 0) {
                counterEl.textContent = '(' + data.current + '/' + data.total + ')';
            } else {
                counterEl.textContent = '';
            }
        }
    });
})();
</script>
</body>
</html>`;
}

/**
 * The body of the page a preview shows when it could not render: the word "Error" and whatever was
 * thrown, escaped.
 *
 * Every preview had its own copy of this line, eight in all, split across two formatting
 * conventions so a plain text search did not even find them together.
 */
export function errorPageContent(cause: unknown): string {
    return `${localize('error', 'Error')}: <br/>  <pre>${htmlEscape(forceError(cause).toString())}</pre>`;
}

/**
 * The whole error page, for the previews that render one through `html()`. The DDS viewer assigns
 * the body directly and so uses {@link errorPageContent} on its own.
 */
export function errorPage(webview: vscode.Webview, uri: vscode.Uri, cause: unknown): string {
    return html(webview, errorPageContent(cause), [previewedFileUriScript(uri)], []);
}

// One pass with a lookup table rather than a chain of seven .replace() calls, each of which
// scanned the whole string and built another one. Escaping the ampersand first mattered when the
// replacements ran in sequence -- otherwise a '<' turned into '&lt;' and its '&' was then escaped
// again -- and a single pass removes the ordering hazard along with the six extra scans.
const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
    "\n": "&#10;",
    " ": "&nbsp;",
};
const htmlEscapePattern = /[&<>"'\n ]/g;

export function htmlEscape(unsafe: string): string {
    return unsafe.replace(htmlEscapePattern, c => htmlEscapes[c] as string);
}

// Attribute-context escape for mod-supplied identifiers in preview HTML. Unlike
// htmlEscape it leaves spaces intact so in-page filter / id matching keeps
// working, while still neutralising a "-breakout from a crafted identifier.
// Centralised here so every contentbuilder shares the same escaping.
const attrEscapePattern = /[&"<>]/g;

export function escapeAttr(value: string): string {
    return value.replace(attrEscapePattern, c => htmlEscapes[c] as string);
}
