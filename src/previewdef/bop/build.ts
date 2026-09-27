import { localise } from "../localise";
import { navOf } from "../sharedpayload";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { localize } from "../../util/i18n";
import { formatModifiers } from "../../util/modifiers";
import { HOIBop, HOIBopRange, HOIBopSide } from "./schema";
import { BopLoaderResult } from "./loader";
import {
	BopCard,
	BopExtraSide,
	BopIcon,
	BopPreviewPayload,
	BopRangeSide,
	BopRangeView,
	BopSideView,
} from "./payload";

// Two range bounds this close are the same number written differently (0.1 against 0.10000001).
const epsilon = 1e-6;

export async function buildBopPreviewPayload(
	loadResult: BopLoaderResult,
	styleTable: StyleTable,
): Promise<BopPreviewPayload> {
	const cards: BopCard[] = [];
	for (const bop of loadResult.bops.bops) {
		cards.push(await buildCard(bop, loadResult, styleTable));
	}

	return {
		cards,
		hasLocalisation: cards.some(
			(c) =>
				c.title.text !== c.title.key ||
				c.ranges.some((r) => r.name.text !== r.name.key),
		),
	};
}

async function buildCard(
	bop: HOIBop,
	loadResult: BopLoaderResult,
	styleTable: StyleTable,
): Promise<BopCard> {
	const warnings: string[] = [];

	// A BoP that does not name its sides still has two ends, and the game fills them in file order.
	const leftId = bop.leftSide ?? bop.sides[0]?.id;
	const rightId = bop.rightSide ?? bop.sides.find((s) => s.id !== leftId)?.id;
	const leftSide = bop.sides.find((s) => s.id === leftId);
	const rightSide = bop.sides.find((s) => s.id === rightId);

	for (const [name, side] of [[leftId, leftSide], [rightId, rightSide]] as const) {
		if (name !== undefined && side === undefined) {
			warnings.push(localize("boppreview.missingside", "Side {0} is not defined in this balance of power.", name));
		}
	}

	const buildRanges = (ranges: HOIBopRange[], side: BopRangeSide) =>
		Promise.all(ranges.map((r) => buildRange(r, side, bop.file, loadResult)));

	const ranges = [
		...(bop.centreRange ? await buildRanges([bop.centreRange], "centre") : []),
		...(leftSide ? await buildRanges(leftSide.ranges, "left") : []),
		...(rightSide ? await buildRanges(rightSide.ranges, "right") : []),
	].sort((a, b) => a.min - b.min || a.max - b.max);

	const extraSides: BopExtraSide[] = [];
	for (const side of bop.sides) {
		if (side === leftSide || side === rightSide) {
			continue;
		}
		extraSides.push({
			...(await buildSide(side, bop.file, styleTable, loadResult, warnings)),
			// Not on the bar, so coloured by the end of it the range sits on.
			ranges: await Promise.all(
				side.ranges.map((r) => buildRange(r, r.max <= 0 ? "left" : "right", bop.file, loadResult)),
			),
		});
	}

	if (bop.initialValue < -1 || bop.initialValue > 1) {
		warnings.push(localize("boppreview.initialoutside", "initial_value {0} is outside -1 to 1.", bop.initialValue));
	}
	warnings.push(...coverageWarnings(ranges));

	return {
		key: bop.occurrence === 0 ? bop.id : `${bop.id}#${bop.occurrence}`,
		id: bop.id,
		title: await localise(bop.id),
		category: bop.decisionCategory !== undefined ? await localise(bop.decisionCategory) : undefined,
		initialValue: bop.initialValue,
		left: leftSide ? await buildSide(leftSide, bop.file, styleTable, loadResult, warnings) : undefined,
		right: rightSide ? await buildSide(rightSide, bop.file, styleTable, loadResult, warnings) : undefined,
		ranges,
		extraSides,
		warnings,
		nav: navOf(bop.token, bop.file),
	};
}

async function buildRange(
	range: HOIBopRange,
	side: BopRangeSide,
	file: string,
	loadResult: BopLoaderResult,
): Promise<BopRangeView> {
	return {
		id: range.id,
		name: await localise(range.id),
		// A range written max-first still covers the same stretch of the bar.
		min: Math.min(range.min, range.max),
		max: Math.max(range.min, range.max),
		side,
		modifiers: await formatModifiers(range.modifiers, loadResult.modifierDefinitions),
		tooltips: await Promise.all(range.customTooltips.map(localise)),
		hasOnActivate: range.hasOnActivate,
		hasOnDeactivate: range.hasOnDeactivate,
		nav: navOf(range.token, file),
	};
}

async function buildSide(
	side: HOIBopSide,
	file: string,
	styleTable: StyleTable,
	loadResult: BopLoaderResult,
	warnings: string[],
): Promise<BopSideView> {
	const icon = side.icon ? await buildIcon(side.icon, styleTable, loadResult) : undefined;
	if (side.icon && !icon) {
		warnings.push(localize("boppreview.iconmissing", "Icon {0} of side {1} was not found.", side.icon, side.id));
	}
	return {
		id: side.id,
		name: await localise(side.id),
		iconName: side.icon,
		icon,
		nav: navOf(side.token, file),
	};
}

async function buildIcon(
	name: string,
	styleTable: StyleTable,
	loadResult: BopLoaderResult,
): Promise<BopIcon | undefined> {
	const sprite = await getSpriteByGfxName(name, loadResult.gfxFiles);
	if (!sprite) {
		return undefined;
	}
	const image = sprite.image;
	// Keyed on the sprite, so the two BoPs of a file sharing an icon share one rule.
	const styleKey = styleTable.style(
		"bop-icon-" + normalizeForStyle(name),
		() => `
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `,
	);
	return { styleKey, width: image.width, height: image.height };
}

/**
 * Where the bar's ranges overlap one another, or leave a stretch between -1 and 1 that no range
 * covers. `ranges` must be sorted by `min`.
 */
export function coverageWarnings(ranges: { id: string; min: number; max: number }[]): string[] {
	const warnings: string[] = [];
	if (ranges.length === 0) {
		return [localize("boppreview.noranges", "This balance of power has no ranges.")];
	}

	let reach = -1;
	let last: { id: string; max: number } | undefined;
	for (const range of ranges) {
		if (range.min > reach + epsilon) {
			warnings.push(localize("boppreview.gap", "No range covers {0} to {1}.", format(reach), format(range.min)));
		} else if (last && range.min < last.max - epsilon) {
			warnings.push(localize("boppreview.overlap", "Ranges {0} and {1} overlap.", last.id, range.id));
		}
		if (range.max > reach) {
			reach = range.max;
			last = range;
		}
	}
	if (reach < 1 - epsilon) {
		warnings.push(localize("boppreview.gap", "No range covers {0} to {1}.", format(reach), format(1)));
	}

	return warnings;
}

function format(value: number): string {
	return String(Math.round(value * 1000) / 1000);
}
