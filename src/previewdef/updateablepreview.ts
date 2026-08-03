import * as vscode from "vscode";
import { PreviewBase } from "./previewbase";

// Shared base for previews that re-render in place instead of tearing the webview down on every
// change. LoaderPreview (event/gui/mio/technology) and GfxPreview both extend it; they only differ
// in how they render (a loader-driven build vs a direct file parse), so the hash-skip, the
// updateBody post decision, the loaded-page capability tracking, and the hidden-panel flush live
// here once.
//
// getContent hashes the freshly rendered output and assigns the html (first render / reload).
// sendPartialUpdate re-renders and either skips (identical output), posts an in-place `updateBody`
// message (changed, the loaded page has the listener, and the panel is visible), or reassigns the
// full html (no update support, hidden panel, or the loaded page lost its listener). A webview.html
// assignment tears the page down and rebuilds it (blank flash, lost scroll/zoom), so a debounced
// edit that produces identical output does nothing, and a changed edit updates in place.
//
// A post is only valid when the html currently loaded in the webview is itself update-capable (it
// loaded the preview script, so it has the updateBody listener). The no-mio and error pages are
// plain strings with no listener, so a post into them is silently dropped. We track the loaded
// page's capability on the instance; when it is false the next render must assign (full reload) to
// restore the listener, never post, regardless of the new render's capability.

// The in-place update message the webview applies without a full reload. A preview opts in by
// returning it from its render function; `data` is the preview-specific globals the webview
// re-renders from (kept generic so the base stays agnostic).
export interface LoaderUpdateMessage {
	styleCss?: string;
	bodyHtml?: string;
	data?: Record<string, unknown>;
}

export interface LoaderRenderResult {
	html: string;
	update?: LoaderUpdateMessage;
}

export type LoaderRender = string | LoaderRenderResult;

export function normalizeRender(rendered: LoaderRender): LoaderRenderResult {
	return typeof rendered === "string" ? { html: rendered } : rendered;
}

// Stable serialization of the update payload for change detection. Unlike the full html (which
// carries fresh random CSP nonces per render and so never hashes equal), the update parts are
// deterministic for identical input, so hashing them makes the skip actually fire.
export function serializeUpdate(update: LoaderUpdateMessage): string {
	return JSON.stringify(update);
}

// The full html embeds a fresh randomString nonce per render (util/html.ts) — in each script/style
// tag's nonce="..." attribute and in the CSP meta's 'nonce-...' directive — so two otherwise
// identical plain-string renders never hash equal and the skip never fires. Normalize the nonces to
// a constant before hashing so unchanged content is detected. Only the hash input is normalized; the
// html actually assigned to the webview keeps its real nonces.
export function normalizeNoncesForHash(html: string): string {
	return html
		.replace(/nonce="[^"]+"/g, 'nonce=""')
		.replace(/'nonce-[^']+'/g, "'nonce-'");
}

export type LoaderUpdateAction =
	| { kind: "skip"; hash: number }
	| {
			kind: "post";
			message: LoaderUpdateMessage & { type: "updateBody" };
			hash: number;
	  }
	| { kind: "assign"; html: string; hash: number; updateCapable: boolean };

// Pure decision for what to do with a fresh render, given the last render's hash, whether the panel
// is visible, and whether the html currently loaded in the webview is update-capable (has the
// updateBody listener). Returns: skip (unchanged and the loaded page is the same kind), post an
// in-place update (changed, update-capable, visible, and the loaded page can receive it), or assign
// the full html (changed but no update support, hidden panel, or the loaded page has no listener).
// `updateCapable` on the assign result is the capability of the html being assigned, so the caller
// can update its tracking after the reload.
export function decideLoaderRender(
	rendered: LoaderRenderResult,
	lastRenderHash: number | undefined,
	visible: boolean,
	lastPageUpdateCapable: boolean,
): LoaderUpdateAction {
	const updateCapable = rendered.update !== undefined;
	const hash = rendered.update
		? hashHtml(serializeUpdate(rendered.update))
		: hashHtml(normalizeNoncesForHash(rendered.html));
	// Skip only when the content is unchanged AND the loaded page is the same kind (update-capable
	// or not) as this render. If the page kind flipped, the hash is computed over a different domain
	// (update payload vs full html) and a match could falsely skip, stranding a stale page.
	if (
		!shouldReplaceHtml(lastRenderHash, hash) &&
		lastPageUpdateCapable === updateCapable
	) {
		return { kind: "skip", hash };
	}
	// Post only when the live page carries the updateBody listener. Posting into a listener-less
	// page (the no-mio / error page) is silently dropped and strands the preview, so those
	// transitions assign (full reload) instead.
	if (rendered.update && visible && lastPageUpdateCapable) {
		return {
			kind: "post",
			message: { type: "updateBody", ...rendered.update },
			hash,
		};
	}
	return { kind: "assign", html: rendered.html, hash, updateCapable };
}

