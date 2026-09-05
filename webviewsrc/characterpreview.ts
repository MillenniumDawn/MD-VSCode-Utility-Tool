import { tryRun, subscribeNavigators, initCommon, getState, setState } from "./util/common";
import { SearchBox } from "./util/searchbox";
import { applyNav, badge } from "./util/card";
import { FilterControl, gateToggle, readFilterList, toggleBinder } from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { wireUpdateBody } from "./util/updatebody";
import { ConditionComplexExpr } from "../src/hoiformat/condition";
import { conditionPanel as conditionTreePanel } from "./util/conditiontree";
import {
	CharacterCard,
	CharacterPreviewPayload,
	CharacterRoleGroup,
	CharacterToolbarFlags,
	ModifierGroup,
	ModifierLine,
	TraitCard,
} from "../src/previewdef/character/payload";

initCommon();

const emptyPayload: CharacterPreviewPayload = {
	groups: [],
	cards: [],
	conditionExprs: [],
	toolbarFlags: {
		hasLocalisation: false,
		hasDescriptions: false,
		hasPortraits: false,
		hasSkills: false,
		hasTraitDetail: false,
		hasConditions: false,
		hasMultiRole: false,
		hasUnknownTraits: false,
		hasMissingPortraits: false,
	},
};

let payload: CharacterPreviewPayload =
	(window as unknown as { characterPreview?: CharacterPreviewPayload })
		.characterPreview ?? emptyPayload;

let showLocalisation: boolean = getState().showLocalisation ?? true;
let showPortrait: boolean = getState().characterShowPortrait ?? true;
let showSkills: boolean = getState().characterShowSkills ?? true;
// Off by default: opening every trait on every card turns a scannable roster into a wall. A trait
// is one click away, and this toggle opens all of them at once for a reader who wants that.
let expandTraits: boolean = getState().characterExpandTraits ?? false;
let showDescription: boolean = getState().characterShowDescription ?? false;
let showConditions: boolean = getState().characterShowConditions ?? false;

//#region Filtering

export type CharacterFilter =
	| "multirole"
	| "unknowntrait"
	| "noportrait"
	| "traits"
	| "conditions";

// Canonical order: what the toolbar lists, and what a stored selection is normalised back into.
export const characterFilters: CharacterFilter[] = [
	"multirole",
	"unknowntrait",
	"noportrait",
	"traits",
	"conditions",
];

const filterAvailability: Record<CharacterFilter, keyof CharacterToolbarFlags> = {
	multirole: "hasMultiRole",
	unknowntrait: "hasUnknownTraits",
	noportrait: "hasMissingPortraits",
	traits: "hasTraitDetail",
	conditions: "hasConditions",
};

// Every toggle rebuilds the roster, so the rebuild is bound once instead of at each call site.
const bindToggle = toggleBinder(buildContent);

// Owns the filter widget and the guard that tells a selection this module pushed into it from one
// the reader chose.
const filterControl = new FilterControl<CharacterFilter>({
	selectId: "character-filters",
	containerId: "character-filter-container",
	all: characterFilters,
	emptyKey: "characterpreview.filterall",
	emptyText: "(All characters)",
	onChange: (selection) => {
		filters = selection;
		setState({ characterFilters: filters });
		buildContent();
	},
});

export function readFilters(stored: unknown): CharacterFilter[] {
	return readFilterList(characterFilters, stored);
}

// Empty by default: an opt-in filter must never hide anything the first time the preview is opened.
//
// This has to stay below `characterFilters`, not up with the other restored toggles: `readFilters`
// is hoisted but the list it reads is not, so calling it earlier throws on the const in its temporal
// dead zone and takes the whole module -- and with it the roster -- down. The tests compile to
// commonjs, where the same read is a property access that quietly answers `undefined`, so only the
// bundled preview shows it.
let filters: CharacterFilter[] = readFilters(getState().characterFilters);

/**
 * Whether one card survives a selection. Selecting nothing shows everything, and selecting several
 * is an OR: each entry answers the same question, so they widen rather than narrow each other.
 */
