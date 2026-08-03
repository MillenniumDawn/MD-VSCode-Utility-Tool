import {
	setState,
	getState,
	tryRun,
	initCommon,
	subscribeNavigators,
} from "./util/common";
import { vscode } from "./util/vscode";

initCommon();

function filterChange(text: string) {
	text = text.toLowerCase();
	const elements = document.getElementsByClassName("spriteTypePreview");
	setState({ filter: text });

	for (let i = 0; i < elements.length; i++) {
		const element = elements[i] as HTMLDivElement;
		element.style.display =
			text.length === 0 || element.id.toLowerCase().includes(text)
				? "inline-block"
				: "none";
	}
}

// In-place update pushed by UpdateablePreviewBase when the .gfx file changed: swap only the sprite
// list markup, so the filter bar, scroll and the filter input's listeners survive. The fresh nodes
// need their .navigator click handlers re-bound and the current filter re-applied. Falls back to a
// full reload if the DOM the swap needs is gone (e.g. the webview shows the error page, which has no
// listener).
window.addEventListener(
	"message",
	tryRun((event: MessageEvent) => {
		const msg = event.data;
		if (!msg || msg.type !== "updateBody") {
			return;
		}

		const imageList = document.getElementById(
			"gfx-image-list",
		) as HTMLDivElement | null;
		if (!imageList) {
			vscode.postMessage({ command: "reload" });
			return;
		}

		if (typeof msg.styleCss === "string") {
			const serverStyles = document.getElementById("gfx-server-styles");
			if (serverStyles) {
				serverStyles.textContent = msg.styleCss;
			}
		}

		const data = msg.data ?? {};
		if (typeof data.contentHtml === "string") {
			imageList.innerHTML = data.contentHtml;
			subscribeNavigators();
			filterChange(getState().filter || "");
		}
	}),
);

window.addEventListener(
	"load",
	tryRun(function () {
		const filter = getState().filter || "";
		const element = document.getElementById("filter") as HTMLInputElement;
		element.value = filter;
		filterChange(filter);

		const changeFunc = function (this: HTMLInputElement) {
			filterChange(this.value);
		};

		element.addEventListener("change", changeFunc);
		element.addEventListener("keypress", changeFunc);
		element.addEventListener("keyup", changeFunc);
		element.addEventListener("paste", changeFunc);
		element.addEventListener("cut", changeFunc);
	}),
);
