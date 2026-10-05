const pendingRenderAcks = new Map<string, {
	resolve: (renderedFocusIds: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}>();
// Focus-tree parsing/rendering has a 60 second host budget; leave room for the browser handshake.
const maxFocusTreeDomRenderWaitMs = 70_000;

/**
 * Waits for the focus-tree webview to report the focus elements it mounted. The timeout
 * makes a webview that never loads (or never sends its acknowledgement) fail the smoke test.
 */
export function waitForFocusTreeDomRender(uri: string, timeoutMs = maxFocusTreeDomRenderWaitMs): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const previous = pendingRenderAcks.get(uri);
		if (previous) {
			clearTimeout(previous.timer);
			previous.reject(new Error('A newer focus-tree DOM render acknowledgement was requested.'));
		}

		const boundedTimeoutMs = Math.min(Math.max(timeoutMs, 1), maxFocusTreeDomRenderWaitMs);
		const timer = setTimeout(() => {
			pendingRenderAcks.delete(uri);
			reject(new Error(`Timed out waiting for the focus-tree webview DOM render acknowledgement for ${uri}.`));
		}, boundedTimeoutMs);
		pendingRenderAcks.set(uri, { resolve, reject, timer });
	});
}

export function hasPendingFocusTreeDomRender(uri: string): boolean {
	return pendingRenderAcks.has(uri);
}

export function cancelFocusTreeDomRenderWait(uri: string): boolean {
	const pending = pendingRenderAcks.get(uri);
	if (!pending) {
		return false;
	}

	clearTimeout(pending.timer);
	pendingRenderAcks.delete(uri);
	pending.reject(new Error(`Cancelled the focus-tree webview DOM render acknowledgement for ${uri}.`));
	return true;
}

/** Called only from the focus-tree webview message handler. */
export function acknowledgeFocusTreeDomRender(uri: string, renderedFocusIds: unknown): void {
	const pending = pendingRenderAcks.get(uri);
	if (!pending) {
		return;
	}

	clearTimeout(pending.timer);
	pendingRenderAcks.delete(uri);
	pending.resolve(renderedFocusIds);
}
