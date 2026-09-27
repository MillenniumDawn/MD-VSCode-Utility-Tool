// The serializable projection of a balance of power file: what the host posts and the webview
// draws as one card per BoP.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency.
// And the payload must be deterministic: LoaderPreview hashes it to decide whether an edit changed
// anything, so a stable order is what makes an unchanged edit skip the re-render.

export { LocText, NavTarget, ModifierLine } from "../sharedpayload";
import { LocText, NavTarget, ModifierLine } from "../sharedpayload";

export interface BopIcon {
	styleKey: string;
	width: number;
	height: number;
}

// Which part of the bar a range belongs to: the left side's ranges are drawn in the left side's
// colour, and so on.
export type BopRangeSide = "left" | "centre" | "right";

export interface BopRangeView {
	id: string;
	name: LocText;
	min: number;
	max: number;
	side: BopRangeSide;
	modifiers: ModifierLine[];
	// `custom_modifier_tooltip` keys, resolved.
	tooltips: LocText[];
	hasOnActivate: boolean;
	hasOnDeactivate: boolean;
	nav?: NavTarget;
}

export interface BopSideView {
	id: string;
	name: LocText;
	// The sprite name as written, so a card can say which one did not resolve.
	iconName?: string;
	icon?: BopIcon;
	nav?: NavTarget;
}

// A side defined in the file but named by neither left_side nor right_side. Vanilla swaps these in
// with set_power_balance; they are listed rather than drawn on the bar, whose two ends are taken.
export interface BopExtraSide extends BopSideView {
	ranges: BopRangeView[];
}

export interface BopCard {
	// The BoP id plus its occurrence in the file, so a file that repeats an id keeps both cards.
	key: string;
	id: string;
	title: LocText;
	category?: LocText;
	initialValue: number;
	left?: BopSideView;
	right?: BopSideView;
	// The centre range and the two drawn sides' ranges, sorted by `min`: the segments of the bar,
	// left to right.
	ranges: BopRangeView[];
	extraSides: BopExtraSide[];
	// Mistakes in the file the reader would otherwise only find in game: overlapping ranges, a
	// stretch of the bar no range covers, a side that is named but not defined.
	warnings: string[];
	nav?: NavTarget;
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
