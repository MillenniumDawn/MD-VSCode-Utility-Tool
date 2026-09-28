import { localise } from "../localise";
import { navOf } from "../sharedpayload";
import { getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable } from "../../util/styletable";
import { localize } from "../../util/i18n";
import { HOIBop, HOIBopRange } from "./schema";
import { BopLoaderResult, bopWindowName } from "./loader";
import { BopCard, BopDecisionView, BopPreviewPayload, BopRangeView } from "./payload";
import { decisionSpriteName } from "../decision/loader";
import { renderBopWindow } from "./window";

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
				c.ranges.some((r) => r.name.text !== r.name.key) ||
				c.decisions.some((d) => d.name.text !== d.name.key) ||
				(c.window?.texts ?? []).some((t) => t.text.text !== t.text.key),
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

	const ranges = await Promise.all(
		[
			...(bop.centreRange ? [bop.centreRange] : []),
			...(leftSide?.ranges ?? []),
			...(rightSide?.ranges ?? []),
		].map((r) => buildRange(r, bop.file)),
	);
	ranges.sort((a, b) => a.min - b.min || a.max - b.max);

	if (bop.initialValue < -1 || bop.initialValue > 1) {
		warnings.push(localize("boppreview.initialoutside", "initial_value {0} is outside -1 to 1.", bop.initialValue));
	}
	warnings.push(...coverageWarnings(ranges));

	const categoryDecisions = bop.decisionCategory ? (loadResult.decisions[bop.decisionCategory] ?? []) : [];
	if (bop.decisionCategory && categoryDecisions.length === 0) {
		warnings.push(
			localize(
				"boppreview.nodecisions",
				"No decision in common/decisions is in decision_category {0}.",
				bop.decisionCategory,
			),
		);
	}
	const decisions: BopDecisionView[] = await Promise.all(
		categoryDecisions.map(async (d) => ({
			id: d.id,
			name: await localise(d.nameKey),
			nav: navOf(d.token, d.file),
		})),
	);
	const windowDecisions = await Promise.all(
		categoryDecisions.map(async (d) => ({
			icon: d.icons[0] ? decisionSpriteName(d.icons[0].key) : undefined,
			cost: d.customCostText !== undefined
				? (await localise(d.customCostText)).text
				: d.cost !== undefined ? String(d.cost) : undefined,
		})),
	);

	const window = await renderBopWindow(
		{ leftIcon: leftSide?.icon, rightIcon: rightSide?.icon, decisions: windowDecisions },
		loadResult,
		styleTable,
	);
	if (!window) {
		warnings.push(
			localize(
				"boppreview.nowindow",
				"The {0} window was not found in the mod or the game install, so the balance of power cannot be drawn the way the game does.",
				bopWindowName,
			),
		);
	} else {
		for (const side of [leftSide, rightSide]) {
			if (side?.icon && !(await getSpriteByGfxName(side.icon, loadResult.gfxFiles))) {
				warnings.push(localize("boppreview.iconmissing", "Icon {0} of side {1} was not found.", side.icon, side.id));
			}
		}
	}

	return {
		key: bop.occurrence === 0 ? bop.id : `${bop.id}#${bop.occurrence}`,
		id: bop.id,
		title: await localise(bop.id),
		initialValue: bop.initialValue,
		ranges,
		window,
		decisions,
		warnings,
	};
}

async function buildRange(range: HOIBopRange, file: string): Promise<BopRangeView> {
	return {
		id: range.id,
		name: await localise(range.id),
		// A range written max-first still covers the same stretch of the bar.
		min: Math.min(range.min, range.max),
		max: Math.max(range.min, range.max),
		nav: navOf(range.token, file),
	};
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
