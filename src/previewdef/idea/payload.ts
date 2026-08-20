import { ConditionComplexExpr, ConditionItem } from "../../hoiformat/condition";

// The serializable projection of an ideas file: what the host posts and the webview renders as a
// roster of cards.
//
// This module is imported by the webview bundle, so it must stay free of any runtime dependency
// -- no vscode, no image cache, no localisation index. And the payload must be deterministic:
// LoaderPreview hashes it to decide whether an edit changed anything, so a stable order and
// counter-free ids are what make an unchanged edit skip the re-render.

// The modifier shapes are written the same way by an idea and by a decision, so they live in
// sharedpayload.ts alongside LocText and NavTarget.
export {
	LocText,
	NavTarget,
	ModifierTone,
	ModifierLine,
	ModifierGroup,
} from "../sharedpayload";
import { LocText, NavTarget, ModifierLine, ModifierGroup } from "../sharedpayload";

// The idea's icon, as a StyleTable class carrying the decoded image as a data URL, plus the size to
// draw it at.
export interface IdeaIcon {
	styleKey: string;
	width: number;
	height: number;
}

export interface IdeaCard {
	id: string;
	category: string;
	name: LocText;
	desc: LocText;
	// True when the idea declared `name = <other key>` rather than being localised under its own
	// key. Worth showing, because it is how a swapped-in idea keeps the name of the one it replaced.
	borrowsName: boolean;
	icon?: IdeaIcon;
	// The idea its category starts with, and whether that category is a law. Both are drawn as
	// badges and both are filterable, so they travel as booleans rather than being read back out of
	// the localised badge text.
	isDefault: boolean;
	isLaw: boolean;
	// Short facts drawn as badges: cost, level, removal cost, trait names.
	badges: string[];
	modifiers: ModifierLine[];
	research: ModifierLine[];
	targeted: ModifierGroup[];
	equipment: ModifierGroup[];
	// `allowed` and `available` are the two the reader cares about: one decides which countries ever
	// see the idea, the other decides when it can be taken. `true` means the block was absent.
	allowed: ConditionComplexExpr;
	available: ConditionComplexExpr;
	hasEffects: boolean;
	nav?: NavTarget;
}

export interface IdeaGroup {
	category: string;
	isLaw: boolean;
	isDesigner: boolean;
	// Idea ids in file order. Ideas that belong to a chain still appear here; the webview reads
	// `chains` to decide which of them to draw as a run.
	ideaIds: string[];
	nav?: NavTarget;
}

// One run of ideas that swap into each other, in order. Built from the swap index, so a file
// previewed with that index off has none.
export interface IdeaChain {
	// Ids in swap order. Ids outside the previewed file are kept, so a chain that leaves the file
	// still shows where it goes.
	ideaIds: string[];
	// Where each swap was written, indexed by the position of the *source* idea in `ideaIds`.
	sources: (NavTarget | undefined)[];
}

// Which toolbar controls this file can actually use. A control whose flag is false would produce
// identical output in either position, so the webview hides it rather than offering something the
// preview cannot deliver.
//
// These ride in the payload rather than deciding the toolbar markup on the host, because the
// toolbar is part of the baked-in shell: markup that changed with the file would need a full html
// reassignment to apply, tearing the page down and losing scroll on every flip.
export interface IdeaToolbarFlags {
	hasLocalisation: boolean;
	hasDescriptions: boolean;
	hasIcons: boolean;
	hasModifiers: boolean;
	hasResearch: boolean;
	hasConditions: boolean;
	hasLaws: boolean;
	hasDefaults: boolean;
	hasChains: boolean;
	// The swap index is switched off, so no chain could be found whether or not one exists. The
	// webview says so instead of leaving the reader to wonder why a known chain is missing.
	chainsUnavailable: boolean;
}

export interface IdeaPreviewPayload {
	groups: IdeaGroup[];
	cards: IdeaCard[];
	chains: IdeaChain[];
	conditionExprs: ConditionItem[];
	toolbarFlags: IdeaToolbarFlags;
}
