import { localise } from "../localise";
import { navOf } from "../sharedpayload";
import { getImageByPath, getSpriteByGfxName } from "../../util/image/imagecache";
import { StyleTable, normalizeForStyle } from "../../util/styletable";
import { localize } from "../../util/i18n";
import { formatModifiers, formatResearchBonuses } from "../../util/modifiers";
import { CharacterTrait } from "../../util/characterTraits";
import {
	CharacterRoleKind,
	HOICharacter,
	HOICharacterRole,
	PortraitRef,
	characterRoleKinds,
} from "./schema";
import { CharactersLoaderResult, isSpriteName, traitIconSprite } from "./loader";
import {
	CharacterCard,
	CharacterGroupKind,
	CharacterPortrait,
	CharacterPreviewPayload,
	CharacterRoleGroup,
	CharacterToolbarFlags,
	ModifierGroup,
	TraitCard,
} from "./payload";

// The order the groups are drawn in: who leads the country, then who fights for it, then who
// advises it. Fixed rather than taken from the file so two files read the same way, and so the
// payload is deterministic -- which is what lets an unchanged edit hash equal and skip the render.
const groupOrder: CharacterRoleKind[] = [...characterRoleKinds];

// The group a character with no role block at all lands in. It is half-written rather than
// finished, and a preview that dropped it would hide exactly the case the author needs to see.
const noRole = "none";

// Which portrait to draw, most useful first. The large ones are the 156x210 images the game shows
// on a character's own screen; a `small` is a 38x51 thumbnail and only worth drawing when it is
// all there is.
const portraitPreference: { category: string; size: string }[] = [
	{ category: "army", size: "large" },
	{ category: "civilian", size: "large" },
	{ category: "navy", size: "large" },
	{ category: "army", size: "small" },
	{ category: "civilian", size: "small" },
	{ category: "navy", size: "small" },
];

export async function buildCharacterPreviewPayload(
	loadResult: CharactersLoaderResult,
	styleTable: StyleTable,
): Promise<CharacterPreviewPayload> {
	const cards: CharacterCard[] = [];
	const cardIdsByGroup = new Map<CharacterGroupKind, string[]>();

	for (const character of loadResult.characters.characters) {
		const roleKinds = character.roles.map((r) => r.kind);
		const portrait = await buildPortrait(character.portraits, loadResult, styleTable);

		// A character with no role still gets one card, so a half-written entry is visible rather
		// than silently absent.
		const roles: (HOICharacterRole | undefined)[] =
			character.roles.length > 0 ? character.roles : [undefined];

		for (const [occurrence, role] of roles.entries()) {
			const card = await buildCard(
				character,
				role,
				occurrence,
				roleKinds,
				portrait,
				loadResult,
				styleTable,
			);
			cards.push(card);
			const key: CharacterGroupKind = role?.kind ?? noRole;
			const list = cardIdsByGroup.get(key);
			if (list) {
				list.push(card.cardId);
			} else {
				cardIdsByGroup.set(key, [card.cardId]);
			}
		}
	}

	const groups: CharacterRoleGroup[] = [];
	for (const kind of [...groupOrder, noRole] as CharacterGroupKind[]) {
		const cardIds = cardIdsByGroup.get(kind);
		if (cardIds && cardIds.length > 0) {
			groups.push({ kind, title: roleTitle(kind), cardIds });
		}
	}

	return {
		groups,
		cards,
		conditionExprs: loadResult.characters.conditionExprs,
		toolbarFlags: toolbarFlagsOf(cards),
	};
}

async function buildCard(
	character: HOICharacter,
	role: HOICharacterRole | undefined,
	// Which of the character's role blocks this card is, in file order. Part of the card id because
	// the game lets a character write the same role twice -- VER gives one character three separate
	// `advisor` blocks -- and an id built from the kind alone would collide, leaving the webview's
	// id->card map holding only the last of them and drawing it once per slot.
	occurrence: number,
	roleKinds: CharacterRoleKind[],
	portrait: ResolvedPortrait,
	loadResult: CharactersLoaderResult,
	styleTable: StyleTable,
): Promise<CharacterCard> {
	const definitions = loadResult.modifierDefinitions;
	const kind: CharacterGroupKind = role?.kind ?? noRole;

	const [name, desc, traits, skills, modifiers, research] = await Promise.all([
		buildName(character),
		localise(character.descKey),
		Promise.all(
			(role?.traits ?? []).map((id) => buildTrait(id, loadResult, styleTable)),
		),
		// A skill is a count of points, not a modifier: it has no MODIFIER_ key and no percentage
		// to it, so the definitions are deliberately not consulted.
		formatModifiers(role?.skills ?? [], {}),
		formatModifiers(role?.modifiers ?? [], definitions),
		formatResearchBonuses(role?.researchBonuses ?? []),
	]);

	return {
		cardId: `${character.id}:${kind}:${occurrence}`,
		characterId: character.id,
		roleKind: kind,
		name,
		desc,
		portrait: portrait.portrait,
		portraitPath: portrait.path,
		portraitMissing: portrait.missing,
		// Deduplicated: the badge names the other kinds this person turns up under, and a character
		// with two advisor blocks and a country_leader would otherwise read "Also: advisor, advisor".
		otherRoles: [...new Set(roleKinds.filter((other) => other !== role?.kind))],
		badges: badgesOf(role),
		skills,
		traits,
		hasUnknownTrait: traits.some((t) => !t.known),
		modifiers,
		research,
		allowed: role?.allowed ?? true,
		available: role?.available ?? true,
		visible: role?.visible ?? true,
		hasEffects: (role?.hasOnAdd ?? false) || (role?.hasOnRemove ?? false),
		nav: navOf(role?.token ?? character.token, character.file),
	};
}

