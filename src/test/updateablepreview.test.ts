import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    UpdateablePreviewBase,
    LoaderRender,
    LoaderRenderResult,
    RenderContentOptions,
} from '../previewdef/updateablepreview';

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

        public run(document: vscode.TextDocument, dependencyChanged = false): Promise<void> {
            return this.sendPartialUpdate(document, dependencyChanged);
        }

        public runFull(document: vscode.TextDocument): Promise<string> {
            return this.getContent(document);
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
            if (this.disposeOnRender) {
                this.dispose();
            }
            return Promise.resolve(this.queue.shift() ?? null);
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
            onDidChangeViewState: () => ({ dispose() { /* no-op */ } }),
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
});
