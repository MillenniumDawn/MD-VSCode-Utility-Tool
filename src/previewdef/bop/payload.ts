// The serializable projection of a balance of power file: what the host posts and the webview
// draws as one card per BoP.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency.
// And the payload must be deterministic: LoaderPreview hashes it to decide whether an edit changed
// anything, so a stable order is what makes an unchanged edit skip the re-render.

export { LocText, NavTarget } from "../sharedpayload";
import { LocText, NavTarget } from "../sharedpayload";

export interface BopRangeView {
	id: string;
	name: LocText;
	min: number;
	max: number;
	nav?: NavTarget;
}

// The game's powerbalanceview window, drawn by the host with everything that does not depend on
// the value. The rest -- fill, needle, range ticks, active range name -- sits in slots the webview
// fills: `.bop-slot-value` holding one `.bop-slot-fill-<variant>` per progress bar sprite,
// `.bop-slot-marks`, `.bop-slot-needle` and `.bop-slot-active-range`.
export interface BopWindowView {
	html: string;
	width: number;
	height: number;
	// The bar the value moves along, in the window's own coordinates: value -1 at `x`, 1 at
	// `x + width`.
	bar: { x: number; y: number; width: number };
	// The window's own texts, each drawn empty in `.bop-slot-text-<id>` for the webview to fill with
	// the key or its localisation, whichever the toggle asks for.
	texts: BopWindowText[];
	// `range_bar`, drawn once at the origin, for the webview to copy onto every range boundary.
	splitterHtml?: string;
	// `range_indicator`, frame 0 and frame 1.
	indicatorHtml?: [string, string];
}

export interface BopWindowText {
	id: string;
	text: LocText;
}

// A decision of the BoP's `decision_category`, drawn as a row of the window's decision list: the
// webview writes its name into `.bop-decision[data-index=<i>] .bop-decision-name` and links the row
// to where the decision is defined.
export interface BopDecisionView {
	id: string;
	name: LocText;
	nav?: NavTarget;
}

export interface BopCard {
	// The BoP id plus its occurrence in the file, so a file that repeats an id keeps both cards.
	key: string;
	id: string;
	title: LocText;
	initialValue: number;
	// The centre range and the two drawn sides' ranges, sorted by `min`: the bar, left to right.
	ranges: BopRangeView[];
	window?: BopWindowView;
	// In the order the window lists them, which is the order the files define them in.
	decisions: BopDecisionView[];
	// Mistakes in the file the reader would otherwise only find in game: overlapping ranges, a
	// stretch of the bar no range covers, a side that is named but not defined.
	warnings: string[];
}

export interface BopPreviewPayload {
	cards: BopCard[];
	// With the localisation index off every LocText has text === key, so the toggle would swap a
	// string for itself.
	hasLocalisation: boolean;
}

/**
 * The range the game shows as active at `value`: the one containing it, and at a boundary two
 * ranges share, the one nearer the centre. Pure, so the webview and the tests share it.
 */
export function activeRangeAt<R extends { min: number; max: number }>(
	ranges: R[],
	value: number,
): R | undefined {
	let best: R | undefined;
	for (const range of ranges) {
		if (value < range.min || value > range.max) {
			continue;
		}
		if (!best || Math.abs(range.min + range.max) < Math.abs(best.min + best.max)) {
			best = range;
		}
	}
	return best;
}

/**
 * The inner boundaries between ranges, left to right, each once: where the game puts a tick. The
 * two ends of the bar get none.
 */
export function rangeBoundaries(ranges: { min: number; max: number }[]): number[] {
	const result: number[] = [];
	for (const value of ranges.flatMap((r) => [r.min, r.max]).sort((a, b) => a - b)) {
		if (value <= -1 || value >= 1 || result.some((v) => Math.abs(v - value) < 1e-6)) {
			continue;
		}
		result.push(value);
	}
	return result;
}
