import * as assert from 'assert';
import * as vscode from 'vscode';
import { PreviewBase } from '../previewdef/previewbase';
import { isWorldMapHostMessage } from '../previewdef/worldmap/definitions';
import { restoreVscodeStubs, stubVscode } from './_vscode_stub';

// What a webview posts is input read off a boundary: every field a handler uses has to be the
// type it expects, or the message is dropped. These drive the real handlers with the shapes a
// page would never send and check that nothing downstream sees them.
describe('previewdef/previewbase webview message validation', () => {
    const uri = vscode.Uri.file('/tmp/preview.txt');

    class TestPreview extends PreviewBase {
        public opened: [string, number | undefined, number | undefined][] = [];
        protected getContent(): Promise<string> {
            return Promise.resolve('');
        }
        protected override openOrCopyFile(file: string, start: number | undefined, end: number | undefined): Promise<void> {
            this.opened.push([file, start, end]);
            return Promise.resolve();
        }
    }

    function makePreview() {
        let handler: ((msg: unknown) => void) | undefined;
        const panel = {
            webview: {
                onDidReceiveMessage: (h: (msg: unknown) => void) => { handler = h; return { dispose() { /* no-op */ } }; },
            },
            onDidDispose: () => ({ dispose() { /* no-op */ } }),
        };
        const preview = new TestPreview(uri, panel as any);
        assert.ok(handler, 'expected the preview to subscribe to webview messages');
        return { preview, send: handler! };
    }

    let shown: unknown[];
    let originalShowTextDocument: unknown;

    beforeEach(() => {
        shown = [];
        originalShowTextDocument = (vscode.window as any).showTextDocument;
        (vscode.window as any).showTextDocument = (target: unknown, options: unknown) => {
            shown.push({ target, options });
            return Promise.resolve();
        };
        stubVscode({
            textDocuments: [{
                uri,
                positionAt: (offset: number) => ({ offset }),
            }],
        });
    });

    afterEach(() => {
        (vscode.window as any).showTextDocument = originalShowTextDocument;
        restoreVscodeStubs();
    });

    it('navigates the preview document on a well-formed message', () => {
        const { send } = makePreview();
        send({ command: 'navigate', start: 3, end: 9 });
        assert.strictEqual(shown.length, 1);
        const { options } = shown[0] as { options: { selection: { start: { offset: number }; end: { offset: number } } } };
        assert.deepStrictEqual([options.selection.start.offset, options.selection.end.offset], [3, 9]);
    });

    it('opens another file on a well-formed message', () => {
        const { preview, send } = makePreview();
        send({ command: 'navigate', start: 3, end: undefined, file: 'common/ideas/a.txt' });
        assert.deepStrictEqual(preview.opened, [['common/ideas/a.txt', 3, undefined]]);
        assert.strictEqual(shown.length, 0);
    });

    it('drops a navigate whose offsets are not non-negative integers', () => {
        const { preview, send } = makePreview();
        send({ command: 'navigate', start: '3', end: 9 });
        send({ command: 'navigate', start: -1, end: 9 });
        send({ command: 'navigate', start: 1.5, end: 9 });
        send({ command: 'navigate', start: 3, end: 'x', file: 'common/ideas/a.txt' });
        send({ command: 'navigate', start: 3, end: null });
        assert.strictEqual(shown.length, 0);
        assert.deepStrictEqual(preview.opened, []);
    });

    it('drops a navigate whose file is not a string', () => {
        const { preview, send } = makePreview();
        send({ command: 'navigate', start: 3, end: 9, file: { path: 'common/ideas/a.txt' } });
        send({ command: 'navigate', start: 3, end: 9, file: 42 });
        send({ command: 'navigate', start: 3, end: 9, file: null });
        assert.strictEqual(shown.length, 0);
        assert.deepStrictEqual(preview.opened, []);
    });

    it('ignores a message that is not an object', () => {
        const { send } = makePreview();
        assert.doesNotThrow(() => {
            send(undefined);
            send(null);
            send('navigate');
            send(7);
        });
        assert.strictEqual(shown.length, 0);
    });
});

describe('previewdef/worldmap isWorldMapHostMessage', () => {
    it('accepts the messages the page sends', () => {
        assert.ok(isWorldMapHostMessage({ command: 'loaded', force: false }));
        assert.ok(isWorldMapHostMessage({ command: 'requestprovinces', start: 0, end: 300 }));
        assert.ok(isWorldMapHostMessage({ command: 'requestsupplynodes', start: 10, end: 20 }));
        assert.ok(isWorldMapHostMessage({ command: 'openfile', type: 'state', file: 'history/states/1.txt', start: 0, end: 5 }));
        assert.ok(isWorldMapHostMessage({ command: 'openfile', type: 'supplyarea', file: 'a.txt', start: undefined, end: undefined }));
        assert.ok(isWorldMapHostMessage({ command: 'requestexportmap' }));
        assert.ok(isWorldMapHostMessage({ command: 'exportmap', dataUrl: 'data:image/png;base64,AAAA' }));
        assert.ok(isWorldMapHostMessage({ command: 'telemetry', telemetryType: 'event', args: ['open'] }));
    });

    it('rejects a field of the wrong type', () => {
        assert.ok(!isWorldMapHostMessage({ command: 'loaded', force: 'yes' }));
        assert.ok(!isWorldMapHostMessage({ command: 'requestprovinces', start: '0', end: 300 }));
        assert.ok(!isWorldMapHostMessage({ command: 'requestprovinces', start: 0, end: -1 }));
        assert.ok(!isWorldMapHostMessage({ command: 'requeststates', start: 0 }));
        assert.ok(!isWorldMapHostMessage({ command: 'openfile', type: 'state', file: ['a.txt'], start: 0, end: 5 }));
        assert.ok(!isWorldMapHostMessage({ command: 'openfile', type: 'state', file: 'a.txt', start: 'x', end: 5 }));
        assert.ok(!isWorldMapHostMessage({ command: 'exportmap', dataUrl: 7 }));
        assert.ok(!isWorldMapHostMessage({ command: 'telemetry', telemetryType: 'other', args: [] }));
        assert.ok(!isWorldMapHostMessage({ command: 'telemetry', telemetryType: 'event', args: 'open' }));
    });

    it('rejects an open-file type outside the three the host knows, including prototype names', () => {
        assert.ok(!isWorldMapHostMessage({ command: 'openfile', type: 'constructor', file: 'a.txt', start: 0, end: 5 }));
        assert.ok(!isWorldMapHostMessage({ command: 'openfile', type: '__proto__', file: 'a.txt', start: 0, end: 5 }));
        assert.ok(!isWorldMapHostMessage({ command: 'openfile', type: 'country', file: 'a.txt', start: 0, end: 5 }));
    });

    it('rejects a command the host does not handle and anything that is not an object', () => {
        assert.ok(!isWorldMapHostMessage({ command: 'provinces', data: '', start: 0, end: 1 }));
        assert.ok(!isWorldMapHostMessage({ command: 'hasOwnProperty', start: 0, end: 1 }));
        assert.ok(!isWorldMapHostMessage({}));
        assert.ok(!isWorldMapHostMessage(null));
        assert.ok(!isWorldMapHostMessage('loaded'));
    });
});
