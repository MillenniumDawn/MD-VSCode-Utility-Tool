import { tryRun, subscribeNavigators, initCommon, getState, setState } from "./util/common";
import { applyNav, badge } from "./util/card";
import { gateToggle, toggleBinder } from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { wireUpdateBody } from "./util/updatebody";
import {
	BopCard,
	BopPreviewPayload,
	BopRangeView,
	BopSideView,
	LocText,
	ModifierLine,
	activeRangeAt,
} from "../src/previewdef/bop/payload";

initCommon();

const emptyPayload: BopPreviewPayload = { cards: [], hasLocalisation: false };

let payload: BopPreviewPayload =
	(window as unknown as { bopPreview?: BopPreviewPayload }).bopPreview ?? emptyPayload;

let showLocalisation: boolean = getState().showLocalisation ?? true;

// The value each card's slider was left at, keyed on BopCard.key, so an edit to the file or a
// reopened panel puts every bar back where the reader had it.
function storedValues(): Record<string, number> {
	const stored = getState().bopValues;
	return stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
}

function storeValue(key: string, value: number): void {
	setState({ bopValues: { ...storedValues(), [key]: value } });
}

// The steps Millennium Dawn's add_power_balance_value calls use most.
const steps = [-0.1, -0.05, 0.05, 0.1];

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

// Where `value` sits along the bar, as a percentage from its left end.
function percentOf(value: number): number {
	return ((clampValue(value) + 1) / 2) * 100;
}

function formatValue(value: number): string {
	return (value > 0 ? "+" : "") + value.toFixed(2);
}

export function modifierLineToDom(line: ModifierLine): HTMLDivElement {
	const row = document.createElement("div");
	row.className = "bop-mod";

	const name = document.createElement("span");
	name.className = "bop-mod-name";
	name.textContent = line.name;
	name.title = line.key;
	row.appendChild(name);

	const value = document.createElement("span");
	value.className = "bop-mod-value bop-mod-" + line.tone;
	value.textContent = line.value;
	row.appendChild(value);

	return row;
}

// A range's modifiers, its custom tooltips and whether it runs effects, as the game lists them
// under the active range's name.
function rangeDetails(range: BopRangeView): HTMLDivElement {
	const box = document.createElement("div");
	box.className = "bop-range-details";

	for (const line of range.modifiers) {
		box.appendChild(modifierLineToDom(line));
	}
	for (const tooltip of range.tooltips) {
		const row = document.createElement("div");
		row.className = "bop-tooltip";
		row.textContent = textFor(tooltip);
		box.appendChild(row);
	}

	const meta = document.createElement("div");
	meta.className = "ev-meta bop-range-meta";
	if (range.hasOnActivate) {
		badge(meta, "", feLocalize("boppreview.onactivate", "on_activate"));
	}
	if (range.hasOnDeactivate) {
		badge(meta, "", feLocalize("boppreview.ondeactivate", "on_deactivate"));
	}
	if (meta.childElementCount > 0) {
		box.appendChild(meta);
	}

	if (box.childElementCount === 0) {
		const none = document.createElement("div");
		none.className = "bop-none";
		none.textContent = feLocalize("boppreview.nomodifiers", "No modifiers");
		box.appendChild(none);
	}

	return box;
}

function rangeTitle(range: BopRangeView): HTMLDivElement {
	const head = document.createElement("div");
	head.className = "bop-range-head";

	const name = document.createElement("span");
	name.className = "bop-range-name";
	name.textContent = textFor(range.name);
	name.title = range.id;
	applyNav(name, range.nav);
	head.appendChild(name);

	const span = document.createElement("span");
	span.className = "bop-range-span";
	span.textContent = `${formatValue(range.min)} … ${formatValue(range.max)}`;
	head.appendChild(span);

	return head;
}

function sideToDom(side: BopSideView | undefined, which: "left" | "right"): HTMLDivElement {
	const element = document.createElement("div");
	element.className = "bop-side bop-side-" + which;
	if (!side) {
		return element;
	}
	applyNav(element, side.nav);

	const icon = document.createElement("div");
	icon.className = "bop-icon" + (side.icon ? " " + side.icon.styleKey : " bop-icon-missing");
	icon.title = side.iconName ?? "";
	element.appendChild(icon);

	const name = document.createElement("div");
	name.className = "bop-side-name";
	name.textContent = textFor(side.name);
	name.title = side.id;
	element.appendChild(name);

	return element;
}

interface RenderedCard {
	card: BopCard;
	element: HTMLDivElement;
	setValue: (value: number) => void;
}

let rendered: RenderedCard[] = [];

