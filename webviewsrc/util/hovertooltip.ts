// The panel that opens beside a card when the pointer rests on the dot saying it has effects. The
// decision and event previews drew the same panel, placed it the same way and tore it down the same
// way, out of two copies that differed only in a marker class and four pixel constants.

import { EffectTreeNode } from "../../src/previewdef/sharedpayload";
import { currentScale, panning$ } from "./common";
import { effectsToDom } from "./conditiontree";

// One headed block in the panel. An event has two of them -- what it does before the card is shown
// and what it does once it is dismissed -- an option has one, and a decision has one per effect
// block it declares.
export interface TooltipSection {
	head: string;
	effects: EffectTreeNode[];
}

export interface EffectTooltipOptions {
	// Marker class on the panel. It is appended to <body>, outside the canvas, so a re-render has to
	// be able to find and sweep any that were stranded by replacing their host node mid-hover.
	className: string;
	// The fixed toolbar strip is drawn above the panel, so anything put under it would simply be
	// invisible. Each preview mirrors the height its own content builder sizes the strip with.
	toolbarHeight: number;
	// Between the card and the panel, and from the edge of the window.
	gap: number;
	margin: number;
}

// Long enough that panning the pointer across a column does not flash a panel per card.
const hoverDelay = 150;

// Popups are appended to <body>, so they are placed in viewport coordinates by hand rather than by
// the layout, which is what makes the toolbar a thing they have to be kept clear of.
export function clampBelowToolbar(top: number, toolbarHeight: number, margin: number): number {
	return Math.max(toolbarHeight + margin, top);
}

export function wireEffectTooltip(
	host: HTMLDivElement,
	sections: TooltipSection[],
	options: EffectTooltipOptions,
): void {
	let panel: HTMLDivElement | undefined = undefined;
	let timer: number | undefined = undefined;

	host.addEventListener("mouseenter", () => {
		if (panning$.value) {
			return;
		}
		timer = window.setTimeout(() => {
			timer = undefined;
			// The card can be gone by the time the delay is up: a re-render replaces every card, and
			// the pointer resting on one leaves this timer behind. Without the check the panel of a
			// card that is no longer on screen opens over the new graph.
			if (!host.isConnected) {
				return;
			}
			panel = buildPanel(sections, options.className);
			document.body.append(panel);
			placePanel(panel, host.getBoundingClientRect(), options);
		}, hoverDelay);
	});

	host.addEventListener("mouseleave", () => {
		if (timer !== undefined) {
			// window.clearTimeout, to match the window.setTimeout above: the two are one timer table
			// in a browser, but not everywhere this module is exercised.
			window.clearTimeout(timer);
			timer = undefined;
		}
		panel?.remove();
		panel = undefined;
	});
}

function buildPanel(sections: TooltipSection[], className: string): HTMLDivElement {
	const panel = document.createElement("div");
	// .ev-cond as well, so the panel is typeset exactly like the condition panels on the cards.
	panel.className = "ev-cond " + className;

	for (const section of sections) {
		const head = document.createElement("div");
		head.className = "ev-cond-head";
		head.textContent = section.head;
		panel.appendChild(head);
		panel.appendChild(effectsToDom(section.effects));
	}

	// The panel sits outside the canvas, so it does not inherit its zoom; scaling it by hand keeps it
	// the size of the card it belongs to.
	panel.style.transform = `scale(${currentScale()})`;
	panel.style.transformOrigin = "top left";
	panel.style.visibility = "hidden";
	return panel;
}

// To the right of the card, top aligned, flipping to the left when the window has no room. Measured
// after the transform is set, because getBoundingClientRect already reports the scaled size.
function placePanel(panel: HTMLDivElement, host: DOMRect, options: EffectTooltipOptions): void {
	const size = panel.getBoundingClientRect();
	const viewWidth = document.documentElement.clientWidth;
	const viewHeight = document.documentElement.clientHeight;

	let left = host.right + options.gap;
	if (left + size.width > viewWidth) {
		left = host.left - options.gap - size.width;
	}
	left = Math.max(options.margin, Math.min(left, viewWidth - size.width - options.margin));

	let top = host.top;
	if (top + size.height > viewHeight) {
		top = viewHeight - size.height - options.margin;
	}
	top = clampBelowToolbar(top, options.toolbarHeight, options.margin);

	panel.style.left = left + window.scrollX + "px";
	panel.style.top = top + window.scrollY + "px";
	panel.style.visibility = "";
}
