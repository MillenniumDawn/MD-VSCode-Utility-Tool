import {
	setState,
	getState,
	tryRun,
	initCommon,
	subscribeNavigators,
} from "./util/common";
import { onUpdateBody } from "./util/updatebody";

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
// need their .navigator click handlers re-bound and the current filter re-applied.
onUpdateBody({ contentIds: ["gfx-image-list"], styleId: "gfx-server-styles" }, (data) => {
	if (typeof data.contentHtml === "string") {
		(document.getElementById("gfx-image-list") as HTMLDivElement).innerHTML = data.contentHtml;
		subscribeNavigators();
		filterChange(getState().filter || "");
	}
});

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

		element.addEventListener("input", changeFunc);
		element.addEventListener("change", changeFunc);
	}),
);
