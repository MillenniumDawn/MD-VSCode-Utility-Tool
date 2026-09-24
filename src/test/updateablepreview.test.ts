import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    UpdateablePreviewBase,
    LoaderRender,
    LoaderRenderResult,
    RenderContentOptions,
} from '../previewdef/updateablepreview';
import { stubVscode, restoreVscodeStubs } from './_vscode_stub';

// The extension points FocusTreePreview needs from the shared base, driven through a real instance
// with a stub panel (same pattern as gfxpreview.test.ts): a render that declines to render at all,
// the pre-assign hook, the applied-render callback that reports assign-versus-post and the side
// channel, and re-posting the last update into a page that reloaded on its own.

interface AppliedCall {
    assigned: boolean;
    sideChanged: boolean;
}

describe('previewdef/updateablepreview extension points', () => {
    class TestPreview extends UpdateablePreviewBase {
        public renders: LoaderRender | null[] = [];
        public applied: AppliedCall[] = [];
        public beforeAssignAt: number[] = [];
        public lastOptions: RenderContentOptions | undefined;
        private queue: (LoaderRender | null)[] = [];

        public queueRender(...results: (LoaderRender | null)[]): void {
            this.queue.push(...results);
        }

        // Set by the disposed-guard tests: dispose the preview mid-flight, the way closing the
        // panel during the 1000 ms debounce does.
        public disposeOnRender = false;

        // Render-queue tests: how many renders started, a gate that holds the next one open, and a
        // render that throws.
        public started = 0;
        public failNext = false;
        private gates: Promise<void>[] = [];

        public gateNext(): () => void {
            let open!: () => void;
            this.gates.push(new Promise<void>(resolve => { open = resolve; }));
            return open;
        }

        public reloadNow(dependencyChanged = false): void {
            this.reload(dependencyChanged);
        }

        // Settles once everything queued so far has rendered.
        public idle(): Promise<void> {
            return this.enqueueRender(() => Promise.resolve());
        }

        public run(document: vscode.TextDocument, dependencyChanged = false): Promise<void> {
            return this.sendPartialUpdate(document, dependencyChanged);
        }

        public runFull(document: vscode.TextDocument, dependencyChanged = false): Promise<string> {
            return this.getContent(document, dependencyChanged);
        }

        public repost(): void {
            this.repostLatestUpdate();
        }

        protected renderContent(
            _document: vscode.TextDocument,
            _uri: vscode.Uri,
            _webview: vscode.Webview,
            options: RenderContentOptions,
        ): Promise<LoaderRender | null> {
            this.lastOptions = options;
            this.started++;
            if (this.disposeOnRender) {
                this.dispose();
            }
            if (this.failNext) {
                this.failNext = false;
                return Promise.reject(new Error('render failed'));
            }
            const result = this.queue.shift() ?? null;
            const gate = this.gates.shift();
            return gate === undefined ? Promise.resolve(result) : gate.then(() => result);
        }

        protected beforeRenderAssign(): void {
            this.beforeAssignAt.push(htmlSetCount);
        }

        protected onRenderApplied(_rendered: LoaderRenderResult, assigned: boolean, sideChanged: boolean): Promise<void> {
            this.applied.push({ assigned, sideChanged });
            return Promise.resolve();
        }
    }

    // Shared with beforeRenderAssign so the test can assert the hook runs BEFORE the write.
    let htmlSetCount = 0;

    function makePreview(visible: boolean, onPost?: () => void) {
        htmlSetCount = 0;
        let postCount = 0;
        let postDelivered = true;
        const posted: any[] = [];
        let lastAssignedHtml: string | undefined;
        let viewStateListener: (() => void) | undefined;
        const webview = {
            postMessage: (msg: any) => {
                postCount++;
                posted.push(msg);
                if (onPost) {
                    onPost();
                }
                return Promise.resolve(postDelivered);
            },
            get html() { return lastAssignedHtml ?? ''; },
            set html(v: string) { htmlSetCount++; lastAssignedHtml = v; },
            onDidReceiveMessage: () => ({ dispose() { /* no-op */ } }),
            asWebviewUri: (u: unknown) => u,
            cspSource: '',
        };
        const panel = {
            webview,
            visible,
            onDidChangeViewState: (listener: () => void) => {
                viewStateListener = listener;
                return { dispose() { /* no-op */ } };
            },
            onDidDispose: () => ({ dispose() { /* no-op */ } }),
        };
        const preview = new TestPreview(vscode.Uri.file('/tmp/tree.txt'), panel as any);
        return {
            preview,
            posted,
            get htmlSetCount() { return htmlSetCount; },
            get postCount() { return postCount; },
            get lastAssignedHtml() { return lastAssignedHtml; },
            dropPosts() { postDelivered = false; },
            // The tab is switched away from (or back to): what VS Code reports through the
            // panel's view-state event.
            setVisible(value: boolean) {
                panel.visible = value;
                viewStateListener?.();
            },
        };
    }

    const document = { getText: () => 'source', uri: vscode.Uri.file('/tmp/tree.txt') } as any;
    const updateRender = (fingerprint: string, extra: Partial<LoaderRenderResult> = {}): LoaderRenderResult =>
        ({ html: `<full>${fingerprint}</full>`, update: { data: { n: fingerprint } }, fingerprint, ...extra });

    it('tells the render whether it is a full render or a partial update', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        assert.deepStrictEqual(h.preview.lastOptions, { partial: false, dependencyChanged: false });
        await h.preview.run(document, true);
        assert.deepStrictEqual(h.preview.lastOptions, { partial: true, dependencyChanged: true });
    });

    // A reload caused by something other than the document -- a setting change -- has to force the
    // loader session too: the document's hash did not move, so an unforced load answers from cache.
    it('lets a full render be forced', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'));
        await h.preview.runFull(document, true);
        assert.deepStrictEqual(h.preview.lastOptions, { partial: false, dependencyChanged: true });
    });

    it('skips a null render without touching the webview or the bookkeeping', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), null, updateRender('S1'));
        await h.preview.runFull(document);
        h.preview.applied.length = 0;

        await h.preview.run(document); // null: the preview proved nothing changed
        assert.strictEqual(h.postCount, 0);
        assert.strictEqual(h.htmlSetCount, 0); // getContent returns html; PreviewBase assigns it
        assert.deepStrictEqual(h.preview.applied, []);

        // The declined render must not have advanced the hash: an identical render still skips.
        await h.preview.run(document);
        assert.strictEqual(h.postCount, 0);
    });

    it('runs beforeRenderAssign before every html write, and not on a post', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        // getContent hands the html back to PreviewBase, so the hook has run but no write happened.
        assert.deepStrictEqual(h.preview.beforeAssignAt, [0]);

        await h.preview.run(document); // post: no html write, no hook
        assert.strictEqual(h.postCount, 1);
        assert.deepStrictEqual(h.preview.beforeAssignAt, [0]);
    });

    it('runs beforeRenderAssign before the write on the hidden-panel assign path', async () => {
        const h = makePreview(false);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        await h.preview.run(document); // hidden: assign, not post
        assert.strictEqual(h.htmlSetCount, 1);
        // The recorded count is the value BEFORE the write it precedes.
        assert.deepStrictEqual(h.preview.beforeAssignAt, [0, 0]);
    });

    it('reports assigned on a full render and on a reassign, and not on a post', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'), '<plain/>');
        await h.preview.runFull(document);
        await h.preview.run(document); // post
        await h.preview.run(document); // plain string: no listener in it -> assign
        assert.deepStrictEqual(h.preview.applied, [
            { assigned: true, sideChanged: true },
            { assigned: false, sideChanged: false },
            { assigned: true, sideChanged: false },
        ]);
    });

    it('reports sideChanged on an otherwise-skipped render', async () => {
        const h = makePreview(true);
        h.preview.queueRender(
            updateRender('S1', { sideFingerprint: 'I1' }),
            updateRender('S1', { sideFingerprint: 'I2' }),
            updateRender('S1', { sideFingerprint: 'I2' }),
        );
        await h.preview.runFull(document);
        h.preview.applied.length = 0;

        await h.preview.run(document); // structure unchanged, icons moved
        assert.strictEqual(h.postCount, 0);
        assert.deepStrictEqual(h.preview.applied, [{ assigned: false, sideChanged: true }]);

        // The side fingerprint advanced, so an identical render is a plain skip.
        await h.preview.run(document);
        assert.deepStrictEqual(h.preview.applied, [{ assigned: false, sideChanged: true }]);
    });

    it('re-posts the last delivered update, and stops once the html was reassigned', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'), '<plain/>');
        await h.preview.runFull(document);

        h.preview.repost(); // nothing posted yet: the fresh html embeds the structure
        assert.strictEqual(h.postCount, 0);

        await h.preview.run(document); // post
        assert.strictEqual(h.postCount, 1);
        h.preview.repost();
        assert.strictEqual(h.postCount, 2);
        assert.deepStrictEqual(h.posted[1], h.posted[0]);

        await h.preview.run(document); // assign: the stored update belongs to a superseded page
        h.preview.repost();
        assert.strictEqual(h.postCount, 2);
    });

    it('falls back to an assign when the post is dropped, and reports it as assigned', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        h.preview.applied.length = 0;
        h.dropPosts();

        await h.preview.run(document);
        assert.strictEqual(h.postCount, 1);
        assert.strictEqual(h.htmlSetCount, 1);
        assert.deepStrictEqual(h.preview.applied, [{ assigned: true, sideChanged: false }]);
    });

    it('does not fall back to an html assign when the post to a disposed panel is dropped', async () => {
        let preview: TestPreview | undefined;
        const h = makePreview(true, () => preview?.dispose());
        preview = h.preview;
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        h.preview.applied.length = 0;
        h.dropPosts();

        await h.preview.run(document);
        // postMessage returning false is what a disposed webview reports; disposing right there
        // mirrors the panel closing while the post was in flight. The fallback assign must not
        // write html on the disposed panel.
        assert.strictEqual(h.postCount, 1);
        assert.strictEqual(h.htmlSetCount, 0);
    });

    it('writes nothing when the preview is disposed during a full render', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'));
        h.preview.disposeOnRender = true;

        await h.preview.onDocumentChange(document);
        assert.strictEqual(h.htmlSetCount, 0);
        assert.deepStrictEqual(h.preview.applied, []);
        assert.deepStrictEqual(h.preview.beforeAssignAt, []);
    });

    it('posts nothing when the preview is disposed during a partial update', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), updateRender('S2'));
        await h.preview.runFull(document);
        h.preview.applied.length = 0;
        h.preview.disposeOnRender = true;

        await h.preview.run(document);
        assert.strictEqual(h.postCount, 0);
        assert.strictEqual(h.htmlSetCount, 0);
        assert.deepStrictEqual(h.preview.applied, []);
    });

    it('keeps the current html when a full render declines to render', async () => {
        const h = makePreview(true);
        h.preview.queueRender(updateRender('S1'), null);
        const first = await h.preview.runFull(document);
        assert.strictEqual(first, '<full>S1</full>');
        // A full render must not decline; falling back to what is on screen beats blanking it.
        assert.strictEqual(await h.preview.runFull(document), '<full>S1</full>');
    });

    // Issue #237: an edit arriving while a render is in flight must wait for it. Run side by side,
    // a slower older render lands last, overwrites the newer content and keeps its stale hash.
    describe('render serialization', () => {
        const settle = () => new Promise<void>(resolve => setImmediate(resolve));

        afterEach(() => {
            restoreVscodeStubs();
        });

        it('starts the next render only once the one in flight has finished', async () => {
            const h = makePreview(true);
            h.preview.queueRender(updateRender('S1'), updateRender('S2'), updateRender('S3'));
            await h.preview.onDocumentChange(document); // first render -> assign

            const open = h.preview.gateNext();
            const older = h.preview.onDocumentChange(document);
            const newer = h.preview.onDocumentChange(document);
            await settle();
            assert.strictEqual(h.preview.started, 2);

            open();
            await Promise.all([older, newer]);
            assert.strictEqual(h.preview.started, 3);
            assert.deepStrictEqual(h.posted.map(m => m.data.n), ['S2', 'S3']);
        });

        it('keeps a reload requested during a full render a full render', async () => {
            stubVscode({ textDocuments: [document] });
            const h = makePreview(true);
            h.preview.queueRender(updateRender('S1'), updateRender('S2'));

            const open = h.preview.gateNext();
            const initial = h.preview.initializePanelContent(document);
            h.preview.reloadNow();
            open();
            await initial;
            await h.preview.idle();

            assert.strictEqual(h.preview.started, 2);
            assert.deepStrictEqual(h.preview.lastOptions, { partial: false, dependencyChanged: false });
            assert.deepStrictEqual(h.preview.applied.map(a => a.assigned), [true, true]);
            assert.strictEqual(h.postCount, 0);
        });

        it('runs the next render after one that threw', async () => {
            const h = makePreview(true);
            h.preview.queueRender(updateRender('S1'));
            h.preview.failNext = true;
            const consoleError = console.error;
            console.error = () => undefined;
            try {
                await Promise.all([h.preview.onDocumentChange(document), h.preview.onDocumentChange(document)]);
            } finally {
                console.error = consoleError;
            }
            assert.strictEqual(h.preview.started, 2);
            assert.strictEqual(h.lastAssignedHtml, '<full>S1</full>');
        });
    });

    // The full page is the expensive half of a render and most renders never assign it, so a
    // preview hands it over as a thunk. These pin down when the base runs it: on the first render,
    // on an assign, and on the flush when a posted page goes hidden -- never on a skip or a post.
    describe('lazy html', () => {
        // A render whose page counts how often it was built.
        function lazyRender(fingerprint: string) {
            let builds = 0;
            const rendered: LoaderRenderResult = {
                html: () => {
                    builds++;
                    return `<full>${fingerprint}</full>`;
                },
                update: { data: { n: fingerprint } },
                fingerprint,
            };
            return { rendered, get builds() { return builds; } };
        }

        it('builds the page once on the first render', async () => {
            const h = makePreview(true);
            const r = lazyRender('S1');
            h.preview.queueRender(r.rendered);
            assert.strictEqual(await h.preview.runFull(document), '<full>S1</full>');
            assert.strictEqual(r.builds, 1);
        });

        it('never builds the page for a skipped or posted render', async () => {
            const h = makePreview(true);
            const same = lazyRender('S1');
            const changed = lazyRender('S2');
            h.preview.queueRender(lazyRender('S1').rendered, same.rendered, changed.rendered);
            await h.preview.runFull(document);

            await h.preview.run(document); // skip
            assert.strictEqual(same.builds, 0);

            await h.preview.run(document); // post
            assert.strictEqual(h.postCount, 1);
            assert.strictEqual(changed.builds, 0);
        });

        it('builds a posted page only when the panel goes hidden, and only once', async () => {
            const h = makePreview(true);
            const changed = lazyRender('S2');
            h.preview.queueRender(lazyRender('S1').rendered, changed.rendered);
            await h.preview.runFull(document);
            await h.preview.run(document); // post
            assert.strictEqual(changed.builds, 0);

            h.setVisible(false);
            assert.strictEqual(changed.builds, 1);
            assert.strictEqual(h.htmlSetCount, 1);
            assert.strictEqual(h.lastAssignedHtml, '<full>S2</full>');

            // Showing and hiding again finds the property current, so nothing is written or built.
            h.setVisible(true);
            h.setVisible(false);
            assert.strictEqual(changed.builds, 1);
            assert.strictEqual(h.htmlSetCount, 1);
        });

        it('builds the page once when a changed render against a hidden panel assigns', async () => {
            const h = makePreview(false);
            const changed = lazyRender('S2');
            h.preview.queueRender(lazyRender('S1').rendered, changed.rendered);
            await h.preview.runFull(document);
            await h.preview.run(document); // hidden: assign
            assert.strictEqual(changed.builds, 1);
            assert.strictEqual(h.lastAssignedHtml, '<full>S2</full>');
        });

        it('builds the page once when a dropped post falls back to an assign', async () => {
            const h = makePreview(true);
            const changed = lazyRender('S2');
            h.preview.queueRender(lazyRender('S1').rendered, changed.rendered);
            await h.preview.runFull(document);
            h.dropPosts();
            await h.preview.run(document);
            assert.strictEqual(h.postCount, 1);
            assert.strictEqual(changed.builds, 1);
            assert.strictEqual(h.lastAssignedHtml, '<full>S2</full>');
        });

        it('hands a declined full render the flushed page without building it again', async () => {
            const h = makePreview(true);
            const changed = lazyRender('S2');
            h.preview.queueRender(lazyRender('S1').rendered, changed.rendered, null);
            await h.preview.runFull(document);
            await h.preview.run(document); // post
            h.setVisible(false); // flush builds it
            assert.strictEqual(await h.preview.runFull(document), '<full>S2</full>');
            assert.strictEqual(changed.builds, 1);
        });
    });
});