export function matchesFilters(
	card: CharacterCard,
	selection: CharacterFilter[],
): boolean {
	if (selection.length === 0) {
		return true;
	}

	return selection.some((filter) => {
		switch (filter) {
			case "multirole":
				return card.otherRoles.length > 0;
			case "unknowntrait":
				return card.hasUnknownTrait;
			case "noportrait":
				return card.portraitMissing;
			case "traits":
				return card.traits.length > 0;
			case "conditions":
				return card.allowed !== true || card.available !== true || card.visible !== true;
		}
	});
}

export function matchesQuery(card: CharacterCard, query: string): boolean {
	if (query === "") {
		return false;
	}

	// The badges carry the advisor slot, the idea token and the ideology, which is what a reader
	// searching "army_chief" is actually after.
	if (
		[card.characterId, card.name.key, card.name.text, card.roleKind, ...card.badges].some(
			(field) => field.toLowerCase().includes(query),
		)
	) {
		return true;
	}

	if (
		card.traits.some(
			(trait) =>
				trait.id.toLowerCase().includes(query) ||
				trait.name.text.toLowerCase().includes(query),
		)
	) {
		return true;
	}

	// A modifier is often what the reader is looking for -- "which characters touch stability" -- so
	// both the token it is written with and the name it is shown under are searched, across the
	// traits as well as the role's own blocks.
	return linesOf(card).some(
		(line) =>
			line.key.toLowerCase().includes(query) || line.name.toLowerCase().includes(query),
	);
}

function linesOf(card: CharacterCard): ModifierLine[] {
	return [
		...card.modifiers,
		...card.research,
		...card.skills,
		...card.traits.flatMap((trait) => [
			...trait.modifiers,
			...trait.groups.flatMap((group) => group.lines),
		]),
	];
}

//#endregion

//#region Condition rendering

// The tree itself is drawn by util/conditiontree.ts, which the event, decision and idea previews
// share. Only the fold wording is this preview's own.
const foldLabels: Record<string, string> = {
	and: "all of",
	or: "any of",
	andnot: "not all of",
	ornot: "none of",
	count: "at least",
};

function conditionPanel(condition: ConditionComplexExpr, label: string): HTMLDivElement {
	return conditionTreePanel(condition, label, foldLabels);
}

//#endregion

//#region Card rendering

interface RenderedCard {
	card: CharacterCard;
	element: HTMLDivElement;
}

let rendered: RenderedCard[] = [];

function textFor(loc: { key: string; text: string }): string {
	return showLocalisation ? loc.text : loc.key;
}

export function modifierLineToDom(line: ModifierLine): HTMLDivElement {
	const row = document.createElement("div");
	row.className = "char-mod";

	const name = document.createElement("span");
	name.className = "char-mod-name";
	name.textContent = line.name;
	// The token the file was written with, for a reader who has to go and find it.
	name.title = line.key;
	row.appendChild(name);

	const value = document.createElement("span");
	value.className = "char-mod-value char-mod-" + line.tone;
	value.textContent = line.value;
	row.appendChild(value);

	return row;
}

function modifierSection(
	title: string | undefined,
	lines: ModifierLine[],
): HTMLDivElement | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const box = document.createElement("div");
	box.className = "char-mods";
	if (title !== undefined) {
		const head = document.createElement("div");
		head.className = "char-mods-head";
		head.textContent = title;
		box.appendChild(head);
	}
	for (const line of lines) {
		box.appendChild(modifierLineToDom(line));
	}
	return box;
}

function appendGroups(container: HTMLElement, groups: ModifierGroup[]): void {
	for (const group of groups) {
		const section = modifierSection(group.title, group.lines);
		if (section) {
			container.appendChild(section);
		}
	}
}

/**
 * One trait: a pill that opens what the trait grants.
 *
 * The modifiers are built with the pill rather than on first click, because they are already in the
 * payload -- there is nothing to fetch, and building them up front is what lets the "Expand traits"
 * toggle open every trait on the page without a second pass.
 */
