import { tryRun, subscribeNavigators, initCommon, getState, setState } from "./util/common";
import { applyNav } from "./util/card";
import { gateToggle, toggleBinder } from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { wireUpdateBody } from "./util/updatebody";
import { buildGuiFrame } from "./util/guiframe";
import { normalizeForStyle } from "../src/util/styletable";
import {
	BopCard,
	BopPreviewPayload,
	BopRangeView,
	BopWindowView,
	LocText,
	activeRangeAt,
	rangeBoundaries,
} from "../src/previewdef/bop/payload";

initCommon();

const emptyPayload: BopPreviewPayload = { cards: [], hasLocalisation: false };

let payload: BopPreviewPayload =
	(window as unknown as { bopPreview?: BopPreviewPayload }).bopPreview ?? emptyPayload;

let showLocalisation: boolean = getState().showLocalisation ?? true;

// The value each BoP was left at, keyed on BopCard.key, so an edit to the file, a switch to another
// BoP of the file or a reopened panel puts every one back where the reader had it.
function storedValues(): Record<string, number> {
	const stored = getState().bopValues;
	return stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
}

function storeValue(key: string, value: number): void {
	setState({ bopValues: { ...storedValues(), [key]: value } });
}

export function clampValue(value: number): number {
	if (isNaN(value)) {
		return 0;
	}
	// Rounded so a run of +0.05 clicks lands on 0.3, not 0.30000000000000004.
	return Math.round(Math.min(1, Math.max(-1, value)) * 1000) / 1000;
}

function textFor(loc: LocText): string {
	return showLocalisation ? loc.text : loc.key;
}

function formatValue(value: number): string {
	return (value > 0 ? "+" : "") + value.toFixed(2);
}

// The widest a window is drawn; the game's is 550 pixels, so it is shown unscaled.
const windowMaxWidth = 738;

// The BoP of the file on screen: which one the dropdown picks, keyed like the stored values so a
// BoP added above it in the file does not change the selection.
function selectedCard(): BopCard | undefined {
	const key = getState().selectedBop;
	return payload.cards.find((c) => c.key === key) ?? payload.cards[0];
}

// The parts of the game window the game's code moves with the value, looked up once per build.
interface WindowSlots {
	window: BopWindowView;
	title?: HTMLElement;
	activeRange?: HTMLElement;
	needle?: HTMLElement;
	fills: Record<string, HTMLElement>;
	marks: { value: number; indicators: HTMLElement[] }[];
}

function slotsOf(frame: HTMLElement, card: BopCard, window: BopWindowView): WindowSlots {
	const fills: Record<string, HTMLElement> = {};
	for (const fill of Array.from(frame.querySelectorAll<HTMLElement>(".bop-slot-fill"))) {
		const variant = Array.from(fill.classList).find((c) => c.startsWith("bop-slot-fill-"));
		if (variant) {
			fills[variant.substring("bop-slot-fill-".length)] = fill;
		}
	}

	// A tick at every inner range boundary, the way the game copies range_bar and range_indicator
	// onto the bar.
	const marks: WindowSlots["marks"] = [];
	const layer = frame.querySelector<HTMLElement>(".bop-slot-marks");
	if (layer) {
		for (const value of rangeBoundaries(card.ranges)) {
			const mark = document.createElement("div");
			mark.className = "bop-mark";
			mark.style.transform = `translate(${barX(window, value)}px, ${window.bar.y}px)`;
			mark.innerHTML = window.splitterHtml ?? "";
			const indicators: HTMLElement[] = [];
			for (const [frameIndex, html] of (window.indicatorHtml ?? []).entries()) {
				const indicator = document.createElement("div");
				indicator.className = "bop-mark bop-mark-indicator bop-mark-indicator-" + frameIndex;
				indicator.innerHTML = html;
				mark.appendChild(indicator);
				indicators.push(indicator);
			}
			linkRange(mark, rangeAtTick(card.ranges, value));
			layer.appendChild(mark);
			marks.push({ value, indicators });
		}
	}

	return {
		window,
		title: frame.querySelector<HTMLElement>(".bop-slot-title") ?? undefined,
		activeRange: frame.querySelector<HTMLElement>(".bop-slot-active-range") ?? undefined,
		needle: frame.querySelector<HTMLElement>(".bop-slot-needle") ?? undefined,
		fills,
		marks,
	};
}

// The range a tick at `value` opens: of the two it separates, the one further from the centre,
// which is the one the value enters when it moves out past the tick.
function rangeAtTick(ranges: BopRangeView[], value: number): BopRangeView | undefined {
	const near = (a: number) => Math.abs(a - value) < 1e-6;
	return (
		ranges.find((r) => (value < 0 ? near(r.max) : near(r.min))) ??
		ranges.find((r) => near(r.min) || near(r.max))
	);
}

