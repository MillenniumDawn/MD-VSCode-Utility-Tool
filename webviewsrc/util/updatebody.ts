// The in-place update LoaderPreview pushes when the previewed file changed: swap the payload and
// re-render, rather than reloading the whole webview, so the reader keeps their scroll and zoom.
//
// The decision, event and idea previews each listened for it with the same handler, differing only
// in three ids. The mio preview is deliberately not on this: it carries several payload keys, clamps
// a selection afterwards and does not restore scroll.

import { tryRun } from "./common";
import { vscode } from "./vscode";

export interface UpdateBodyOptions<P> {
	// The element the re-render draws into. Its absence is what says the page on screen is not the
	// one this handler can update.
	contentId: string;
	// The <style> holding the host-rendered sprite rules, which travel with the update.
	styleId: string;
	// Which key of the message's data block carries this preview's payload.
	dataKey: string;
	apply: (payload: P) => void;
	rebuild: () => void;
}

export function wireUpdateBody<P>(options: UpdateBodyOptions<P>): void {
	window.addEventListener(
		"message",
		tryRun(function (event: MessageEvent) {
			const msg = event.data;
			if (!msg || msg.type !== "updateBody") {
				return;
			}

			// Falls back to a full reload if the DOM the re-render needs is gone -- the webview may be
			// showing the error page, which has no canvas to draw into.
			if (!document.getElementById(options.contentId)) {
				vscode.postMessage({ command: "reload" });
				return;
			}

			if (typeof msg.styleCss === "string") {
				const serverStyles = document.getElementById(options.styleId);
				if (serverStyles) {
					serverStyles.textContent = msg.styleCss;
				}
			}

			const data = msg.data ?? {};
			const next = data[options.dataKey];
			if (next) {
				const scrollX = window.scrollX;
				const scrollY = window.scrollY;
				options.apply(next as P);
				options.rebuild();
				window.scrollTo(scrollX, scrollY);
			}
		}),
	);
}