function buildCard(card: BopCard, initial: number): RenderedCard {
	const element = document.createElement("div");
	element.className = "ev-card bop-card";
	element.dataset.key = card.key;

	const head = document.createElement("div");
	head.className = "ev-head";
	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = card.id;
	applyNav(id, card.nav);
	text.appendChild(id);
	const title = textFor(card.title);
	if (title !== card.id) {
		const sub = document.createElement("div");
		sub.className = "ev-sub bop-title";
		sub.textContent = title;
		text.appendChild(sub);
	}
	head.appendChild(text);
	element.appendChild(head);

	if (card.category) {
		const meta = document.createElement("div");
		meta.className = "ev-meta";
		badge(meta, "", textFor(card.category));
		element.appendChild(meta);
	}

	for (const warning of card.warnings) {
		const row = document.createElement("div");
		row.className = "bop-warning";
		row.textContent = warning;
		element.appendChild(row);
	}

	// The bar, between the two side icons, as the game draws it.
	const barRow = document.createElement("div");
	barRow.className = "bop-bar-row";
	barRow.appendChild(sideToDom(card.left, "left"));

	const bar = document.createElement("div");
	bar.className = "bop-bar";
	const segments: { range: BopRangeView; element: HTMLDivElement }[] = [];
	for (const range of card.ranges) {
		const segment = document.createElement("div");
		segment.className = "bop-segment bop-segment-" + range.side;
		const left = percentOf(range.min);
		segment.style.left = left + "%";
		segment.style.width = Math.max(0, percentOf(range.max) - left) + "%";
		segment.title = `${textFor(range.name)} (${formatValue(range.min)} … ${formatValue(range.max)})`;
		applyNav(segment, range.nav);
		bar.appendChild(segment);
		segments.push({ range, element: segment });
	}
	const needle = document.createElement("div");
	needle.className = "bop-needle";
	bar.appendChild(needle);
	barRow.appendChild(bar);

	barRow.appendChild(sideToDom(card.right, "right"));
	element.appendChild(barRow);

	// The controls to move the value, standing in for add_power_balance_value.
	const controls = document.createElement("div");
	controls.className = "bop-controls";
	const slider = document.createElement("input");
	slider.type = "range";
	slider.className = "bop-slider";
	slider.min = "-1";
	slider.max = "1";
	slider.step = "0.01";
	const number = document.createElement("input");
	number.type = "number";
	number.className = "bop-number";
	number.min = "-1";
	number.max = "1";
	number.step = "0.01";

	const stepButton = (step: number) => {
		const button = document.createElement("button");
		button.className = "bop-step";
		button.textContent = (step > 0 ? "+" : "") + step;
		button.addEventListener("click", tryRun(() => setValue(current + step)));
		return button;
	};

	for (const step of steps.filter((s) => s < 0)) {
		controls.appendChild(stepButton(step));
	}
	controls.appendChild(slider);
	for (const step of steps.filter((s) => s > 0)) {
		controls.appendChild(stepButton(step));
	}
	controls.appendChild(number);
	const reset = document.createElement("button");
	reset.className = "bop-reset";
	reset.textContent = feLocalize("boppreview.reset", "Reset to initial_value");
	reset.title = formatValue(card.initialValue);
	reset.addEventListener("click", tryRun(() => setValue(card.initialValue)));
	controls.appendChild(reset);
	element.appendChild(controls);

	slider.addEventListener("input", tryRun(() => setValue(parseFloat(slider.value))));
	number.addEventListener("change", tryRun(() => setValue(parseFloat(number.value))));

	// The range the value falls in, and what it grants.
	const active = document.createElement("div");
	active.className = "bop-active";
	element.appendChild(active);

	// Every range, so the whole balance can be read without walking the slider across it.
	const all = document.createElement("details");
	all.className = "bop-all";
	const summary = document.createElement("summary");
	summary.textContent = feLocalize("boppreview.allranges", "All ranges ({0})", card.ranges.length);
	all.appendChild(summary);
	for (const range of card.ranges) {
		all.appendChild(rangeBlock(range));
	}
	for (const side of card.extraSides) {
		const sideHead = document.createElement("div");
		sideHead.className = "bop-extra-side";
		sideHead.textContent = feLocalize("boppreview.extraside", "Side {0} (not on the bar)", textFor(side.name));
		applyNav(sideHead, side.nav);
		all.appendChild(sideHead);
		for (const range of side.ranges) {
			all.appendChild(rangeBlock(range));
		}
	}
	element.appendChild(all);

	let current = clampValue(initial);

	function setValue(value: number): void {
		current = clampValue(value);
		slider.value = String(current);
		number.value = String(current);
		needle.style.left = percentOf(current) + "%";
		needle.title = formatValue(current);

		const range = activeRangeAt(card.ranges, current);
		for (const segment of segments) {
			segment.element.classList.toggle("bop-segment-active", segment.range === range);
		}

		active.replaceChildren();
		if (range) {
			active.appendChild(rangeTitle(range));
			active.appendChild(rangeDetails(range));
		} else {
			const none = document.createElement("div");
			none.className = "bop-none";
			none.textContent = feLocalize("boppreview.norange", "No range covers {0}.", formatValue(current));
			active.appendChild(none);
		}
		subscribeNavigators();
	}

	// Positions the needle and fills the active panel. The store is left alone: a value only
	// becomes the reader's once they move it.
	setValue(current);

	return {
		card,
		element,
		setValue: (value) => {
			setValue(value);
			storeValue(card.key, current);
		},
	};
}

function rangeBlock(range: BopRangeView): HTMLDivElement {
	const block = document.createElement("div");
	block.className = "bop-range bop-range-" + range.side;
	block.appendChild(rangeTitle(range));
	block.appendChild(rangeDetails(range));
	return block;
}

function buildContent(): void {
	const content = document.getElementById("boppreviewcontent");
	if (!content) {
		return;
	}
	showLocalisation = gateToggle("show-localisation", payload.hasLocalisation, getState().showLocalisation, true);

	content.replaceChildren();
	rendered = [];
	const values = storedValues();

	if (payload.cards.length === 0) {
		const empty = document.createElement("div");
		empty.className = "bop-none";
		empty.textContent = feLocalize("boppreview.empty", "No balance of power in this file.");
		content.appendChild(empty);
	}

	for (const card of payload.cards) {
		const item = buildCard(card, values[card.key] ?? card.initialValue);
		content.appendChild(item.element);
		rendered.push(item);
	}

	subscribeNavigators();
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
		buildContent();
	}),
);

// Exported for the tests, which drive the cards without a load event.
export { buildContent, rendered };