// Makes `element` open `range` in the previewed file, with the hover box that says it can be
// clicked. The only links the preview has.
function linkRange(element: HTMLElement, range: BopRangeView | undefined): void {
	applyNav(element, range?.nav);
	element.classList.toggle("bop-range-link", range?.nav !== undefined);
}

// Where `value` sits on the bar, in the window's own pixels.
function barX(window: BopWindowView, value: number): number {
	return window.bar.x + ((clampValue(value) + 1) / 2) * window.bar.width;
}

function rangeText(range: BopRangeView | undefined, value: number): string {
	return range
		? textFor(range.name)
		: feLocalize("boppreview.norange", "No range covers {0}.", formatValue(value));
}

// Moves the parts of the window the game's code moves: the needle, the fill between the centre and
// the value (the arrow variant when the value last moved towards that side), the lit indicators at
// the active range's edges, and the active range's name.
function drawValue(
	slots: WindowSlots,
	value: number,
	direction: number,
	range: BopRangeView | undefined,
): void {
	const { window } = slots;
	if (slots.needle) {
		slots.needle.style.transform = `translate(${barX(window, value)}px, ${window.bar.y}px)`;
	}

	const side = value < 0 ? "left" : value > 0 ? "right" : undefined;
	const moving = side !== undefined && Math.sign(direction) === Math.sign(value);
	const shown = side && (moving && slots.fills[side + "-moving"] ? side + "-moving" : side);
	const percent = ((value + 1) / 2) * 100;
	for (const [variant, fill] of Object.entries(slots.fills)) {
		fill.classList.toggle("bop-shown", variant === shown);
		fill.style.clipPath =
			side === "left" ? `inset(0 50% 0 ${percent}%)` : `inset(0 ${100 - percent}% 0 50%)`;
	}

	for (const mark of slots.marks) {
		const lit =
			range !== undefined &&
			(Math.abs(mark.value - range.min) < 1e-6 || Math.abs(mark.value - range.max) < 1e-6);
		mark.indicators[0]?.classList.toggle("bop-shown", !lit || mark.indicators.length < 2);
		mark.indicators[1]?.classList.toggle("bop-shown", lit);
	}

	if (slots.activeRange) {
		slots.activeRange.textContent = rangeText(range, value);
		linkRange(slots.activeRange, range);
	}
}

// What is on screen: the BoP, its window's slots (or the plain line standing in for a window that
// was not found), and where its value is.
interface Shown {
	card: BopCard;
	slots?: WindowSlots;
	fallback?: HTMLElement;
	value: number;
}

let shown: Shown | undefined;

function control<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

// `direction` is which way the value last moved, which picks the game's arrow fill; a reset, a
// switch of BoP and the first draw have none.
function setValue(value: number, direction: number): void {
	if (!shown) {
		return;
	}
	shown.value = clampValue(value);
	const slider = control<HTMLInputElement>("bop-slider");
	const number = control<HTMLInputElement>("bop-number");
	if (slider) {
		slider.value = String(shown.value);
	}
	if (number) {
		number.value = String(shown.value);
	}

	const range = activeRangeAt(shown.card.ranges, shown.value);
	if (shown.slots) {
		drawValue(shown.slots, shown.value, direction, range);
	} else if (shown.fallback) {
		shown.fallback.textContent = rangeText(range, shown.value);
		linkRange(shown.fallback, range);
	}
	subscribeNavigators();
}

// A value only becomes the reader's, and is stored, once they move it.
function update(value: number, direction?: number): void {
	if (!shown) {
		return;
	}
	setValue(value, direction ?? clampValue(value) - shown.value);
	storeValue(shown.card.key, shown.value);
}

function syncToolbar(card: BopCard | undefined): void {
	const select = control<HTMLSelectElement>("bops");
	if (select) {
		select.replaceChildren(
			...payload.cards.map((c) => {
				const option = document.createElement("option");
				option.value = c.key;
				const title = textFor(c.title);
				option.textContent = title === c.id ? c.id : `(${c.id}) ${title}`;
				return option;
			}),
		);
		if (card) {
			select.value = card.key;
		}
	}
	const container = control<HTMLElement>("bop-select-container");
	if (container) {
		container.style.display = payload.cards.length > 1 ? "block" : "none";
	}

	const reset = control<HTMLElement>("bop-reset");
	if (reset && card) {
		reset.title = formatValue(card.initialValue);
	}
	for (const id of ["bop-slider", "bop-number"]) {
		const input = control<HTMLInputElement>(id);
		if (input) {
			input.disabled = card === undefined;
		}
	}
}

