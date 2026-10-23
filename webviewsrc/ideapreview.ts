import { tryRun, subscribeNavigators, initCommon, getState, setState } from "./util/common";
import { SearchBox } from "./util/searchbox";
import { appendGroups, applyNav, badge, modifierSection } from "./util/card";
import {
	FilterControl,
	bindLocalisationToggle,
	gateToggle,
	readFilterList,
	toggleBinder,
} from "./util/toolbar";
import { feLocalize } from "./util/i18n";
import { wireUpdateBody } from "./util/updatebody";
import { cardFoldLabels, conditionPanel } from "./util/conditiontree";
import { RenderTask, RenderedCard, pushGroupTasks, taskRunner } from "./util/batchrender";
import {
	IdeaCard,
	IdeaChain,
	IdeaGroup,
	IdeaPreviewPayload,
	IdeaToolbarFlags,
	NavTarget,
} from "../src/previewdef/idea/payload";

initCommon();

const emptyPayload: IdeaPreviewPayload = {
	groups: [],
	cards: [],
	chains: [],
	conditionExprs: [],
	toolbarFlags: {
		hasLocalisation: false,
		hasDescriptions: false,
		hasIcons: false,
		hasModifiers: false,
		hasResearch: false,
		hasConditions: false,
		hasLaws: false,
		hasDefaults: false,
		hasChains: false,
		chainsUnavailable: false,
	},
};

let payload: IdeaPreviewPayload =
	(window as unknown as { ideaPreview?: IdeaPreviewPayload }).ideaPreview ?? emptyPayload;

let showLocalisation: boolean = getState().showLocalisation ?? true;
let showIcon: boolean = getState().ideaShowIcon ?? true;
let showModifiers: boolean = getState().ideaShowModifiers ?? true;
// Off by default: a description is several lines of prose on a card that is otherwise scannable, so
// it is the one thing the reader asks for rather than the one thing they have to turn off.
let showDescription: boolean = getState().ideaShowDescription ?? false;
let showConditions: boolean = getState().ideaShowConditions ?? false;

//#region Filtering

export type IdeaFilter =
	| "laws"
	| "default"
	| "modifiers"
	| "research"
	| "conditions"
	| "chains";

// Canonical order: what the toolbar lists, and what a stored selection is normalised back into.
export const ideaFilters: IdeaFilter[] = [
	"laws",
	"default",
	"modifiers",
	"research",
	"conditions",
	"chains",
];

const filterAvailability: Record<IdeaFilter, keyof IdeaToolbarFlags> = {
	laws: "hasLaws",
	default: "hasDefaults",
	modifiers: "hasModifiers",
	research: "hasResearch",
	conditions: "hasConditions",
	chains: "hasChains",
};

// Every toggle rebuilds the canvas, so the rebuild is bound once instead of at each call site.
const bindToggle = toggleBinder(buildContent);

// Owns the filter widget and the guard that tells a selection this module pushed into it from
// one the reader chose.
const filterControl = new FilterControl<IdeaFilter>({
	selectId: "idea-filters",
	containerId: "idea-filter-container",
	all: ideaFilters,
	emptyKey: "ideapreview.filterall",
	emptyText: "(All ideas)",
	onChange: (selection) => {
		filters = selection;
		setState({ ideaFilters: filters });
		buildContent();
	},
});

export function readFilters(stored: unknown): IdeaFilter[] {
	return readFilterList(ideaFilters, stored);
}

// Empty by default: an opt-in filter must never hide anything the first time the preview is opened.
// It stays below `ideaFilters` for the reason readFilterList gives.
let filters: IdeaFilter[] = readFilters(getState().ideaFilters);

/**
 * Whether one card survives a selection. Selecting nothing shows everything, and selecting several
 * is an OR: each entry answers the same question, so they widen rather than narrow each other.
 */
export function matchesFilters(
	card: IdeaCard,
	selection: IdeaFilter[],
	chained: Set<string>,
): boolean {
	if (selection.length === 0) {
		return true;
	}

	return selection.some((filter) => {
		switch (filter) {
			case "laws":
				return card.isLaw;
			case "default":
				return card.isDefault;
			case "modifiers":
				return (
					card.modifiers.length > 0 ||
					card.targeted.length > 0 ||
					card.equipment.length > 0
				);
			case "research":
				return card.research.length > 0;
			case "conditions":
				return card.allowed !== true || card.available !== true;
			case "chains":
				return chained.has(card.id);
		}
	});
}

export function chainedIds(chains: IdeaChain[]): Set<string> {
	const ids = new Set<string>();
	for (const chain of chains) {
		for (const id of chain.ideaIds) {
			ids.add(id);
		}
	}
	return ids;
}