// `name = "Ahmad Shah Massoud"` is the text itself and has no key to look up; `name = tony_abbott`
// is a key, and so is a character that writes no name at all -- the game then localises it under
// the character's own id.
async function buildName(character: HOICharacter): Promise<CharacterCard["name"]> {
	const written = character.name;
	if (written === undefined) {
		return await localise(character.id);
	}

	const localised = await localise(written);
	if (localised.text !== localised.key) {
		return localised;
	}

	// Nothing localises it, so it is a literal. Showing the key and the text as the same string is
	// honest: there is nothing else to switch to.
	return { key: written, text: written };
}

async function buildTrait(
	id: string,
	loadResult: CharactersLoaderResult,
	styleTable: StyleTable,
): Promise<TraitCard> {
	const definition: CharacterTrait | undefined = loadResult.traits[id];
	const definitions = loadResult.modifierDefinitions;

	const [name, desc] = await Promise.all([localise(id), localise(`${id}_desc`)]);

	if (!definition) {
		return {
			id,
			name,
			desc,
			known: false,
			icon: undefined,
			traitType: undefined,
			modifiers: [],
			groups: [],
			hasDetail: false,
			nav: undefined,
		};
	}

	const [icon, modifiers, skills, research, groups] = await Promise.all([
		buildTraitIcon(definition, loadResult, styleTable),
		formatModifiers(definition.modifiers, definitions),
		formatModifiers(definition.skillBonuses, {}),
		formatResearchBonuses(definition.researchBonuses),
		Promise.all(
			definition.groups.map(async (group): Promise<ModifierGroup> => ({
				title: group.title,
				lines: await formatModifiers(group.modifiers, definitions),
			})),
		),
	]);

	const allGroups: ModifierGroup[] = [];
	if (skills.length > 0) {
		allGroups.push({
			title: localize("characterpreview.skillbonuses", "Skill bonuses"),
			lines: skills,
		});
	}
	if (research.length > 0) {
		allGroups.push({
			title: localize("characterpreview.research", "Research bonus"),
			lines: research,
		});
	}
	allGroups.push(...groups.filter((g) => g.lines.length > 0));

	return {
		id,
		name,
		desc,
		known: true,
		icon,
		traitType: definition.traitType,
		modifiers,
		groups: allGroups,
		hasDetail:
			modifiers.length > 0 ||
			allGroups.length > 0 ||
			desc.text !== desc.key,
		nav: navOf(definition.token, definition.file),
	};
}

// The trait's medal, or undefined when nothing draws one.
//
// Undefined is the ordinary answer rather than a failure: Millennium Dawn ships no GFX_trait_*
// sprites, so every commander trait it adds itself lands here, and the card draws an empty slot the
// same width as a medal so the pills still line up.
async function buildTraitIcon(
	definition: CharacterTrait,
	loadResult: CharactersLoaderResult,
	styleTable: StyleTable,
): Promise<CharacterPortrait | undefined> {
	const wanted = traitIconSprite(definition);
	if (wanted === undefined) {
		return undefined;
	}

	const sprite = await getSpriteByGfxName(wanted.name, loadResult.gfxFiles);
	if (!sprite) {
		return undefined;
	}

	// Sprite.frames slices a strip into per-frame images with their own data URLs, so a frame is
	// drawn with the same background-image rule as a whole sprite and needs no background-position
	// arithmetic. A frame index the sheet does not have falls back to the whole image rather than
	// dropping the medal: a trait written with `sprite = 40` is still a trait.
	const image = sprite.frames[wanted.frame] ?? sprite.image;

	// Keyed on the sprite and frame rather than the trait, so the forty advisors sharing frame 13 of
	// the strip share one rule instead of writing the same data URL forty times.
	const styleKey = styleTable.style(
		"char-trait-icon-" + normalizeForStyle(`${wanted.name}-${wanted.frame}`),
		() => `
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `,
	);

	return { styleKey, width: image.width, height: image.height };
}

interface ResolvedPortrait {
	portrait: CharacterPortrait | undefined;
	path: string | undefined;
	missing: boolean;
}