function buildContent(): void {
	const content = document.getElementById("boppreviewcontent");
	if (!content) {
		return;
	}
	showLocalisation = gateToggle("show-localisation", payload.hasLocalisation, getState().showLocalisation, true);

	content.replaceChildren();
	shown = undefined;
	const card = selectedCard();
	syncToolbar(card);

	if (!card) {
		const empty = document.createElement("div");
		empty.className = "bop-none";
		empty.textContent = feLocalize("boppreview.empty", "No balance of power in this file.");
		content.appendChild(empty);
		return;
	}

	// The game's window, or, without one, just the name of the active range.
	shown = { card, value: clampValue(storedValues()[card.key] ?? card.initialValue) };
	if (card.window) {
		const frame = buildGuiFrame(card.window.html, windowMaxWidth, "bop-gui-frame");
		content.appendChild(frame);
		shown.slots = slotsOf(frame, card, card.window);
		if (shown.slots.title) {
			shown.slots.title.textContent = textFor(card.title);
		}
		for (const { id, text } of card.window.texts) {
			const element = frame.querySelector<HTMLElement>(".bop-slot-text-" + normalizeForStyle(id));
			if (element) {
				element.textContent = textFor(text);
			}
		}
		fillDecisions(frame, card);
	} else {
		shown.fallback = document.createElement("div");
		shown.fallback.className = "bop-none";
		content.appendChild(shown.fallback);
		content.appendChild(decisionList(card));
	}

	// Under the window, where they do not push it down the page.
	for (const warning of card.warnings) {
		const row = document.createElement("div");
		row.className = "bop-warning";
		row.textContent = warning;
		content.appendChild(row);
	}

	setValue(shown.value, 0);
}

// Names the rows the host drew in the window's decision list, and makes each open its decision.
function fillDecisions(frame: HTMLElement, card: BopCard): void {
	for (const row of Array.from(frame.querySelectorAll<HTMLElement>(".bop-decision"))) {
		const decision = card.decisions[parseInt(row.dataset.index ?? "", 10)];
		if (!decision) {
			continue;
		}
		const name = row.querySelector<HTMLElement>(".bop-decision-name");
		if (name) {
			name.textContent = textFor(decision.name);
		}
		row.title = decision.id;
		applyNav(row, decision.nav, true);
	}
}

// Without the game's window, the category's decisions as a plain list of links.
function decisionList(card: BopCard): HTMLElement {
	const list = document.createElement("div");
	list.className = "bop-decision-list";
	for (const decision of card.decisions) {
		const row = document.createElement("div");
		row.className = "bop-decision";
		row.textContent = textFor(decision.name);
		row.title = decision.id;
		applyNav(row, decision.nav, true);
		list.appendChild(row);
	}
	return list;
}

// The toolbar's controls live outside #boppreviewcontent, so they are bound once, here, and always
// act on the BoP on screen.
function bindControls(): void {
	for (const button of Array.from(document.querySelectorAll<HTMLElement>(".bop-step"))) {
		const step = parseFloat(button.dataset.step ?? "0");
		button.addEventListener("click", tryRun(() => shown && update(shown.value + step)));
	}
	const slider = control<HTMLInputElement>("bop-slider");
	slider?.addEventListener("input", tryRun(() => update(parseFloat(slider.value))));
	const number = control<HTMLInputElement>("bop-number");
	number?.addEventListener("change", tryRun(() => update(parseFloat(number.value))));
	control<HTMLElement>("bop-reset")?.addEventListener(
		"click",
		tryRun(() => shown && update(shown.card.initialValue, 0)),
	);
	const select = control<HTMLSelectElement>("bops");
	select?.addEventListener(
		"change",
		tryRun(() => {
			setState({ selectedBop: select.value });
			buildContent();
		}),
	);
}

const bindToggle = toggleBinder(buildContent);

wireUpdateBody<BopPreviewPayload>({
	contentId: "boppreviewcontent",
	styleId: "bop-server-styles",
	dataKey: "bopPreview",
	apply: (next) => {
		payload = next;
	},
	rebuild: buildContent,
});

window.addEventListener(
	"load",
	tryRun(function () {
		bindToggle("show-localisation", showLocalisation, (value) => {
			showLocalisation = value;
			setState({ showLocalisation: value });
		});
		bindControls();
		buildContent();
	}),
);

// Exported for the tests, which drive the preview without a load event.
export { buildContent };
