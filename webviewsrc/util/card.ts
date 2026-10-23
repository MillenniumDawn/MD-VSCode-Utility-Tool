// The two primitives every card in every preview is built out of: the little pill under a title,
// and the attributes that make a card jump to the line it was read from. The decision, event and
// idea previews each had their own byte-identical copy of both.

import { NavTarget } from "../../src/previewdef/sharedpayload";

// One pill in a card's meta row. `className` is the tone on top of the base class, or "" for the
// plain one.
export function badge(container: HTMLElement, className: string, text: string): void {
	const element = document.createElement("span");
	element.className = "ev-badge" + (className ? " " + className : "");
	element.textContent = text;
	container.appendChild(element);
}

// Marks an element as something subscribeNavigators can wire up, carrying the range and file it
// should open. A node with nowhere to go is left alone rather than made clickable.
export function applyNav(element: HTMLElement, nav: NavTarget | undefined): void {
	if (!nav) {
		return;
	}
	element.classList.add("navigator");
	element.setAttribute("start", String(nav.start));
	element.setAttribute("end", String(nav.end));
	element.setAttribute("file", nav.file);
}