export function traitToDom(trait: TraitCard): HTMLDivElement {
	const box = document.createElement("div");
	box.className = "char-trait-box";

	const pill = document.createElement("button");
	pill.type = "button";
	pill.className = "char-trait" + (trait.known ? "" : " char-trait-unknown");
	pill.textContent = textFor(trait.name);

	if (!trait.known) {
		// The single most useful thing this preview says: the file names a trait nothing defines,
		// which in a hand-written character is almost always a typo.
		pill.title = feLocalize("characterpreview.unknowntrait", "No trait file defines {0}", trait.id);
		box.appendChild(pill);
		return box;
	}

	pill.title = trait.id;

	const detail = document.createElement("div");
	detail.className = "char-trait-mods";

	if (showDescription && trait.desc.text !== trait.desc.key) {
		const desc = document.createElement("div");
		desc.className = "char-trait-desc";
		desc.textContent = trait.desc.text;
		detail.appendChild(desc);
	}

	const modifiers = modifierSection(undefined, trait.modifiers);
	if (modifiers) {
		detail.appendChild(modifiers);
	}
	appendGroups(detail, trait.groups);

	if (detail.childElementCount === 0) {
		const note = document.createElement("div");
		note.className = "char-trait-note";
		note.textContent = feLocalize(
			"characterpreview.traitnodetail",
			"This trait grants nothing the preview can read",
		);
		detail.appendChild(note);
	}

	// Navigating to the trait's own file is on the pill, but only for a trait that has one to go
	// to: applyNav leaves an element with nowhere to go alone.
	applyNav(pill, trait.nav);

	const open = expandTraits;
	detail.hidden = !open;
	pill.setAttribute("aria-expanded", String(open));
	pill.addEventListener(
		"click",
		tryRun((e: Event) => {
			// A trait with a nav target is also a navigator, and subscribeNavigators opens the file on
			// click. Ctrl/meta keeps that; a plain click expands, which is the far more common intent.
			const mouse = e as MouseEvent;
			if (mouse.ctrlKey || mouse.metaKey) {
				return;
			}
			// stopImmediatePropagation, not stopPropagation: subscribeNavigators puts its listener on
			// this same pill, and stopping the bubble does nothing about a second listener on the
			// element the event is already at. This one is registered while the card is built, before
			// subscribeNavigators runs, so it is first and does get to cancel the rest.
			e.stopImmediatePropagation();
			detail.hidden = !detail.hidden;
			pill.setAttribute("aria-expanded", String(!detail.hidden));
		}),
	);

	box.appendChild(pill);
	box.appendChild(detail);
	return box;
}

function buildCard(card: CharacterCard): HTMLDivElement {
	const element = document.createElement("div");
	element.className =
		"ev-card char-card" + (card.hasUnknownTrait ? " char-card-warn" : "");
	element.tabIndex = 0;
	applyNav(element, card.nav);

	const head = document.createElement("div");
	head.className = "ev-head";

	if (showPortrait) {
		if (card.portrait) {
			const portrait = document.createElement("div");
			portrait.className = "char-portrait " + card.portrait.styleKey;
			if (card.portraitPath !== undefined) {
				portrait.title = card.portraitPath;
			}
			head.appendChild(portrait);
		} else if (card.portraitMissing) {
			// A path was written and nothing resolved it. Drawn rather than omitted, because a broken
			// portrait is the thing the author needs to see.
			const missing = document.createElement("div");
			missing.className = "char-portrait char-portrait-missing";
			missing.title = feLocalize(
				"characterpreview.portraitmissing",
				"Portrait not found: {0}",
				card.portraitPath ?? "",
			);
			head.appendChild(missing);
		}
	}

	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = card.characterId;
	text.appendChild(id);

	const name = textFor(card.name);
	// The name is only worth a second line when it says something the id did not.
	if (name !== card.characterId) {
		const sub = document.createElement("div");
		sub.className = "ev-sub";
		sub.textContent = name;
		text.appendChild(sub);
	}
	head.appendChild(text);
	element.appendChild(head);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	for (const value of card.badges) {
		badge(meta, "", value);
	}
	if (card.otherRoles.length > 0) {
		// How a multi-role character is recognised from inside a single group: the card says where
		// else the same person appears.
		badge(
			meta,
			"char-badge-roles",
			feLocalize("characterpreview.alsoroles", "Also: {0}", card.otherRoles.join(", ")),
		);
	}
	if (card.hasEffects) {
		badge(meta, "", feLocalize("characterpreview.haseffects", "on_add / on_remove"));
	}
	if (meta.childElementCount > 0) {
		element.appendChild(meta);
	}

	if (showDescription && card.desc.text !== card.desc.key) {
		const desc = document.createElement("div");
		desc.className = "char-desc";
		desc.textContent = card.desc.text;
		element.appendChild(desc);
	}

	if (showSkills) {
		const skills = modifierSection(undefined, card.skills);
		if (skills) {
			skills.classList.add("char-skills");
			element.appendChild(skills);
		}
	}

	if (card.traits.length > 0) {
		const traits = document.createElement("div");
		traits.className = "char-traits";
		for (const trait of card.traits) {
			traits.appendChild(traitToDom(trait));
		}
		element.appendChild(traits);
	}

	const modifiers = modifierSection(undefined, card.modifiers);
	if (modifiers) {
		element.appendChild(modifiers);
	}
	const research = modifierSection(
		feLocalize("characterpreview.research", "Research bonus"),
		card.research,
	);
	if (research) {
		element.appendChild(research);
	}

	if (showConditions) {
		if (card.allowed !== true) {
			element.appendChild(
				conditionPanel(card.allowed, feLocalize("characterpreview.allowed", "Allowed")),
			);
		}
		if (card.available !== true) {
			element.appendChild(
				conditionPanel(card.available, feLocalize("characterpreview.available", "Available")),
			);
		}
		if (card.visible !== true) {
			element.appendChild(
				conditionPanel(card.visible, feLocalize("characterpreview.visible", "Visible")),
			);
		}
	}

	return element;
}

