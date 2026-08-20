import { localisationIndex } from "../../util/featureflags";
import { getLocalisedTextQuick } from "../../util/localisationIndex";
import { getImageByPath, getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { localize } from "../../util/i18n";
import { IdeaSwap } from "../../util/ideaSwapIndex";
import { HOIIdea } from "./schema";
import { IdeasLoaderResult, ideaSpriteName } from "./loader";
import { formatModifiers, formatResearchBonuses } from "../../util/modifiers";
import {
	IdeaCard,
	IdeaChain,
	IdeaGroup,
	IdeaPreviewPayload,
	IdeaToolbarFlags,
	LocText,
	ModifierGroup,
	NavTarget,
} from "./payload";

// What an idea with no picture, or a picture nothing resolves, is drawn with. The game ships this
// placeholder for exactly this case.
const defaultIdeaIcon = "gfx/interface/ideas/WIP_idea.dds";

export async function buildIdeaPreviewPayload(
	loadResult: IdeasLoaderResult,
	styleTable: StyleTable,
): Promise<IdeaPreviewPayload> {
	const groups: IdeaGroup[] = [];
	const cards: IdeaCard[] = [];

	for (const category of loadResult.ideas.categories) {
		groups.push({
			category: category.name,
			isLaw: category.isLaw,
			isDesigner: category.isDesigner,
			ideaIds: category.ideas.map((i) => i.id),
			nav: navOf(category.token, fileOf(category.ideas)),
		});

		for (const idea of category.ideas) {
			cards.push(await buildCard(idea, category.isLaw, loadResult, styleTable));
		}
	}

	const chains = buildChains(
		loadResult.swaps,
		new Set(cards.map((c) => c.id)),
	);

	return {
		groups,
		cards,
		chains,
		conditionExprs: loadResult.ideas.conditionExprs,
		toolbarFlags: toolbarFlagsOf(cards, chains, loadResult.swapsUnavailable),
	};
}

async function buildCard(
	idea: HOIIdea,
	isLaw: boolean,
	loadResult: IdeasLoaderResult,
	styleTable: StyleTable,
): Promise<IdeaCard> {
	const definitions = loadResult.modifierDefinitions;

	const [modifiers, research, targeted, equipment] = await Promise.all([
		formatModifiers(idea.modifiers, definitions),
		formatResearchBonuses(idea.researchBonuses),
		Promise.all(
			idea.targetedModifiers.map(async (t): Promise<ModifierGroup> => {
				return {
					title: t.tag
						? localize("ideapreview.against", "Against {0}", t.tag)
						: localize("ideapreview.targeted", "Targeted"),
					lines: await formatModifiers(t.modifiers, definitions),
				};
			}),
		),
		Promise.all(
			idea.equipmentBonuses.map(async (e): Promise<ModifierGroup> => {
				return {
					title: e.instant
						? localize("ideapreview.equipmentinstant", "{0} (instant)", e.archetype)
						: e.archetype,
					lines: await formatModifiers(e.modifiers, definitions),
				};
			}),
		),
	]);

	return {
		id: idea.id,
		category: idea.category,
		name: await localise(idea.nameKey),
		desc: await localise(idea.descKey),
		borrowsName: idea.hasNameOverride,
		icon: await buildIcon(idea, loadResult, styleTable),
		isDefault: idea.isDefault,
		isLaw,
		badges: badgesOf(idea),
		modifiers,
		research,
		targeted,
		equipment,
		allowed: idea.allowed,
		available: idea.available,
		hasEffects: idea.hasOnAdd || idea.hasOnRemove,
		nav: navOf(idea.token, idea.file),
	};
}

async function buildIcon(
	idea: HOIIdea,
	loadResult: IdeasLoaderResult,
	styleTable: StyleTable,
): Promise<IdeaCard["icon"]> {
	// An idea that declares no picture has no icon to draw, and asking the image cache for the
	// placeholder anyway would cost a file lookup per card on a file of a thousand ideas. The
	// placeholder is for the other case: a picture that is written down but does not resolve.
	if (!idea.picture) {
		return undefined;
	}

	const sprite = await getSpriteByGfxName(
		ideaSpriteName(idea.picture),
		loadResult.gfxFiles,
	);
	const image = sprite?.image ?? (await getImageByPath(defaultIdeaIcon));
	if (!image) {
		return undefined;
	}

	// Keyed on the picture rather than the idea, so a hundred ideas sharing one picture share one
	// rule instead of writing the same data URL a hundred times into the stylesheet.
	const styleKey = styleTable.style(
		"idea-icon-" + normalizeForStyle(idea.picture),
		() => `
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `,
	);

	return { styleKey, width: image.width, height: image.height };
}

function badgesOf(idea: HOIIdea): string[] {
	const badges: string[] = [];

	if (idea.level !== undefined) {
		badges.push(localize("ideapreview.level", "Level {0}", idea.level));
	}
	if (idea.cost !== undefined) {
		badges.push(localize("ideapreview.cost", "Cost {0}", idea.cost));
	}
	// -1 is the game's "cannot be removed", which is worth saying in words rather than as a number
	// that reads like a refund.
	if (idea.removalCost !== undefined) {
		badges.push(
			idea.removalCost < 0
				? localize("ideapreview.notremovable", "Not removable")
				: localize("ideapreview.removalcost", "Removal {0}", idea.removalCost),
		);
	}
	if (idea.cancelIfInvalid === false) {
		badges.push(localize("ideapreview.keptwheninvalid", "Kept when invalid"));
	}
	if (idea.allowedCivilWar) {
		badges.push(localize("ideapreview.civilwar", "Civil war"));
	}
	if (idea.ledger) {
		badges.push(idea.ledger);
	}
	for (const trait of idea.traits) {
		badges.push(trait);
	}

	return badges;
}

/**
 * Stitches the flat list of swaps into ordered runs.
 *
 * A run starts at an idea nothing swaps into and follows the swaps forward. Ideas that are only
 * ever swapped away from -- a cycle, or a chain whose head is defined in a file the index never
 * read -- would otherwise produce no run at all, so whatever is left over after the heads are
 * walked is started from as well.
 */
export function buildChains(
	swaps: IdeaSwap[],
	idsInFile: Set<string>,
): IdeaChain[] {
	if (swaps.length === 0) {
		return [];
	}

	const next = new Map<string, IdeaSwap>();
	const hasIncoming = new Set<string>();
	const allIds = new Set<string>();

	for (const swap of swaps) {
		allIds.add(swap.from);
		allIds.add(swap.to);
		hasIncoming.add(swap.to);
		// An idea swapped into two different things by two different files has no single chain to
		// draw; the first swap in the (already sorted) list wins so the payload stays deterministic.
		if (!next.has(swap.from)) {
			next.set(swap.from, swap);
		}
	}

	const chains: IdeaChain[] = [];
	const visited = new Set<string>();

	const heads = [...allIds].filter((id) => !hasIncoming.has(id)).sort();
	const leftovers = [...allIds].sort();

	for (const start of [...heads, ...leftovers]) {
		if (visited.has(start)) {
			continue;
		}

		const ideaIds: string[] = [];
		const sources: (NavTarget | undefined)[] = [];
		let current: string | undefined = start;
		while (current !== undefined && !visited.has(current)) {
			visited.add(current);
			ideaIds.push(current);
			const swap: IdeaSwap | undefined = next.get(current);
			sources.push(
				swap ? { start: swap.start, end: swap.end, file: swap.file } : undefined,
			);
			current = swap?.to;
		}

		// A run of one is not a chain, and a run that touches nothing in this file has nothing to
		// draw against.
		if (ideaIds.length > 1 && ideaIds.some((id) => idsInFile.has(id))) {
			chains.push({ ideaIds, sources });
		}
	}

	return chains;
}

// Each predicate is exact: with the flag false, the control it gates produces the same output in
// either position, so hiding it takes nothing away.
export function toolbarFlagsOf(
	cards: IdeaCard[],
	chains: IdeaChain[],
	swapsUnavailable: boolean,
): IdeaToolbarFlags {
	return {
		// With the localisation index off every LocText has text === key, so the toggle would swap a
		// string for itself.
		hasLocalisation: cards.some((c) => c.name.text !== c.name.key),
		hasDescriptions: cards.some((c) => c.desc.text !== c.desc.key),
		hasIcons: cards.some((c) => c.icon !== undefined),
		hasModifiers: cards.some(
			(c) =>
				c.modifiers.length > 0 ||
				c.targeted.length > 0 ||
				c.equipment.length > 0,
		),
		hasResearch: cards.some((c) => c.research.length > 0),
		hasConditions: cards.some((c) => c.allowed !== true || c.available !== true),
		hasLaws: cards.some((c) => c.isLaw),
		hasDefaults: cards.some((c) => c.isDefault),
		hasChains: chains.length > 0,
		chainsUnavailable: swapsUnavailable,
	};
}

async function localise(key: string): Promise<LocText> {
	// getLocalisedTextQuick echoes the key back when nothing resolves, which is exactly the fallback
	// the preview wants, so an unresolved key simply reads the same either way.
	const text = localisationIndex ? await getLocalisedTextQuick(key) : key;
	return { key, text: text ?? key };
}

function navOf(
	token: { start: number; end: number } | undefined,
	file: string | undefined,
): NavTarget | undefined {
	if (!token || file === undefined) {
		return undefined;
	}
	return { start: token.start, end: token.end, file };
}

function fileOf(ideas: HOIIdea[]): string | undefined {
	return ideas[0]?.file;
}
