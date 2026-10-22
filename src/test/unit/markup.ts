import { JSDOM } from "jsdom";

// Every element of a fragment with the names of its attributes, as a browser parses it. Two
// renderings that differ only in a mod's text come out equal, and one that lets the text open an
// element or an attribute does not.
export function shape(fragment: string): string[] {
	const { document } = new JSDOM(`<!DOCTYPE html><body>${fragment}</body>`).window;
	return [...document.body.querySelectorAll("*")].map(
		(element) => `${element.localName}[${element.getAttributeNames().sort().join(",")}]`,
	);
}
