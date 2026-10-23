// The in-place update LoaderPreview pushes when the previewed file changed: swap the payload and
// re-render, rather than reloading the whole webview, so the reader keeps their scroll and zoom.
//
// onUpdateBody is the part every preview shares: the message check, the reload when the page on
// screen cannot take the update, and the host's stylesheet. wireUpdateBody adds the one-payload
// swap the card previews use. The MIO, technology and GFX previews carry their own data and call
// onUpdateBody directly. The focus tree's handler has no reload fallback or stylesheet, and is not
// on this.

import { tryRun } from "./common";
import { vscode } from "./vscode";

export interface UpdateBodyTarget {
	// The elements the re-render needs. A missing one is what says the page on screen is not the one
	// this handler can update.
	contentIds: string[];
	// The <style> holding the host-rendered sprite rules, which travel with the update.
	styleId: string;
}

export function onUpdateBody(
	target: UpdateBodyTarget,
	apply: (data: Record<string, any>) => void | Promise<void>,
): void {
	window.addEventListener(
		"message",
		tryRun(async function (event: MessageEvent) {
			const msg = event.data;
			if (!msg || msg.type !== "updateBody") {
				return;
			}

			// Falls back to a full reload if the DOM the re-render needs is gone -- the webview may be
			// showing the error page, which has no canvas to draw into.
			if (target.contentIds.some((id) => !document.getElementById(id))) {
				vscode.postMessage({ command: "reload" });
				return;
			}

			if (typeof msg.styleCss === "string") {
				const serverStyles = document.getElementById(target.styleId);
				if (serverStyles) {
					serverStyles.textContent = msg.styleCss;
				}
			}

			await apply(msg.data ?? {});
		}),
	);
}

export interface UpdateBodyOptions<P> {
	// The element the re-render draws into.
	contentId: string;
	styleId: string;
	// Which key of the message's data block carries this preview's payload.
	dataKey: string;
	apply: (payload: P) => void;
	rebuild: () => void;
}

export function wireUpdateBody<P>(options: UpdateBodyOptions<P>): void {
	onUpdateBody({ contentIds: [options.contentId], styleId: options.styleId }, (data) => {
		const next = data[options.dataKey];
		if (next) {
			const scrollX = window.scrollX;
			const scrollY = window.scrollY;
			options.apply(next as P);
			options.rebuild();
			window.scrollTo(scrollX, scrollY);
		}
	});
}