//#endregion

//#region Roster

// Each unit of work is a batch of cards, so a file of a hundred characters paints its first group
// immediately rather than freezing until the last portrait is placed.
type RenderTask = () => void;

// How many cards one task builds. Small enough that the budget loop below can stop between two of
// them on the largest real file, large enough that a small file is still one or two tasks.
const cardsPerBatch = 20;

let renderGeneration = 0;

function runTasks(tasks: RenderTask[], done: () => void): void {
	const generation = ++renderGeneration;
	let index = 0;

	// jsdom has no requestAnimationFrame, and the tests drive this path; running straight through
	// there is also what a test wants, since it has nothing to wait on.
	const schedule =
		typeof requestAnimationFrame === "function"
			? requestAnimationFrame
			: (fn: () => void) => {
					fn();
					return 0;
				};

	const step = () => {
		// A newer build started while this one was still painting: its output is what belongs on
		// screen, so this one stops rather than appending into a container it no longer owns.
		if (generation !== renderGeneration) {
			return;
		}

		const deadline = Date.now() + 8;
		while (index < tasks.length && Date.now() < deadline) {
			tasks[index]?.();
			index++;
		}

		if (index < tasks.length) {
			schedule(step);
		} else {
			done();
		}
	};

	step();
}

function buildContent(): void {
	const container = document.getElementById(
		"characterpreviewcontent",
	) as HTMLDivElement | null;
	if (!container) {
		return;
	}

	applyToolbarFlags();

	container.textContent = "";
	rendered = [];

	const visibleCards = payload.cards.filter((c) => matchesFilters(c, filters));
	const visibleIds = new Set(visibleCards.map((c) => c.cardId));
	const cardsById = new Map(payload.cards.map((c) => [c.cardId, c]));

	if (visibleCards.length === 0) {
		const empty = document.createElement("div");
		empty.className = "char-empty";
		empty.textContent = feLocalize(
			"characterpreview.nocharacters",
			"No characters to show.",
		);
		container.appendChild(empty);
		// Nothing to highlight, but the counter still has to stop claiming the matches of the roster
		// that was on screen a moment ago -- which is what refreshing with the emptied list does.
		search.refresh(rendered);
		return;
	}

	const tasks: RenderTask[] = [];
	for (const group of payload.groups) {
		const groupCards = group.cardIds
			.map((id) => cardsById.get(id))
			.filter((c): c is CharacterCard => c !== undefined && visibleIds.has(c.cardId));
		if (groupCards.length === 0) {
			continue;
		}

		// The header and an empty flow first, so the group is on screen before its cards are; the
		// cards then go in a batch at a time.
		let flow: HTMLDivElement | undefined = undefined;
		tasks.push(() => {
			const section = buildGroup(group, groupCards.length);
			flow = section.flow;
			container.appendChild(section.element);
		});

		for (let i = 0; i < groupCards.length; i += cardsPerBatch) {
			const batch = groupCards.slice(i, i + cardsPerBatch);
			tasks.push(() => {
				if (!flow) {
					return;
				}
				for (const card of batch) {
					const element = buildCard(card);
					rendered.push({ card, element });
					flow.appendChild(element);
				}
			});
		}
	}

	runTasks(tasks, () => {
		subscribeNavigators();
		search.refresh(rendered);
	});
}

