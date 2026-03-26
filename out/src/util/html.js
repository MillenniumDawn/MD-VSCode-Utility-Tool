"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlEscape = exports.html = void 0;
const vscode = require("vscode");
const context_1 = require("../context");
const styletable_1 = require("./styletable");
const common_1 = require("./common");
function html(webview, body, scripts, styles) {
    const preparedScripts = scripts.map(script => {
        if (typeof script === 'string') {
            const uri = context_1.contextContainer.current ?
                webview.asWebviewUri(vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/' + script)) :
                "";
            return [
                `<script src="${uri}"></script>`,
                '',
            ];
        }
        else {
            const nonce = (0, common_1.randomString)(32);
            return [
                `<script nonce="${nonce}">${script.content}</script>`,
                `'nonce-${nonce}'`,
            ];
        }
    });
    const preparedStyles = styles === undefined ? [['', `'unsafe-inline'`]] :
        styles.map(style => {
            const nonce = (0, common_1.randomString)(32);
            if (style instanceof styletable_1.StyleTable) {
                return [
                    style.toStyleElement(nonce),
                    `'nonce-${nonce}'`
                ];
            }
            else if (typeof style === 'object') {
                if ('nonce' in style) {
                    return [
                        '',
                        `'nonce-${style.nonce}'`,
                    ];
                }
                else {
                    return [
                        `<style nonce="${nonce}">${style.content}</style>`,
                        `'nonce-${nonce}'`,
                    ];
                }
            }
            else {
                const uri = context_1.contextContainer.current ?
                    webview.asWebviewUri(vscode.Uri.joinPath(context_1.contextContainer.current.extensionUri, 'static/' + style)) :
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
exports.html = html;
function htmlEscape(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, "&#13;")
        .replace(/ /g, "&nbsp;");
}
exports.htmlEscape = htmlEscape;
//# sourceMappingURL=html.js.map