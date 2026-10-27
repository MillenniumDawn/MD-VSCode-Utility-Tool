// The primitives the previews build their cards out of: the little pill under a title, the
// attributes that make a card jump to the line it was read from, and the modifier lists. The
// previews each had their own copy of these.

import { ModifierGroup, ModifierLine, NavTarget } from "../../src/previewdef/sharedpayload";

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

// The modifier lists on a character or idea card. `prefix` is the page's class prefix: the two pages
// style their lists apart.
type CardPrefix = "char" | "idea";

export function modifierLineToDom(prefix: CardPrefix, line: ModifierLine): HTMLDivElement {
	const row = document.createElement("div");
	row.className = `${prefix}-mod`;

	const name = document.createElement("span");
	name.className = `${prefix}-mod-name`;
	name.textContent = line.name;
	// The token the file was written with, for a reader who has to go and find it.
	name.title = line.key;
	row.appendChild(name);

	const value = document.createElement("span");
	value.className = `${prefix}-mod-value ${prefix}-mod-${line.tone}`;
	value.textContent = line.value;
	row.appendChild(value);

	return row;
}

export function modifierSection(
	prefix: CardPrefix,
	title: string | undefined,
	lines: ModifierLine[],
): HTMLDivElement | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const box = document.createElement("div");
	box.className = `${prefix}-mods`;
	if (title !== undefined) {
		const head = document.createElement("div");
		head.className = `${prefix}-mods-head`;
		head.textContent = title;
		box.appendChild(head);
	}
	for (const line of lines) {
		box.appendChild(modifierLineToDom(prefix, line));
	}
	return box;
}

export function appendGroups(prefix: CardPrefix, container: HTMLElement, groups: ModifierGroup[]): void {
	for (const group of groups) {
		const section = modifierSection(prefix, group.title, group.lines);
		if (section) {
			container.appendChild(section);
		}
	}
}