export function matchesQuery(card: IdeaCard, query: string): boolean {
	if (query === "") {
		return false;
	}

	if (
		[card.id, card.name.key, card.name.text, card.category].some((field) =>
			field.toLowerCase().includes(query),
		)
	) {
		return true;
	}

	// A modifier is often what the reader is actually looking for -- "which ideas touch stability" --
	// so both the token it is written with and the name it is shown under are searched.
	const lines = [
		...card.modifiers,
		...card.research,
		...card.targeted.flatMap((g) => g.lines),
		...card.equipment.flatMap((g) => g.lines),
	];
	return lines.some(
		(line) =>
			line.key.toLowerCase().includes(query) || line.name.toLowerCase().includes(query),
	);
}

//#endregion

//#region Card rendering

let rendered: RenderedCard<IdeaCard>[] = [];

function textFor(loc: { key: string; text: string }): string {
	return showLocalisation ? loc.text : loc.key;
}

function buildCard(card: IdeaCard): HTMLDivElement {
	const element = document.createElement("div");
	element.className =
		"ev-card idea-card" + (card.isDefault ? " idea-card-default" : "");
	element.tabIndex = 0;
	applyNav(element, card.nav);

	const head = document.createElement("div");
	head.className = "ev-head";

	if (showIcon && card.icon) {
		const icon = document.createElement("div");
		icon.className = "idea-icon " + card.icon.styleKey;
		head.appendChild(icon);
	}

	const text = document.createElement("div");
	text.className = "ev-text";
	const id = document.createElement("div");
	id.className = "ev-id";
	id.textContent = card.id;
	text.appendChild(id);

	const name = textFor(card.name);
	// The name is only worth a second line when it says something the id did not.
	if (name !== card.id) {
		const sub = document.createElement("div");
		sub.className = "ev-sub" + (card.borrowsName ? " idea-borrowed" : "");
		sub.textContent = name;
		if (card.borrowsName) {
			sub.title = feLocalize(
				"ideapreview.borrowedname",
				"Localised as {0}",
				card.name.key,
			);
		}
		text.appendChild(sub);
	}
	head.appendChild(text);
	element.appendChild(head);

	const meta = document.createElement("div");
	meta.className = "ev-meta";
	if (card.isDefault) {
		badge(meta, "", feLocalize("ideapreview.default", "Default"));
	}
	if (card.isLaw) {
		badge(meta, "", feLocalize("ideapreview.law", "Law"));
	}
	for (const text of card.badges) {
		badge(meta, "", text);
	}
	if (card.hasEffects) {
		badge(meta, "", feLocalize("ideapreview.haseffects", "on_add / on_remove"));
	}
	if (meta.childElementCount > 0) {
		element.appendChild(meta);
	}

	if (showDescription && card.desc.text !== card.desc.key) {
		const desc = document.createElement("div");
		desc.className = "idea-desc";
		desc.textContent = card.desc.text;
		element.appendChild(desc);
	}

	if (showModifiers) {
		const modifiers = modifierSection("idea", undefined, card.modifiers);
		if (modifiers) {
			element.appendChild(modifiers);
		}
		const research = modifierSection(
			"idea",
			feLocalize("ideapreview.research", "Research bonus"),
			card.research,
		);
		if (research) {
			element.appendChild(research);
		}
		appendGroups("idea", element, card.targeted);
		appendGroups("idea", element, card.equipment);
	}

	if (showConditions) {
		if (card.allowed !== true) {
			element.appendChild(
				conditionPanel(
					card.allowed,
					feLocalize("ideapreview.allowed", "Allowed"),
					cardFoldLabels,
				),
			);
		}
		if (card.available !== true) {
			element.appendChild(
				conditionPanel(
					card.available,
					feLocalize("ideapreview.available", "Available"),
					cardFoldLabels,
				),
			);
		}
	}

	return element;
}

// A member of a chain this file does not define. There is nothing to show but the id and the fact
// that it is elsewhere, which is still worth showing: it is where the chain goes.
function buildExternalCard(id: string): HTMLDivElement {
	const element = document.createElement("div");
	element.className = "ev-card idea-card idea-card-external";
	element.tabIndex = 0;

	const head = document.createElement("div");
	head.className = "ev-head";
	const text = document.createElement("div");
	text.className = "ev-text";
	const idElement = document.createElement("div");
	idElement.className = "ev-id";
	idElement.textContent = id;
	text.appendChild(idElement);
	const sub = document.createElement("div");
	sub.className = "ev-sub";
	sub.textContent = feLocalize("ideapreview.elsewhere", "Defined in another file");
	text.appendChild(sub);
	head.appendChild(text);
	element.appendChild(head);

	return element;
}

