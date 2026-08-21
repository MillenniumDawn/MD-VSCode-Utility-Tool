import * as vscode from 'vscode';
import { html, loadingShellHtml, errorPageContent } from './util/html';
import { StyleTable } from './util/styletable';
import { sendEvent } from './util/telemetry';
import { readFile } from './util/vsccommon';
import { decodeImageToPng } from './util/image/imagedecoder';

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

            webviewPanel.webview.html = html(
                webviewPanel.webview,
                `<div class="${styleTable.oneTimeStyle('imagePreview', () => `width:${width}px;height:${height}px;`)}">
                    <img src="data:image/png;base64,${pngBuffer.toString('base64')}"/>
                </div>`,
                [],
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
