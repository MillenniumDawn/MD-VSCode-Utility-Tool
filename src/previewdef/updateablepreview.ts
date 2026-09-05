import * as vscode from "vscode";
import { PreviewBase } from "./previewbase";
import { fnv1a32 } from "../util/hash";

// Shared base for previews that re-render in place instead of tearing the webview down on every
// change. LoaderPreview (event/gui/mio/technology), GfxPreview and FocusTreePreview all extend it;
// they only differ in how they render (a loader-driven build, a direct file parse, or the focus
// tree's two-phase structure-then-icons build), so the hash-skip, the update post decision, the
// loaded-page capability tracking and the hidden-panel flush live here once.
//
// getContent hashes the freshly rendered output and assigns the html (first render / reload).
// sendPartialUpdate re-renders and either skips (identical output), posts an in-place update
// message (changed, the loaded page has the listener, and the panel is visible), or reassigns the
// full html (no update support, hidden panel, or the loaded page lost its listener). A webview.html
// assignment tears the page down and rebuilds it (blank flash, lost scroll/zoom), so a debounced
// edit that produces identical output does nothing, and a changed edit updates in place.
//
// A post is only valid when the html currently loaded in the webview is itself update-capable (it
// loaded the preview script, so it has the update listener). The no-mio and error pages are plain
// strings with no listener, so a post into them is silently dropped. We track the loaded page's
// capability on the instance; when it is false the next render must assign (full reload) to
// restore the listener, never post, regardless of the new render's capability.
//
// Three optional fingerprints on the render result cover what a single hash over the update payload
// cannot express; they all default to today's behaviour, so a preview that sets none of them
// behaves exactly as before:
//   fingerprint      - the change-detection identity, when the payload itself is not a stable one.
//   shellFingerprint - html-baked content an in-place update cannot patch; moving it forces assign.
//   sideFingerprint  - a second channel the preview pushes out of band; moving it forces a render
//                      to be applied (never skipped) and is reported to onRenderApplied.

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
	// Change-detection identity for this render. Defaults to the serialized update payload (or the
	// nonce-normalized html for a plain-string render). Supplied when the payload's key order is
	// unstable, or when the change detection has to cover more than the payload carries (the focus
	// tree fingerprints its styleTable records, which never reach the webview as payload).
	fingerprint?: string;
	// Identity of content baked into the html that an in-place update cannot patch (the focus tree's
	// toolbar lives in the shell, not in the updatable content). When it moves, the render assigns
	// the full html instead of posting, and is never skipped.
	shellFingerprint?: string;
	// Identity of a second channel the preview pushes to the webview itself, out of band (the focus
	// tree's asynchronously resolved icon CSS). When it moves, the render is not skipped and
	// onRenderApplied is called with sideChanged so the preview can push it.
	sideFingerprint?: string;
}

export type LoaderRender = string | LoaderRenderResult;

// Why a render ran: `partial` is false for the first render and every full reload (getContent),
// true for an edit against an already-initialized panel. `dependencyChanged` is threaded from the
// subscription path: the preview is re-rendered with its OWN document even when a dependency
// (an icon, a .gfx sprite, a .gui window) changed, so this is the only signal for it.
export interface RenderContentOptions {
	partial: boolean;
	dependencyChanged: boolean;
}

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

// The change-detection input for a render: the preview's own fingerprint when it supplies one,
// otherwise the update payload, otherwise the nonce-normalized html.
function renderHashInput(rendered: LoaderRenderResult): string {
	if (rendered.fingerprint !== undefined) {
		return rendered.fingerprint;
	}
	return rendered.update
		? serializeUpdate(rendered.update)
		: normalizeNoncesForHash(rendered.html);
}

// The bookkeeping every action carries, so the caller advances all of it at once after the apply
// succeeds (and none of it when the apply throws).
export interface LoaderRenderState {
	hash: number;
	shellFingerprint: string | undefined;
	sideFingerprint: string | undefined;
	sideChanged: boolean;
}

export type LoaderUpdateAction =
	| ({ kind: "skip" } & LoaderRenderState)
	| ({
			kind: "post";
			message: LoaderUpdateMessage & { type: "updateBody" };
	  } & LoaderRenderState)
	| ({ kind: "assign"; html: string; updateCapable: boolean } & LoaderRenderState);

export interface LoaderRenderPrevious {
	hash: number | undefined;
	shellFingerprint: string | undefined;
	sideFingerprint: string | undefined;
	pageUpdateCapable: boolean;
}