function buildArrow(nav: NavTarget | undefined): HTMLDivElement {
	const arrow = document.createElement("div");
	arrow.className = "idea-arrow";
	arrow.textContent = "→";
	if (nav) {
		arrow.title = feLocalize("ideapreview.swappedin", "Swapped in by {0}", nav.file);
		applyNav(arrow, nav);
	}
	return arrow;
}

//#endregion

//#region Roster

// Which chain, if any, a group draws. A chain belongs to the group its first member in this file
// sits in, so a chain that crosses categories is drawn once rather than once per category.
export function chainsForGroups(
	groups: IdeaGroup[],
	chains: IdeaChain[],
	visible: Set<string>,
): Map<string, IdeaChain[]> {
	const groupOf = new Map<string, string>();
	for (const group of groups) {
		for (const id of group.ideaIds) {
			if (!groupOf.has(id)) {
				groupOf.set(id, group.category);
			}
		}
	}

	const byGroup = new Map<string, IdeaChain[]>();
	for (const chain of chains) {
		// A chain whose every visible member was filtered out has nothing left to attach to.
		const anchor = chain.ideaIds.find((id) => visible.has(id) && groupOf.has(id));
		if (anchor === undefined) {
			continue;
		}
		const category = groupOf.get(anchor);
		if (category === undefined) {
			continue;
		}
		const list = byGroup.get(category);
		if (list) {
			list.push(chain);
		} else {
			byGroup.set(category, [chain]);
		}
	}

	return byGroup;
}

// How many cards one task builds. Small enough that the runner can stop between two of them on the
// largest real file, large enough that a small file is still one or two tasks.
const cardsPerBatch = 40;

const runTasks = taskRunner();

function buildContent(): void {
	const container = document.getElementById("ideapreviewcontent") as HTMLDivElement | null;
	if (!container) {
		return;
	}

	applyToolbarFlags();

	container.textContent = "";
	rendered = [];

	const chained = chainedIds(payload.chains);
	const visibleCards = payload.cards.filter((c) => matchesFilters(c, filters, chained));
	const visibleIds = new Set(visibleCards.map((c) => c.id));
	const cardsById = new Map(payload.cards.map((c) => [c.id, c]));
	const chainsByGroup = chainsForGroups(payload.groups, payload.chains, visibleIds);

	if (payload.toolbarFlags.chainsUnavailable) {
		const note = document.createElement("div");
		note.className = "idea-note";
		note.textContent = feLocalize(
			"ideapreview.chainsoff",
			"Idea chains are not shown: turn on the Idea Swap Index setting to have swap_ideas looked up across the workspace.",
		);
		container.appendChild(note);
	}

	if (visibleCards.length === 0) {
		const empty = document.createElement("div");
		empty.className = "idea-empty";
		empty.textContent = feLocalize("ideapreview.noideas", "No ideas to show.");
		container.appendChild(empty);
		// An empty run still stops one in flight, which would otherwise paint its groups under this.
		// Nothing to highlight, but the counter still has to stop claiming the matches of the roster
		// that was on screen a moment ago -- which is what refreshing with the emptied list does.
		runTasks([], () => search.refresh(rendered));
		return;
	}

	const tasks: RenderTask[] = [];
	for (const group of payload.groups) {
		const groupCards = group.ideaIds
			.map((id) => cardsById.get(id))
			.filter((c): c is IdeaCard => c !== undefined && visibleIds.has(c.id));
		const groupChains = chainsByGroup.get(group.category) ?? [];

		// A chained idea is drawn in its chain's row and nowhere else, even when that row is filed
		// under another category: a visible member always gives its chain an anchor, so the row exists.
		const loose = groupCards.filter((c) => !chained.has(c.id));
		if (loose.length === 0 && groupChains.length === 0) {
			continue;
		}

		// The cards go in batches rather than a group at a time: Millennium Dawn's largest ideas file
		// is a single category of nearly eight hundred ideas, and one task per group would put that
		// whole file in one unbroken block.
		pushGroupTasks(
			tasks,
			() => {
				const section = buildGroup(group, loose.length, groupChains, visibleIds, cardsById);
				container.appendChild(section.element);
				return section.flow;
			},
			loose,
			cardsPerBatch,
			buildCard,
			rendered,
		);
	}

	runTasks(tasks, () => {
		subscribeNavigators();
		search.refresh(rendered);
	});
}

