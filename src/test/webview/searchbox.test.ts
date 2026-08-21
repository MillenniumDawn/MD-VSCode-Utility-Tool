import "./setup";
import * as assert from "assert";
import { SearchBox } from "../../../webviewsrc/util/searchbox";
import { getState } from "../../../webviewsrc/util/common";

// One thing on the canvas, as far as the box is concerned: something to identify it by, something to
// scroll to and something to hang the hit classes on.
interface Item {
	id: string;
	name: string;
	element: HTMLDivElement;
}

const shellHtml = `
	<input type="text" id="test-searchbox">
	<span id="test-search-count"></span>`;

describe("webview/util/searchbox", () => {
	let previousBody = "";
	let items: Item[] = [];

	before(() => {
		previousBody = document.body.innerHTML;
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	beforeEach(() => {
		document.body.innerHTML = shellHtml;
		items = ["alpha", "beta", "gamma", "alphabet"].map((name) => {
			const element = document.createElement("div");
			element.textContent = name;
			document.body.appendChild(element);
			return { id: name, name, element };
		});
	});

	function makeBox(stateKey = "testSearchQuery"): SearchBox<Item> {
		return new SearchBox<Item>({
			boxId: "test-searchbox",
			countId: "test-search-count",
			stateKey,
			noMatchesKey: "test.nomatches",
			countKey: "test.searchmatches",
			matches: (item, query) => item.name.includes(query),
			target: (item) => ({ id: item.id, element: item.element, highlight: item.element }),
		});
	}

	const input = () => document.getElementById("test-searchbox") as HTMLInputElement;
	const count = () => document.getElementById("test-search-count")!.textContent;
	const hits = () => items.filter((i) => i.element.classList.contains("ev-hit")).map((i) => i.id);
	const current = () =>
		items.find((i) => i.element.classList.contains("ev-hit-current"))?.id;

	function type(text: string): void {
		input().value = text;
		input().dispatchEvent(new (window as any).Event("input"));
	}

	function enter(shift = false): void {
		input().dispatchEvent(
			new (window as any).KeyboardEvent("keypress", { key: "Enter", shiftKey: shift }),
		);
	}

	it("highlights every match and leaves the rest alone", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);

		type("alpha");

		assert.deepStrictEqual(hits(), ["alpha", "alphabet"]);
		// Typing highlights; Enter is what jumps, so nothing is the cursor yet.
		assert.strictEqual(current(), undefined);
		assert.strictEqual(count(), "-/2");
	});

	it("says so when nothing matches, and says nothing at all when the box is empty", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);

		type("nothing here");
		assert.deepStrictEqual(hits(), []);
		assert.strictEqual(count(), "no matches");

		type("");
		assert.deepStrictEqual(hits(), []);
		assert.strictEqual(count(), "");
	});

	it("walks the hits with Enter and wraps at the end", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("alpha");

		enter();
		assert.strictEqual(current(), "alpha");
		assert.strictEqual(count(), "1/2");

		enter();
		assert.strictEqual(current(), "alphabet");
		assert.strictEqual(count(), "2/2");

		enter();
		assert.strictEqual(current(), "alpha");
		assert.strictEqual(count(), "1/2");
	});

	// The first Enter lands on the first hit, the first Shift+Enter on the last.
	it("walks backwards with Shift+Enter", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("alpha");

		enter(true);
		assert.strictEqual(current(), "alphabet");
		assert.strictEqual(count(), "2/2");

		enter(true);
		assert.strictEqual(current(), "alpha");
		assert.strictEqual(count(), "1/2");
	});

	it("does nothing on Enter when there is nothing to walk", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("nothing here");

		enter();
		assert.strictEqual(current(), undefined);
		assert.strictEqual(count(), "no matches");
	});

	// A rebuild is what a toggle or a filter change does. The cursor is remembered by id rather than
	// by index precisely so that it can survive one -- and be released when it cannot.
	it("keeps the cursor on the same item across a rebuild", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("alpha");
		enter();
		enter();
		assert.strictEqual(current(), "alphabet");

		search.refresh([...items].reverse());

		assert.strictEqual(current(), "alphabet");
		assert.strictEqual(count(), "1/2");
	});

	it("releases the cursor when the rebuild dropped what it was parked on", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("alpha");
		enter();
		assert.strictEqual(current(), "alpha");

		// A rebuild replaces the elements outright in a real preview, so only what it kept is looked
		// at here: an element that is no longer on the page keeps whatever classes it died with.
		const kept = items.filter((item) => item.id !== "alpha");
		search.refresh(kept);

		assert.strictEqual(
			kept.find((item) => item.element.classList.contains("ev-hit-current"))?.id,
			undefined,
		);
		assert.deepStrictEqual(
			kept.filter((item) => item.element.classList.contains("ev-hit")).map((item) => item.id),
			["alphabet"],
		);
		assert.strictEqual(count(), "-/1");
	});

	// Nothing on screen, but the counter must stop claiming the matches of what was there a moment
	// ago -- the case the idea preview used to get wrong.
	it("empties the counter when the rebuild left nothing on screen", () => {
		const search = makeBox();
		search.wire();
		search.refresh(items);
		type("alpha");
		assert.strictEqual(count(), "-/2");

		search.refresh([]);

		assert.strictEqual(count(), "no matches");
	});

	it("remembers the query, so a rebuilt page comes back with it applied", () => {
		const first = makeBox("rememberedQuery");
		first.wire();
		first.refresh(items);
		type("BETA");

		assert.strictEqual(getState().rememberedQuery, "beta");

		// A fresh box over a fresh page, the way a reopened preview arrives.
		document.body.innerHTML = shellHtml;
		const second = makeBox("rememberedQuery");
		second.wire();
		second.refresh(items);

		assert.strictEqual(input().value, "beta");
		assert.deepStrictEqual(hits(), ["beta"]);
	});

	it("is a no-op when the page has no search box", () => {
		document.body.innerHTML = "";
		const search = makeBox();
		assert.doesNotThrow(() => search.wire());
		assert.doesNotThrow(() => search.refresh(items));
	});
});