async function buildPortrait(
	portraits: PortraitRef[],
	loadResult: CharactersLoaderResult,
	styleTable: StyleTable,
): Promise<ResolvedPortrait> {
	const chosen = pickPortrait(portraits);
	// A character with no portrait block has nothing to draw and nothing to complain about: the
	// game falls back to a generic one, and asking the image cache anyway would cost a lookup per
	// character on a file of a hundred.
	if (chosen === undefined) {
		return { portrait: undefined, path: undefined, missing: false };
	}

	const image = isSpriteName(chosen)
		? (await getSpriteByGfxName(chosen, loadResult.gfxFiles))?.image
		: await getImageByPath(chosen);

	if (!image) {
		return { portrait: undefined, path: chosen, missing: true };
	}

	// Keyed on the portrait rather than the character, so the two cards a multi-role character
	// produces -- and every character sharing a generic portrait -- share one rule instead of
	// writing the same data URL into the stylesheet again.
	const styleKey = styleTable.style(
		"char-portrait-" + normalizeForStyle(chosen),
		() => `
            background-image: url(${image.uri});
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
        `,
	);

	return {
		portrait: { styleKey, width: image.width, height: image.height },
		path: chosen,
		missing: false,
	};
}

export function pickPortrait(portraits: PortraitRef[]): string | undefined {
	for (const preference of portraitPreference) {
		const match = portraits.find(
			(p) => p.category === preference.category && p.size === preference.size,
		);
		if (match) {
			return match.value;
		}
	}
	// A category or size the preference list does not name -- the file is free to write one -- is
	// still better than nothing.
	return portraits[0]?.value;
}

function badgesOf(role: HOICharacterRole | undefined): string[] {
	const badges: string[] = [];
	if (!role) {
		return badges;
	}

	if (role.ideology !== undefined) {
		badges.push(role.ideology);
	}
	if (role.slot !== undefined) {
		badges.push(role.slot);
	}
	if (role.ideaToken !== undefined) {
		badges.push(role.ideaToken);
	}
	if (role.ledger !== undefined) {
		badges.push(localize("characterpreview.ledger", "Ledger: {0}", role.ledger));
	}
	if (role.expire !== undefined) {
		badges.push(localize("characterpreview.expire", "Expires {0}", role.expire));
	}
	if (role.cost !== undefined) {
		badges.push(localize("characterpreview.cost", "Cost {0}", role.cost));
	}
	if (role.removalCost !== undefined) {
		badges.push(
			role.removalCost < 0
				? localize("characterpreview.notremovable", "Not removable")
				: localize("characterpreview.removalcost", "Removal {0}", role.removalCost),
		);
	}
	if (role.legacyId !== undefined) {
		badges.push(localize("characterpreview.legacyid", "Legacy id {0}", role.legacyId));
	}

	return badges;
}

// The group headings. Kept on the host because the webview would otherwise carry its own copy of
// these in every language the extension speaks.
function roleTitle(kind: CharacterGroupKind): string {
	switch (kind) {
		case "country_leader":
			return localize("characterpreview.countryleaders", "Country leaders");
		case "field_marshal":
			return localize("characterpreview.fieldmarshals", "Field marshals");
		case "corps_commander":
			return localize("characterpreview.corpscommanders", "Corps commanders");
		case "navy_leader":
			return localize("characterpreview.navyleaders", "Navy leaders");
		case "advisor":
			return localize("characterpreview.advisors", "Advisors");
		case "scientist":
			return localize("characterpreview.scientists", "Scientists");
		case "operative":
			return localize("characterpreview.operatives", "Operatives");
		case "nuclear_scientist":
			return localize("characterpreview.nuclearscientists", "Nuclear scientists");
		default:
			return localize("characterpreview.norole", "No role");
	}
}

// Each predicate is exact: with the flag false, the control it gates produces the same output in
// either position, so hiding it takes nothing away.
export function toolbarFlagsOf(cards: CharacterCard[]): CharacterToolbarFlags {
	return {
		// With the localisation index off every LocText has text === key, so the toggle would swap a
		// string for itself.
		hasLocalisation: cards.some((c) => c.name.text !== c.name.key),
		// The same toggle draws the trait descriptions, so a file whose only localised description
		// belongs to a trait still has something to show.
		hasDescriptions: cards.some(
			(c) =>
				c.desc.text !== c.desc.key ||
				c.traits.some((t) => t.desc.text !== t.desc.key),
		),
		hasPortraits: cards.some((c) => c.portrait !== undefined),
		hasSkills: cards.some((c) => c.skills.length > 0),
		hasTraitDetail: cards.some((c) => c.traits.some((t) => t.hasDetail)),
		hasConditions: cards.some(
			(c) => c.allowed !== true || c.available !== true || c.visible !== true,
		),
		hasMultiRole: cards.some((c) => c.otherRoles.length > 0),
		hasUnknownTraits: cards.some((c) => c.hasUnknownTrait),
		hasMissingPortraits: cards.some((c) => c.portraitMissing),
	};
}
