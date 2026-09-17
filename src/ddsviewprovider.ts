import * as vscode from 'vscode';
import { html, loadingShellHtml, errorPageContent } from './util/html';
import { StyleTable } from './util/styletable';
import { sendEvent } from './util/telemetry';
import { readFile } from './util/vsccommon';
import { decodeImageToPng } from './util/image/imagedecoder';

// Runs in the viewer page: asks the host for the image bytes and shows them through a blob URL.
const textureScript = `
(function () {
    var vscode = acquireVsCodeApi();
    var img = document.getElementById('texture');
    window.addEventListener('message', function (event) {
        var message = event.data;
        if (!message || message.type !== 'image') { return; }
        var url = URL.createObjectURL(new Blob([message.data], { type: 'image/png' }));
        img.onload = function () { URL.revokeObjectURL(url); };
        img.src = url;
    });
    vscode.postMessage({ command: 'ready' });
})();
`;

abstract class CommonViewProvider implements vscode.CustomReadonlyEditorProvider {
    public async openCustomDocument(uri: vscode.Uri) {
        // Don't try opening it as text
        return { uri, dispose: () => { } };
    }

    public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Promise<void> {
        try {
            this.onOpen();

            // Show the shared loading spinner while the (potentially large) texture is read
            // and decoded. It is replaced by the rendered image as soon as decoding finishes.
            webviewPanel.webview.html = loadingShellHtml();

            const buffer = await Promise.race([
                readFile(document.uri),
                new Promise<null>(resolve => token.onCancellationRequested(_ => resolve(null))),
            ]);

            if (buffer === null) {
                return;
            }

            // Decoding runs off the host thread in the image worker; race it against cancellation so a
            // panel torn down mid-decode isn't reassigned html after disposal.
            const decoded = await Promise.race([
                decodeImageToPng(Buffer.from(buffer), this.imageKind),
                new Promise<null>(resolve => token.onCancellationRequested(_ => resolve(null))),
            ]);

            if (decoded === null) {
                return;
            }

            const { pngBuffer, width, height } = decoded;
            const styleTable = new StyleTable();

            // The PNG is posted to the page as raw bytes and turned into a blob URL there, rather
            // than inlined as base64 in the html: a 4096x4096 texture would otherwise be copied
            // three times over (base64 string, template literal, IPC) and kept by the panel.
            // The page asks with `ready`, and asks again whenever VS Code reloads it (hide -> show),
            // so the bytes stay referenced until the panel is disposed.
            let pngBytes: Uint8Array | null = new Uint8Array(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);
            const messageListener = webviewPanel.webview.onDidReceiveMessage((msg: { command?: string } | undefined) => {
                if (msg?.command === 'ready' && pngBytes !== null) {
                    void webviewPanel.webview.postMessage({ type: 'image', data: pngBytes });
                }
            });
            webviewPanel.onDidDispose(() => {
                pngBytes = null;
                messageListener.dispose();
            });

            // Custom editor webviews start with scripts disabled, and the page needs one to build the blob URL.
            webviewPanel.webview.options = { enableScripts: true };
            webviewPanel.webview.html = html(
                webviewPanel.webview,
                `<div class="${styleTable.oneTimeStyle('imagePreview', () => `width:${width}px;height:${height}px;`)}">
                    <img id="texture" alt="${this.imageKind.toUpperCase()} texture preview"/>
                </div>`,
                [{ content: textureScript }],
                [styleTable]
            );
        } catch (e) {
            webviewPanel.webview.html = errorPageContent(e);
        }
    }

    protected abstract onOpen(): void;
    protected abstract readonly imageKind: 'dds' | 'tga';
}

export class DDSViewProvider extends CommonViewProvider {
    protected readonly imageKind: 'dds' | 'tga' = 'dds';

    protected onOpen(): void {
        sendEvent('preview.dds');
    }
}

export class TGAViewProvider extends CommonViewProvider {
    protected readonly imageKind: 'dds' | 'tga' = 'tga';

    protected onOpen(): void {
        sendEvent('preview.tga');
    }
}