function buildGroup(
	group: CharacterRoleGroup,
	count: number,
): { element: HTMLDivElement; flow: HTMLDivElement } {
	const section = document.createElement("div");
	section.className = "char-group";

	const head = document.createElement("div");
	head.className = "char-group-head";
	const name = document.createElement("span");
	name.className = "char-group-name";
	name.textContent = group.title;
	head.appendChild(name);
	const countElement = document.createElement("span");
	countElement.className = "char-group-count";
	countElement.textContent = feLocalize(
		"characterpreview.charactercount",
		"{0} character(s)",
		count,
	);
	head.appendChild(countElement);
	section.appendChild(head);

	const flow = document.createElement("div");
	flow.className = "char-flow";
	section.appendChild(flow);

	return { element: section, flow };
}

//#endregion

//#region Search

const search = new SearchBox<RenderedCard>({
	boxId: "character-searchbox",
	countId: "character-search-count",
	stateKey: "characterSearchQuery",
	noMatchesKey: "characterpreview.nomatches",
	countKey: "characterpreview.searchmatches",
	matches: (item, query) => matchesQuery(item.card, query),
	target: (item) => ({
		id: item.card.cardId,
		element: item.element,
		highlight: item.element,
	}),
});

//#endregion

//#region Toolbar

// Used when a payload arrives without flags -- an older cached page, or the empty payload above.
// Offering every control is the safe direction: a control that turns out to do nothing is a smaller
// problem than one that is missing.
const allToolbarControls: CharacterToolbarFlags = {
	hasLocalisation: true,
	hasDescriptions: true,
	hasPortraits: true,
	hasSkills: true,
	hasTraitDetail: true,
	hasConditions: true,
	hasMultiRole: true,
	hasUnknownTraits: true,
	hasMissingPortraits: true,
};

function applyToolbarFlags(): void {
	const flags = payload.toolbarFlags ?? allToolbarControls;
	const state = getState();
	// The neutral value is the position that shows the most: with nothing to hide, "show it" is the
	// honest state. Description and trait expansion are the exceptions -- see their declarations.
	showLocalisation = gateToggle(
		"show-localisation",
		flags.hasLocalisation,
		state.showLocalisation,
		true,
	);
	showPortrait = gateToggle(
		"show-portrait",
		flags.hasPortraits || flags.hasMissingPortraits,
		state.characterShowPortrait,
		true,
	);
	showSkills = gateToggle("show-skills", flags.hasSkills, state.characterShowSkills, true);
	expandTraits = gateToggle(
		"expand-traits",
		flags.hasTraitDetail,
		state.characterExpandTraits,
		false,
	);
	showDescription = gateToggle(
		"show-description",
		flags.hasDescriptions,
		state.characterShowDescription,
		false,
	);
	showConditions = gateToggle(
		"show-conditions",
		flags.hasConditions,
		state.characterShowConditions,
		false,
	);
	filters = filterControl.gate(
		(filter) => flags[filterAvailability[filter]],
		readFilters(state.characterFilters),
	);
}

//#endregion

wireUpdateBody<CharacterPreviewPayload>({
	contentId: "characterpreviewcontent",
	styleId: "character-server-styles",
	dataKey: "characterPreview",
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
		bindToggle("show-portrait", showPortrait, (value) => {
			showPortrait = value;
			setState({ characterShowPortrait: value });
		});
		bindToggle("show-skills", showSkills, (value) => {
			showSkills = value;
			setState({ characterShowSkills: value });
		});
		bindToggle("expand-traits", expandTraits, (value) => {
			expandTraits = value;
			setState({ characterExpandTraits: value });
		});
		bindToggle("show-description", showDescription, (value) => {
			showDescription = value;
			setState({ characterShowDescription: value });
		});
		bindToggle("show-conditions", showConditions, (value) => {
			showConditions = value;
			setState({ characterShowConditions: value });
		});
		filterControl.wire(filters);

		// Before the first buildContent, so the restored query is applied by the first render rather
		// than only by the next one.
		search.wire();

		buildContent();
	}),
);

// Exported for the tests, which drive the roster without a load event.
export { buildContent };