// Pure decision for what to do with a fresh render, given the last render's state and whether the
// panel is visible. Returns: skip (unchanged and the loaded page is the same kind), post an in-place
// update (changed, update-capable, visible, the loaded page can receive it and the shell is
// unchanged), or assign the full html (changed but no update support, hidden panel, the loaded page
// has no listener, or the shell changed). `updateCapable` on the assign result is the capability of
// the html being assigned, so the caller can update its tracking after the reload.
export function decideLoaderRender(
	rendered: LoaderRenderResult,
	previous: LoaderRenderPrevious,
	visible: boolean,
): LoaderUpdateAction {
	const updateCapable = rendered.update !== undefined;
	const hash = hashHtml(renderHashInput(rendered));
	// The shell (a toolbar rendered into the html) cannot be patched by a post, so a change to it
	// needs a full reload even when the update payload alone would have sufficed.
	const shellChanged = rendered.shellFingerprint !== previous.shellFingerprint;
	// The side channel is pushed by the preview itself, so a change to it never posts or assigns on
	// its own — it only stops the render from being skipped, and is reported back to the caller.
	const sideChanged = rendered.sideFingerprint !== previous.sideFingerprint;
	const state: LoaderRenderState = {
		hash,
		shellFingerprint: rendered.shellFingerprint,
		sideFingerprint: rendered.sideFingerprint,
		sideChanged,
	};
	// Skip only when the content is unchanged AND the loaded page is the same kind (update-capable
	// or not) as this render. If the page kind flipped, the hash is computed over a different domain
	// (update payload vs full html) and a match could falsely skip, stranding a stale page.
	if (
		!shouldReplaceHtml(previous.hash, hash) &&
		previous.pageUpdateCapable === updateCapable &&
		!shellChanged
	) {
		return { kind: "skip", ...state };
	}
	// Post only when the live page carries the update listener. Posting into a listener-less page
	// (the no-mio / error page) is silently dropped and strands the preview, so those transitions
	// assign (full reload) instead.
	if (
		rendered.update &&
		visible &&
		previous.pageUpdateCapable &&
		!shellChanged
	) {
		return {
			kind: "post",
			message: { type: "updateBody", ...rendered.update },
			...state,
		};
	}
	return { kind: "assign", html: rendered.html, updateCapable, ...state };
}

export abstract class UpdateablePreviewBase extends PreviewBase {
	private lastRenderHash: number | undefined = undefined;
	// Whether the html currently loaded in the webview was rendered update-capable (it loaded the
	// preview script and so carries the update listener). When false, a post would be dropped, so
	// the next changed render must assign (full reload) to restore the listener.
	private lastPageUpdateCapable = false;
	private lastShellFingerprint: string | undefined = undefined;
	private lastSideFingerprint: string | undefined = undefined;
	// The most recent full html. Kept so a panel that received in-place updates while visible can be
	// flushed back to a current html when it is hidden (see the view-state handler), avoiding a stale
	// reload on the next show.
	private latestHtml: string | undefined = undefined;
	private htmlPropertyStale = false;
	// The last update message actually delivered to the live page, cleared whenever the html is
	// assigned (a fresh page already embeds that structure). A webview that reloads without the
	// panel going hidden loses the posted DOM, so a preview whose page signals it reloaded can put
	// it back with repostLatestUpdate().
	private latestUpdateMessage:
		| (LoaderUpdateMessage & { type: "updateBody" })
		| undefined = undefined;

	constructor(uri: vscode.Uri, panel: vscode.WebviewPanel) {
		super(uri, panel);
		// Without retainContextWhenHidden the webview is torn down when hidden and reloaded from
		// panel.webview.html on show. In-place updates don't touch that property, so flush the latest
		// html into it when the panel goes hidden to keep the next show current.
		this.panel.onDidChangeViewState(() => {
			if (this.isDisposed) {
				return;
			}
			if (
				!this.panel.visible &&
				this.htmlPropertyStale &&
				this.latestHtml !== undefined
			) {
				// Re-syncing the property with content the live page already shows, not a render, so
				// beforeRenderAssign is deliberately not called: nothing about the current render is
				// superseded. The stored update is dropped because this html embeds it.
				this.latestUpdateMessage = undefined;
				this.panel.webview.html = this.latestHtml;
				this.htmlPropertyStale = false;
			}
		});
	}

	// Render the document to the webview's html plus an optional in-place update payload. Previews
	// that support in-place updates return the update; plain-string renders (error / no-mio pages)
	// omit it, which flips the loaded page to not-update-capable. Returning null means "nothing the
	// webview renders changed" — the preview proved it without producing a render, so the update is
	// skipped and no bookkeeping moves. Only valid when options.partial is true; the first render
	// must produce html.
	protected abstract renderContent(
		document: vscode.TextDocument,
		uri: vscode.Uri,
		webview: vscode.Webview,
		options: RenderContentOptions,
	): Promise<LoaderRender | null>;

	// Called immediately before a render's html is assigned to the webview, so a preview can
	// invalidate state belonging to the page being torn down before the replacement can report back.
	// Not called by the hidden-panel flush, which re-assigns content the live page already shows.
	protected beforeRenderAssign(): void {
		// Nothing by default.
	}

	// Called after a render was applied. `assigned` distinguishes a full html reload (the page is
	// rebuilt, so anything pushed out of band is gone) from an in-place post. Also called on an
	// otherwise-skipped render when only the side channel moved.
	protected onRenderApplied(
		_rendered: LoaderRenderResult,
		_assigned: boolean,
		_sideChanged: boolean,
	): Promise<void> {
		return Promise.resolve();
	}

