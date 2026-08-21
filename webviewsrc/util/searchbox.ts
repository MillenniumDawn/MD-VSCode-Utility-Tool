// The toolbar search every preview has: type to highlight, Enter to walk the hits, a counter that
// says where you are. The decision, event and idea previews each carried the same five functions,
// differing only in which element ids they reach for, which key they remember the query under, and
// what counts as a match.
//
// Class flipping only -- never a rebuild -- so typing stays cheap on a large file.

import { getState, setState, tryRun } from "./common";
import { feLocalize } from "./i18n";

// What the box needs from one rendered thing: something to identify it by, something to scroll to,
// and something to put the hit classes on. The two elements are separate because the tree previews
// dim the positioned wrapper on hover and highlight the card inside it, and neither should have to
// win with !important.
export interface SearchTarget {
	id: string;
	element: HTMLElement;
	highlight: HTMLElement;
}

export interface SearchBoxOptions<T> {
	boxId: string;
	countId: string;
	// Where the query is remembered, so it survives a rebuild and a reload.
	stateKey: string;
	// The localisation keys of this preview's own counter strings. Each preview has had its own pair
	// since before the box was shared, and renaming either would retire its existing translations.
	noMatchesKey: string;
	countKey: string;
	matches: (item: T, query: string) => boolean;
	target: (item: T) => SearchTarget;
}

export class SearchBox<T> {
	private query = "";
	private items: T[] = [];
	private hits: T[] = [];
	// The id of the hit Enter is parked on, not its index into hits: a rebuild can drop nodes, and
	// remembering the id keeps the cursor on the same card across a toggle change.
	private currentId: string | undefined = undefined;

	constructor(private readonly options: SearchBoxOptions<T>) {}

	// Restores the stored query and binds the box. Call before the first render, so the restored
	// query is applied by that render rather than only by the next one.
	public wire(): void {
		const box = document.getElementById(this.options.boxId) as HTMLInputElement | null;
		if (!box) {
			return;
		}
		this.query = (getState()[this.options.stateKey] ?? "").toLowerCase();
		box.value = this.query;

		const onEdit = () => {
			const next = box.value.trim().toLowerCase();
			if (next === this.query) {
				return;
			}
			this.query = next;
			// Typing highlights; Enter is what jumps. Starting over from the top on every edit keeps
			// the cursor from landing somewhere arbitrary in the new set of hits.
			this.currentId = undefined;
			setState({ [this.options.stateKey]: next });
			this.apply(false);
		};

		box.addEventListener(
			"keypress",
			tryRun((e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.preventDefault();
					this.cycle(e.shiftKey);
				} else {
					onEdit();
				}
			}),
		);
		for (const type of ["input", "change", "keyup", "paste", "cut"]) {
			box.addEventListener(type, tryRun(onEdit));
		}
	}

	// A render just replaced everything on screen: highlight the new elements, and stop the counter
	// claiming the matches of the graph that was there a moment ago.
	public refresh(items: T[]): void {
		this.items = items;
		this.apply(false);
	}

	public apply(navigate: boolean): void {
		this.hits =
			this.query === ""
				? []
				: this.items.filter((item) => this.options.matches(item, this.query));
		const hits = new Set(this.hits.map((hit) => this.options.target(hit).id));
		if (this.currentId !== undefined && !hits.has(this.currentId)) {
			this.currentId = undefined;
		}
		for (const item of this.items) {
			const target = this.options.target(item);
			target.highlight.classList.toggle("ev-hit", hits.has(target.id));
			target.highlight.classList.toggle("ev-hit-current", target.id === this.currentId);
		}
		if (navigate && this.currentId !== undefined) {
			this.scrollToHit(this.hits.find((hit) => this.options.target(hit).id === this.currentId));
		}
		this.updateCount();
	}

	private cycle(backwards: boolean): void {
		const total = this.hits.length;
		if (total === 0) {
			return;
		}
		const current = this.indexOfCurrent();
		const next =
			current < 0
				? // The first Enter lands on the first hit, the first Shift+Enter on the last.
					backwards
					? total - 1
					: 0
				: (current + (backwards ? total - 1 : 1)) % total;
		const hit = this.hits[next];
		this.currentId = hit === undefined ? undefined : this.options.target(hit).id;
		this.apply(true);
	}

	private scrollToHit(hit: T | undefined): void {
		if (hit === undefined) {
			return;
		}
		// Optional call, not a guard: jsdom leaves scrollIntoView undefined and the webview tests
		// drive this path, where a throw would be swallowed by tryRun and strand the highlight half
		// applied.
		this.options.target(hit).element.scrollIntoView?.({ block: "center", inline: "center" });
	}

	private indexOfCurrent(): number {
		return this.hits.findIndex((hit) => this.options.target(hit).id === this.currentId);
	}

	private updateCount(): void {
		const label = document.getElementById(this.options.countId);
		if (!label) {
			return;
		}
		if (this.query === "") {
			label.textContent = "";
			return;
		}
		if (this.hits.length === 0) {
			label.textContent = feLocalize(this.options.noMatchesKey, "no matches");
			return;
		}
		// Matches a filter took off the canvas are never in `items`, so this counts the ones actually
		// on screen -- which is the number Enter can walk.
		const current = this.indexOfCurrent();
		label.textContent = feLocalize(
			this.options.countKey,
			"{0}/{1}",
			current < 0 ? "-" : current + 1,
			this.hits.length,
		);
	}
}
