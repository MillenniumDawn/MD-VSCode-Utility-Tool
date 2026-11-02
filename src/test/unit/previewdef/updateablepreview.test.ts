import * as assert from "assert";
import type * as vscode from "vscode";
import {
	UpdateablePreviewBase,
	LoaderRenderResult,
} from "../../../previewdef/updateablepreview";
import { handOver } from "../host";

interface PreviewState {
	latestRender: LoaderRenderResult | undefined;
	lastRenderHash: number | undefined;
	latestUpdateMessage: unknown;
	htmlPropertyStale: boolean;
	lastSideFingerprint: string | undefined;
}

class TestPreview extends UpdateablePreviewBase {
	public applied: { assigned: boolean; sideChanged: boolean }[] = [];
	public next!: LoaderRenderResult;

	public full(document: vscode.TextDocument): Promise<string> {
		return this.getContent(document);
	}

	public update(document: vscode.TextDocument): Promise<void> {
		return this.sendPartialUpdate(document);
	}

	public get state(): PreviewState {
		return this as unknown as PreviewState;
	}

	protected renderContent(): Promise<LoaderRenderResult> {
		return Promise.resolve(this.next);
	}

	protected onRenderApplied(_rendered: LoaderRenderResult, assigned: boolean, sideChanged: boolean): Promise<void> {
		this.applied.push({ assigned, sideChanged });
		return Promise.resolve();
	}
}

const uri = { toString: () => "file:///mod/tree.txt" } as vscode.Uri;
const document = { uri, getText: () => "source" } as vscode.TextDocument;
const render = (fingerprint: string, sideFingerprint = "I1"): LoaderRenderResult => ({
	html: `<full>${fingerprint}</full>`,
	update: { data: { n: fingerprint } },
	fingerprint,
	sideFingerprint,
});

function makePreview() {
	const disposable = { dispose() {} };
	handOver({
		EventEmitter: class {
			event = () => disposable;
			fire() {}
			dispose() {}
		} as any,
		Disposable: {
			from: (...disposables: { dispose(): void }[]) => ({
				dispose: () => disposables.forEach(d => d.dispose()),
			}),
		} as any,
	});
	const posted: unknown[] = [];
	const html: string[] = [];
	let delivery: Promise<boolean> = Promise.resolve(true);
	let onPost = () => undefined as void;
	const panel = {
		visible: true,
		webview: {
			get html() { return html.at(-1) ?? ""; },
			set html(value: string) { html.push(value); },
			postMessage: (message: unknown) => {
				posted.push(message);
				onPost();
				return delivery;
			},
			onDidReceiveMessage: () => disposable,
		},
		onDidChangeViewState: () => disposable,
		onDidDispose: () => disposable,
	};
	const preview = new TestPreview(uri, panel as unknown as vscode.WebviewPanel);
	return {
		preview, posted, html,
		dropPosts() { delivery = Promise.resolve(false); },
		deferPost() {
			let resolve!: (delivered: boolean) => void;
			delivery = new Promise<boolean>(done => { resolve = done; });
			const started = new Promise<void>(done => { onPost = done; });
			return { started, resolve };
		},
	};
}

describe("previewdef/updateablepreview deferred posts", () => {
	it("applies a delivered update without assigning HTML", async () => {
		const h = makePreview();
		h.preview.next = render("S1");
		await h.preview.full(document);
		h.preview.applied.length = 0;
		h.preview.next = render("S2");
		await h.preview.update(document);
		assert.strictEqual(h.posted.length, 1);
		assert.deepStrictEqual(h.html, []);
		assert.strictEqual(h.preview.state.latestRender, h.preview.next);
		assert.strictEqual(h.preview.state.htmlPropertyStale, true);
		assert.deepStrictEqual(h.preview.applied, [{ assigned: false, sideChanged: false }]);
	});

	it("reports a live side-channel-only update", async () => {
		const h = makePreview();
		h.preview.next = render("S1");
		await h.preview.full(document);
		h.preview.applied.length = 0;
		h.preview.next = render("S1", "I2");
		await h.preview.update(document);
		assert.deepStrictEqual(h.posted, []);
		assert.deepStrictEqual(h.html, []);
		assert.strictEqual(h.preview.state.lastSideFingerprint, "I2");
		assert.deepStrictEqual(h.preview.applied, [{ assigned: false, sideChanged: true }]);
	});

	it("assigns fallback HTML when a live panel drops the post", async () => {
		const h = makePreview();
		h.preview.next = render("S1");
		await h.preview.full(document);
		h.preview.applied.length = 0;
		h.preview.next = render("S2");
		h.dropPosts();
		await h.preview.update(document);
		assert.deepStrictEqual(h.html, ["<full>S2</full>"]);
		assert.strictEqual(h.preview.state.latestRender, h.preview.next);
		assert.strictEqual(h.preview.state.latestUpdateMessage, undefined);
		assert.strictEqual(h.preview.state.htmlPropertyStale, false);
		assert.deepStrictEqual(h.preview.applied, [{ assigned: true, sideChanged: false }]);
	});

	for (const delivered of [true, false]) {
		it(`does not apply a post resolving ${delivered} after disposal`, async () => {
			const h = makePreview();
			const first = render("S1");
			h.preview.next = first;
			await h.preview.full(document);
			h.preview.applied.length = 0;
			const hash = h.preview.state.lastRenderHash;
			const gate = h.deferPost();
			h.preview.next = render("S2", "I2");
			const pending = h.preview.update(document);
			await gate.started;
			h.preview.dispose();
			gate.resolve(delivered);
			await pending;
			assert.strictEqual(h.posted.length, 1);
			assert.deepStrictEqual(h.html, []);
			assert.deepStrictEqual(h.preview.applied, []);
			assert.strictEqual(h.preview.state.latestRender, first);
			assert.strictEqual(h.preview.state.lastRenderHash, hash);
			assert.strictEqual(h.preview.state.lastSideFingerprint, "I1");
			assert.strictEqual(h.preview.state.latestUpdateMessage, undefined);
			assert.strictEqual(h.preview.state.htmlPropertyStale, false);
		});
	}
});