	// Re-post the last delivered update into a page that reloaded on its own (VS Code can rebuild a
	// webview without the panel ever reporting hidden). A no-op when the live page was assigned
	// fresh html, which already embeds that structure.
	protected repostLatestUpdate(): void {
		if (this.latestUpdateMessage !== undefined && !this.isDisposed) {
			void this.panel.webview.postMessage(this.latestUpdateMessage);
		}
	}

	private assignHtml(html: string): void {
		if (this.isDisposed) {
			return;
		}
		this.beforeRenderAssign();
		this.latestUpdateMessage = undefined;
		this.panel.webview.html = html;
	}

	protected async getContent(document: vscode.TextDocument): Promise<string> {
		if (this.isDisposed) {
			return this.latestHtml ?? this.getLoadingShellHtml();
		}
		const result = await this.renderContent(
			document,
			document.uri,
			this.panel.webview,
			{ partial: false, dependencyChanged: false },
		);
		if (this.isDisposed) {
			return this.latestHtml ?? this.getLoadingShellHtml();
		}
		if (result === null) {
			// A full render must not decline: there is no page to keep. Fall back to what is already
			// on screen rather than blanking the panel.
			return this.latestHtml ?? this.getLoadingShellHtml();
		}
		const rendered = normalizeRender(result);
		// PreviewBase assigns the returned html to the webview, so the loaded page's capability is
		// this render's capability. It assigns the property itself, so run the pre-assign hook here.
		this.beforeRenderAssign();
		this.latestUpdateMessage = undefined;
		this.lastRenderHash = hashHtml(renderHashInput(rendered));
		this.lastPageUpdateCapable = rendered.update !== undefined;
		this.lastShellFingerprint = rendered.shellFingerprint;
		this.lastSideFingerprint = rendered.sideFingerprint;
		this.latestHtml = rendered.html;
		this.htmlPropertyStale = false;
		await this.onRenderApplied(rendered, true, true);
		return rendered.html;
	}

	protected async sendPartialUpdate(
		document: vscode.TextDocument,
		dependencyChanged = false,
	): Promise<void> {
		if (this.isDisposed) {
			return;
		}
		const result = await this.renderContent(
			document,
			document.uri,
			this.panel.webview,
			{ partial: true, dependencyChanged },
		);
		if (this.isDisposed) {
			return;
		}
		if (result === null) {
			return;
		}
		const rendered = normalizeRender(result);
		const decision = decideLoaderRender(
			rendered,
			{
				hash: this.lastRenderHash,
				shellFingerprint: this.lastShellFingerprint,
				sideFingerprint: this.lastSideFingerprint,
				pageUpdateCapable: this.lastPageUpdateCapable,
			},
			this.panel.visible,
		);
		if (decision.kind === "skip") {
			if (decision.sideChanged) {
				// Nothing the html or the payload renders changed, but the out-of-band channel moved
				// (new icons for the same structure), so let the preview push it.
				this.lastSideFingerprint = decision.sideFingerprint;
				await this.onRenderApplied(rendered, false, true);
			}
			return;
		}

		// Advance bookkeeping only after the apply succeeds. If the post/assign throws, the state
		// stays un-advanced so the next render retries instead of skipping on a matching hash.
		if (decision.kind === "post") {
			const delivered = await this.panel.webview.postMessage(decision.message);
			if (delivered) {
				this.latestHtml = rendered.html;
				this.latestUpdateMessage = decision.message;
				// The live page keeps its listener (not reloaded), so capability is unchanged; the html
				// property still holds the pre-update document, so mark it for flush on hide.
				this.htmlPropertyStale = true;
				this.applyRenderState(decision);
				await this.onRenderApplied(rendered, false, decision.sideChanged);
				return;
			}
			// The post was dropped (webview not ready/gone): fall back to a full html assign so the
			// stored state reflects what actually got applied. The assigned html is update-capable
			// (post is only chosen for update renders), so the reloaded page keeps its listener.
			this.assignHtml(rendered.html);
			this.latestHtml = rendered.html;
			this.htmlPropertyStale = false;
			this.applyRenderState(decision);
			this.lastPageUpdateCapable = true;
			await this.onRenderApplied(rendered, true, decision.sideChanged);
		} else {
			this.assignHtml(decision.html);
			this.latestHtml = rendered.html;
			this.htmlPropertyStale = false;
			this.applyRenderState(decision);
			this.lastPageUpdateCapable = decision.updateCapable;
			await this.onRenderApplied(rendered, true, decision.sideChanged);
		}
	}

	private applyRenderState(state: LoaderRenderState): void {
		this.lastRenderHash = state.hash;
		this.lastShellFingerprint = state.shellFingerprint;
		this.lastSideFingerprint = state.sideFingerprint;
	}
}

/** Identifies a render, so an unchanged one can be skipped rather than reassigned. */
export function hashHtml(s: string): number {
	return fnv1a32(s);
}

// Replace the webview HTML only when there is no prior render or the hash changed.
export function shouldReplaceHtml(
	lastHash: number | undefined,
	newHash: number,
): boolean {
	return lastHash === undefined || lastHash !== newHash;
}