export abstract class UpdateablePreviewBase extends PreviewBase {
	private lastRenderHash: number | undefined = undefined;
	// Whether the html currently loaded in the webview was rendered update-capable (it loaded the
	// preview script and so carries the updateBody listener). When false, a post would be dropped,
	// so the next changed render must assign (full reload) to restore the listener.
	private lastPageUpdateCapable = false;
	// The most recent full html. Kept so a panel that received in-place updates while visible can be
	// flushed back to a current html when it is hidden (see the view-state handler), avoiding a stale
	// reload on the next show.
	private latestHtml: string | undefined = undefined;
	private htmlPropertyStale = false;

	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(uri, panel);
		// Without retainContextWhenHidden the webview is torn down when hidden and reloaded from
		// panel.webview.html on show. In-place updates don't touch that property, so flush the latest
		// html into it when the panel goes hidden to keep the next show current.
		this.panel.onDidChangeViewState(() => {
			if (
				!this.panel.visible &&
				this.htmlPropertyStale &&
				this.latestHtml !== undefined
			) {
				this.panel.webview.html = this.latestHtml;
				this.htmlPropertyStale = false;
			}
		});
	}

	// Render the document to the webview's html plus an optional in-place update payload. Previews
	// that support in-place updates return the update; plain-string renders (error / no-mio pages)
	// omit it, which flips the loaded page to not-update-capable.
	protected abstract renderContent(
		document: vscode.TextDocument,
		uri: vscode.Uri,
		webview: vscode.Webview,
	): Promise<LoaderRender>;

	protected async getContent(document: vscode.TextDocument): Promise<string> {
		const rendered = normalizeRender(
			await this.renderContent(document, document.uri, this.panel.webview),
		);
		// PreviewBase assigns the returned html to the webview, so the loaded page's capability is
		// this render's capability.
		this.lastRenderHash = rendered.update
			? hashHtml(serializeUpdate(rendered.update))
			: hashHtml(normalizeNoncesForHash(rendered.html));
		this.lastPageUpdateCapable = rendered.update !== undefined;
		this.latestHtml = rendered.html;
		this.htmlPropertyStale = false;
		return rendered.html;
	}

	protected async sendPartialUpdate(
		document: vscode.TextDocument,
	): Promise<void> {
		const rendered = normalizeRender(
			await this.renderContent(document, document.uri, this.panel.webview),
		);
		const decision = decideLoaderRender(
			rendered,
			this.lastRenderHash,
			this.panel.visible,
			this.lastPageUpdateCapable,
		);
		if (decision.kind === "skip") {
			return;
		}

		// Advance bookkeeping only after the apply succeeds. If the post/assign throws, the state
		// stays un-advanced so the next render retries instead of skipping on a matching hash.
		if (decision.kind === "post") {
			const delivered = await this.panel.webview.postMessage(decision.message);
			if (delivered) {
				this.latestHtml = rendered.html;
				// The live page keeps its listener (not reloaded), so capability is unchanged; the html
				// property still holds the pre-update document, so mark it for flush on hide.
				this.htmlPropertyStale = true;
				this.lastRenderHash = decision.hash;
				return;
			}
			// The post was dropped (webview not ready/gone): fall back to a full html assign so the
			// stored state reflects what actually got applied. The assigned html is update-capable
			// (post is only chosen for update renders), so the reloaded page keeps its listener.
			this.panel.webview.html = rendered.html;
			this.latestHtml = rendered.html;
			this.htmlPropertyStale = false;
			this.lastRenderHash = decision.hash;
			this.lastPageUpdateCapable = true;
		} else {
			this.panel.webview.html = decision.html;
			this.latestHtml = rendered.html;
			this.htmlPropertyStale = false;
			this.lastRenderHash = decision.hash;
			this.lastPageUpdateCapable = decision.updateCapable;
		}
	}
}

// fnv1a, mirrored from ContentLoader in src/util/loader/loader.ts (private there).
export function hashHtml(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h * 16777619) >>> 0;
	}
	return h;
}

// Replace the webview HTML only when there is no prior render or the hash changed.
export function shouldReplaceHtml(
	lastHash: number | undefined,
	newHash: number,
): boolean {
	return lastHash === undefined || lastHash !== newHash;
}
