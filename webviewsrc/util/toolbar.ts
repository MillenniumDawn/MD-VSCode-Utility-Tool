// The toolbar strip every preview draws above its canvas: the codicon toggles, and the filter list
// that decides what is on the canvas at all. The decision, event and idea previews each had the
// same four pieces, differing only in element ids and in which flag answers for which entry.
//
// The rule the gating follows is the same in all three. Offering a control the file cannot use is a
// much smaller failure than hiding one it can, so a payload carrying no flags falls back to showing
// everything; and a control that is hidden is forced back to the position that changes nothing,
// without that forced value ever being written to state. The reader's own preference then returns
// the moment the file gains the thing back -- through an ordinary in-place update, no reload.

import { syncCheckbox } from "./checkbox";
import { tryRun } from "./common";
import { DivDropdown } from "./dropdown";
import { feLocalize } from "./i18n";

// Normalises a stored selection into the toolbar's own order and drops anything that is not one of
// its entries. State written by an older version -- or by nothing at all -- arrives as whatever it
// happens to be, so it is never handed to a predicate unchecked.
export function readFilterList<F extends string>(all: readonly F[], stored: unknown): F[] {
	if (!Array.isArray(stored)) {
		return [];
	}
	return all.filter((filter) => stored.includes(filter));
}

// Returns the value the toggle should hold, and puts the input and its widget in step with it. The
// widget is the input's next sibling (Checkbox.init inserts it with input.after) and the <label> was
// hidden when the widget was built, so this is one element each.
//
// While the control is offered, the value is the reader's own choice, read from the stored state
// rather than from the caller's variable: that variable may be holding a forced value from a moment
// ago, and the stored one is only ever written by a deliberate click. `neutral` doubles as the
// default -- a toggle that only shows things starts on, one that hides them starts off.
export function gateToggle(
	id: string,
	available: boolean,
	stored: boolean | undefined,
	neutral: boolean,
): boolean {
	const input = document.getElementById(id) as HTMLInputElement | null;
	const widget = input?.nextElementSibling as HTMLElement | null;
	if (widget) {
		widget.style.display = available ? "" : "none";
	}
	const value = available ? (stored ?? neutral) : neutral;
	if (input && input.checked !== value) {
		input.checked = value;
		syncCheckbox(input);
	}
	return value;
}

// Binds a preview's toggles to its rebuild. Every toggle in every preview rebuilds the canvas, so
// the rebuild is supplied once here rather than repeated at each of the five or six call sites.
//
// The bound function puts a toggle in its restored position and applies it on every click.
export function toggleBinder(
	rebuild: () => void,
): (id: string, initial: boolean, apply: (value: boolean) => void) => void {
	return (id, initial, apply) => {
		const input = document.getElementById(id) as HTMLInputElement | null;
		if (!input) {
			return;
		}
		input.checked = initial;
		// initCommon's load handler runs before this one, so the codicon checkbox over this input was
		// already built from the unrestored value and would announce a toggle that is on as unchecked.
		syncCheckbox(input);
		input.addEventListener(
			"change",
			tryRun(() => {
				apply(input.checked);
				rebuild();
			}),
		);
	};
}

export interface FilterControlOptions<F extends string> {
	selectId: string;
	containerId: string;
	// The order the list is written in, which is also the order a selection is stored and read back
	// in, so a saved selection cannot depend on the order the reader ticked the boxes.
	all: readonly F[];
	emptyKey: string;
	emptyText: string;
	onChange: (selection: F[]) => void;
}

// The toolbar's filter list. Owns the widget and the guard that tells a selection this code pushed
// into it from one the reader chose -- the two are indistinguishable at the subscription, and only
// the second is worth storing.
export class FilterControl<F extends string> {
	private dropdown: DivDropdown | undefined = undefined;
	private syncing = false;

	constructor(private readonly options: FilterControlOptions<F>) {}

	// The restored selection is pushed into the widget before the subscription is attached, so the
	// BehaviorSubject's immediate first emission -- which carries whatever the widget was built with,
	// not a choice anyone made -- cannot write an empty selection over the stored one.
	public wire(initial: F[]): void {
		const element = document.getElementById(this.options.selectId) as HTMLDivElement | null;
		if (!element) {
			return;
		}

		this.dropdown = new DivDropdown(element, true, {
			// Selecting nothing is not "no selection" here: it is the whole file, unfiltered.
			empty: feLocalize(this.options.emptyKey, this.options.emptyText),
		});

		this.syncing = true;
		try {
			this.dropdown.selectedValues$.next(initial);
			this.dropdown.selectedValues$.subscribe(
				tryRun((selection: readonly string[]) => {
					if (this.syncing) {
						return;
					}
					this.options.onChange(readFilterList(this.options.all, selection));
				}),
			);
		} finally {
			this.syncing = false;
		}
	}

	// Returns the selection that should be in force, and puts the list on screen in step with it: an
	// entry this file cannot match is hidden, which is enough for DivDropdown to stop offering it,
	// and the whole control goes when every entry is gone.
	//
	// `stored` is deliberately narrowed rather than rewritten: a stored entry with nothing left to
	// match is taken out of the working selection but never out of the stored one, or a file that
	// loses its last hidden event would empty the canvas with no control on screen to undo it.
	public gate(isAvailable: (filter: F) => boolean, stored: F[]): F[] {
		const available = this.options.all.filter(isAvailable);
		const select = document.getElementById(this.options.selectId);
		const container = document.getElementById(this.options.containerId);

		if (container) {
			container.style.display = available.length === 0 ? "none" : "";
		}
		select?.querySelectorAll(".option").forEach((option) => {
			const value = option.getAttribute("value") as F | null;
			if (value !== null && available.includes(value)) {
				option.removeAttribute("hidden");
			} else {
				option.setAttribute("hidden", "");
			}
		});

		const selection = stored.filter((filter) => available.includes(filter));
		if (this.dropdown) {
			// Pushing this back into the widget is what puts the closed combobox in step with a gating
			// that just dropped an entry, and the guard is what keeps that push out of the subscription.
			this.syncing = true;
			try {
				this.dropdown.selectedValues$.next(selection);
			} finally {
				this.syncing = false;
			}
		}
		return selection;
	}
}
