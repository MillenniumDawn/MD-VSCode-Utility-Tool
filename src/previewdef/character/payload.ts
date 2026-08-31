import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";
import { CharacterRoleKind } from "./schema";

// The serializable projection of a characters file: what the host posts and the webview renders as
// a roster of cards, grouped by role.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency --
// no vscode, no image cache, no localisation index. And the payload must be deterministic:
// LoaderPreview hashes it to decide whether an edit changed anything, so a stable order and
// counter-free ids are what make an unchanged edit skip the re-render.

export {
	LocText,
	NavTarget,
	ModifierTone,
	ModifierLine,
	ModifierGroup,
} from "../sharedpayload";
import { LocText, NavTarget, ModifierLine, ModifierGroup } from "../sharedpayload";

export { CharacterRoleKind } from "./schema";

// What a card and a group are keyed by. A character that carries no role block at all is still
// drawn -- it is half-written rather than finished, and hiding it would hide exactly the case the
// author needs to see -- so the roster needs one more key than the file has role kinds.
export type CharacterGroupKind = CharacterRoleKind | "none";

// The character's portrait, as a StyleTable class carrying the decoded image as a data URL, plus
// the size it was decoded at.
export interface CharacterPortrait {
	styleKey: string;
	width: number;
	height: number;
}

// One trait a role names, with what it grants. `known` is false when nothing in
// common/country_leader, common/unit_leader or common/scientist_traits defines it -- in a hand
// written file that is almost always a typo, and it is the single most useful thing this preview
// can tell its reader.
export interface TraitCard {
	id: string;
	name: LocText;
	desc: LocText;
	known: boolean;
	traitType: string | undefined;
	modifiers: ModifierLine[];
	groups: ModifierGroup[];
	// Whether the trait grants anything at all. A trait that is known but grants nothing is worth
	// distinguishing from one that grants something the reader has not opened yet.
	hasDetail: boolean;
	nav: NavTarget | undefined;
}

// One card: a character in one of its roles.
//
// The roster is grouped by role, so a character with three roles is three cards -- the card in the
// "Advisors" group has to show the advisor's traits and not the field marshal's. The character's
// own facts (name, portrait) repeat across them, which costs nothing: the portrait is a style key,
// so the image is written into the stylesheet once however many cards point at it.
export interface CharacterCard {
	// `<character id>:<role kind>:<occurrence>`, unique across the whole payload. The occurrence is
	// the role block's index in file order, and it is what keeps the id unique when a character
	// writes the same role twice -- three `advisor` blocks on one person is real.
	cardId: string;
	characterId: string;
	roleKind: CharacterGroupKind;
	name: LocText;
	desc: LocText;
	portrait: CharacterPortrait | undefined;
	// The portrait as written, for the tooltip -- and the only thing there is to show when it does
	// not resolve.
	portraitPath: string | undefined;
	// A portrait was declared and nothing resolved it: a broken path, which the card says out loud
	// rather than drawing an empty frame the reader has to interpret.
	portraitMissing: boolean;
	// The character's other roles, drawn as one badge. This is how a multi-role character is
	// recognised from inside a single group.
	otherRoles: CharacterRoleKind[];
	// Short facts drawn as badges: ideology, expiry, advisor slot, idea token, ledger, cost.
	badges: string[];
	skills: ModifierLine[];
	traits: TraitCard[];
	hasUnknownTrait: boolean;
	// The role's own `modifier` / `research_bonus` blocks, which vanilla advisors write and
	// Millennium Dawn's never do.
	modifiers: ModifierLine[];
	research: ModifierLine[];
	// `true` means the block was absent.
	allowed: ConditionComplexExpr;
	available: ConditionComplexExpr;
	visible: ConditionComplexExpr;
	hasEffects: boolean;
	nav: NavTarget | undefined;
}

export interface CharacterRoleGroup {
	kind: CharacterGroupKind;
	// Localised on the host, because the webview would otherwise need its own copy of the role
	// names in every language.
	title: string;
	// Card ids in file order.
	cardIds: string[];
}

// Which toolbar controls this file can actually use. A control whose flag is false would produce
// identical output in either position, so the webview hides it rather than offering something the
// preview cannot deliver.
//
// These ride in the payload rather than deciding the toolbar markup on the host, because the
// toolbar is part of the baked-in shell: markup that changed with the file would need a full html
// reassignment to apply, tearing the page down and losing scroll on every flip.
export interface CharacterToolbarFlags {
	hasLocalisation: boolean;
	hasDescriptions: boolean;
	hasPortraits: boolean;
	hasSkills: boolean;
	hasTraitDetail: boolean;
	hasConditions: boolean;
	hasMultiRole: boolean;
	hasUnknownTraits: boolean;
	hasMissingPortraits: boolean;
}

export interface CharacterPreviewPayload {
	groups: CharacterRoleGroup[];
	cards: CharacterCard[];
	conditionExprs: ConditionItem[];
	toolbarFlags: CharacterToolbarFlags;
}
