import * as assert from "assert";
import * as vscode from "vscode";
import { GfxPreview } from "../previewdef/gfx";

// GfxPreview now extends UpdateablePreviewBase, so these drive the real instance through
// onDocumentChange with a stub panel and count webview.html writes and updateBody posts: the first
// render assigns, an identical re-render skips, a changed render posts in place when visible, and a
// changed render against a hidden panel assigns the full html.

describe("previewdef/gfx GfxPreview in-place updates", () => {
	const content = (name: string) => `spriteTypes = {
        spriteType = {
            name = "${name}"
            texturefile = "does-not-exist.dds"
        }
    }`;

	function makePreview(visible: boolean) {
		let htmlSetCount = 0;
		let postCount = 0;
		let lastAssignedHtml: string | undefined;
		const webview = {
			postMessage: () => {
				postCount++;
				return Promise.resolve(true);
			},
			get html() {
				return lastAssignedHtml ?? "";
			},
			set html(v: string) {
				htmlSetCount++;
				lastAssignedHtml = v;
			},
			onDidReceiveMessage: () => ({
				dispose() {
					/* no-op */
				},
			}),
			asWebviewUri: (u: unknown) => u,
			cspSource: "",
		};
		const panel = {
			webview,
			visible,
			onDidChangeViewState: () => ({
				dispose() {
					/* no-op */
				},
			}),
			onDidDispose: () => ({
				dispose() {
					/* no-op */
				},
			}),
		};
		const preview = new GfxPreview(vscode.Uri.file("/tmp/x.gfx"), panel as any);
		return {
			preview,
			get htmlSetCount() {
				return htmlSetCount;
			},
			get postCount() {
				return postCount;
			},
		};
	}

	it("assigns on the first render and skips an identical re-render", async () => {
		const h = makePreview(true);
		const document = {
			getText: () => content("GFX_a"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};

		await h.preview.onDocumentChange(document as any); // first render -> assign
		assert.strictEqual(h.htmlSetCount, 1);

		await h.preview.onDocumentChange(document as any); // identical render -> skip
		assert.strictEqual(h.htmlSetCount, 1);
		assert.strictEqual(h.postCount, 0);
	});

	it("posts an in-place update (no html reassign) when the content changed and the panel is visible", async () => {
		const h = makePreview(true);
		const docA = {
			getText: () => content("GFX_a"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};
		const docB = {
			getText: () => content("GFX_b"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};

		await h.preview.onDocumentChange(docA as any); // first render -> assign
		assert.strictEqual(h.htmlSetCount, 1);

		await h.preview.onDocumentChange(docB as any); // changed render, visible -> post in place
		assert.strictEqual(h.postCount, 1);
		assert.strictEqual(h.htmlSetCount, 1);
	});

	it("reassigns the full html on a changed render when the panel is hidden", async () => {
		const h = makePreview(false);
		const docA = {
			getText: () => content("GFX_a"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};
		const docB = {
			getText: () => content("GFX_b"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};

		await h.preview.onDocumentChange(docA as any); // first render -> assign
		assert.strictEqual(h.htmlSetCount, 1);

		await h.preview.onDocumentChange(docB as any); // changed render, hidden -> full assign
		assert.strictEqual(h.postCount, 0);
		assert.strictEqual(h.htmlSetCount, 2);
	});

	it("reassigns (does not post) after an error render, then regains in-place updates", async () => {
		const h = makePreview(true);
		const badDoc = { getText: () => "{", uri: vscode.Uri.file("/tmp/x.gfx") };
		const goodDoc = {
			getText: () => content("GFX_a"),
			uri: vscode.Uri.file("/tmp/x.gfx"),
		};

		await h.preview.onDocumentChange(goodDoc as any); // first render -> assign (update-capable page)
		assert.strictEqual(h.htmlSetCount, 1);

		await h.preview.onDocumentChange(badDoc as any); // parse error -> error page (no listener) -> assign
		assert.strictEqual(h.htmlSetCount, 2);
		assert.strictEqual(h.postCount, 0);

		await h.preview.onDocumentChange(goodDoc as any); // fixed render, page has no listener -> assign
		assert.strictEqual(h.htmlSetCount, 3);
		assert.strictEqual(h.postCount, 0);

		await h.preview.onDocumentChange(goodDoc as any); // unchanged -> skip (listener restored on assign)
		assert.strictEqual(h.htmlSetCount, 3);
		assert.strictEqual(h.postCount, 0);
	});
});