// The group's header and its chain rows, plus the empty flow the loose cards are batched into
// afterwards. The chains are built here rather than batched: a chain is read as one row, and half a
// row with the arrows still in it would say something the file does not.
function buildGroup(
	group: IdeaGroup,
	looseCount: number,
	groupChains: IdeaChain[],
	visibleIds: Set<string>,
	cardsById: Map<string, IdeaCard>,
): { element: HTMLDivElement; flow: HTMLDivElement } {
	const section = document.createElement("div");
	section.className = "idea-group";

	const head = document.createElement("div");
	head.className = "idea-group-head";
	const name = document.createElement("span");
	name.className = "idea-group-name";
	name.textContent = group.category;
	applyNav(name, group.nav);
	head.appendChild(name);
	const count = document.createElement("span");
	count.className = "idea-group-count";
	const shown =
		looseCount +
		groupChains.reduce(
			(n, chain) => n + chain.ideaIds.filter((id) => cardsById.has(id)).length,
			0,
		);
	count.textContent = feLocalize("ideapreview.ideacount", "{0} idea(s)", shown);
	head.appendChild(count);
	if (group.isLaw) {
		const tag = document.createElement("span");
		tag.className = "idea-group-tag";
		tag.textContent = feLocalize("ideapreview.law", "Law");
		head.appendChild(tag);
	}
	section.appendChild(head);

	for (const chain of groupChains) {
		section.appendChild(buildChain(chain, visibleIds, cardsById));
	}

	const flow = document.createElement("div");
	flow.className = "idea-flow";
	section.appendChild(flow);

	return { element: section, flow };
}

function buildChain(
	chain: IdeaChain,
	visibleIds: Set<string>,
	cardsById: Map<string, IdeaCard>,
): HTMLDivElement {
	const row = document.createElement("div");
	row.className = "idea-chain";

	chain.ideaIds.forEach((id, index) => {
		if (index > 0) {
			row.appendChild(buildArrow(chain.sources[index - 1]));
		}

		const card = cardsById.get(id);
		// A chain is drawn whole, including members a filter would otherwise have removed: half a
		// chain with the arrows still in it says something the file does not.
		if (card) {
			const element = buildCard(card);
			if (visibleIds.has(id)) {
				rendered.push({ card, element });
			}
			row.appendChild(element);
		} else {
			row.appendChild(buildExternalCard(id));
		}
	});

	return row;
}

//#endregion

//#region Search

const search = new SearchBox<RenderedCard<IdeaCard>>({
	boxId: "idea-searchbox",
	countId: "idea-search-count",
	stateKey: "ideaSearchQuery",
	noMatchesKey: "ideapreview.nomatches",
	countKey: "ideapreview.searchmatches",
	matches: (item, query) => matchesQuery(item.card, query),
	target: (item) => ({ id: item.card.id, element: item.element, highlight: item.element }),
});

//#endregion

//#region Toolbar

// Used when a payload arrives without flags -- an older cached page, or the empty payload above.
// Offering every control is the safe direction: a control that turns out to do nothing is a smaller
// problem than one that is missing.
const allToolbarControls: IdeaToolbarFlags = {
	hasLocalisation: true,
	hasDescriptions: true,
	hasIcons: true,
	hasModifiers: true,
	hasResearch: true,
	hasConditions: true,
	hasLaws: true,
	hasDefaults: true,
	hasChains: true,
	chainsUnavailable: false,
};

function applyToolbarFlags(): void {
	const flags = payload.toolbarFlags ?? allToolbarControls;
	const state = getState();
	// The neutral value is the position that shows the most: with nothing to hide, "show it" is the
	// honest state. Description is the exception -- see its declaration.
	showLocalisation = gateToggle("show-localisation", flags.hasLocalisation, state.showLocalisation, true);
	showIcon = gateToggle("show-icon", flags.hasIcons, state.ideaShowIcon, true);
	showModifiers = gateToggle("show-modifiers", flags.hasModifiers, state.ideaShowModifiers, true);
	showDescription = gateToggle("show-description", flags.hasDescriptions, state.ideaShowDescription, false);
	showConditions = gateToggle("show-conditions", flags.hasConditions, state.ideaShowConditions, false);
	filters = filterControl.gate(
		(filter) => flags[filterAvailability[filter]],
		readFilters(state.ideaFilters),
	);
}

//#endregion

wireUpdateBody<IdeaPreviewPayload>({
	contentId: "ideapreviewcontent",
	styleId: "idea-server-styles",
	dataKey: "ideaPreview",
	apply: (next) => {
		payload = next;
	},
	rebuild: buildContent,
});

window.addEventListener(
	"load",
	tryRun(function () {
		bindLocalisationToggle(bindToggle, showLocalisation, (value) => (showLocalisation = value));
		bindToggle("show-icon", showIcon, (value) => {
			showIcon = value;
			setState({ ideaShowIcon: value });
		});
		bindToggle("show-modifiers", showModifiers, (value) => {
			showModifiers = value;
			setState({ ideaShowModifiers: value });
		});
		bindToggle("show-description", showDescription, (value) => {
			showDescription = value;
			setState({ ideaShowDescription: value });
		});
		bindToggle("show-conditions", showConditions, (value) => {
			showConditions = value;
			setState({ ideaShowConditions: value });
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
