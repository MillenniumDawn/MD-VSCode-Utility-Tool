import { tryRun, subscribeNavigators, initCommon, getState, setState } from "./util/common";
import { syncCheckbox } from "./util/checkbox";
import { SearchBox } from "./util/searchbox";
import { applyNav, badge } from "./util/card";
import { DivDropdown } from "./util/dropdown";
import { feLocalize } from "./util/i18n";
import { vscode } from "./util/vscode";
import { ConditionComplexExpr } from "../src/hoiformat/condition";
import {
	conditionToDom as conditionTreeToDom,
	conditionPanel as conditionTreePanel,
} from "./util/conditiontree";
import {
	IdeaCard,
	IdeaChain,
	IdeaGroup,
	IdeaPreviewPayload,
	IdeaToolbarFlags,
	ModifierGroup,
	ModifierLine,
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
// Empty by default: an opt-in filter must never hide anything the first time the preview is opened.
let filters: IdeaFilter[] = readFilters(getState().ideaFilters);
let filterDropdown: DivDropdown | undefined = undefined;
// Set while a gated selection is being pushed into the widget, so its subscription can tell a value
// this module computed from one the reader chose. Only the second is worth storing.
let syncingFilters = false;

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

export function readFilters(stored: unknown): IdeaFilter[] {
	if (!Array.isArray(stored)) {
		return [];
	}
	return ideaFilters.filter((filter) => stored.includes(filter));
}

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

//#region Condition rendering

// The tree itself is drawn by util/conditiontree.ts, which the event and decision previews share.
// Only the fold wording is this preview's own: an idea's `count` folder has always read "at least"
// here, and one of the two spellings would have to be retired to drop the table.
//
// `not` was in the table and never used: ConditionFolderType has no such type. It is not carried
// over.
const foldLabels: Record<string, string> = {
	and: "all of",
	or: "any of",
	andnot: "not all of",
	ornot: "none of",
	count: "at least",
};

export function conditionToDom(condition: ConditionComplexExpr): HTMLUListElement {
	return conditionTreeToDom(condition, foldLabels);
}

function conditionPanel(condition: ConditionComplexExpr, label: string): HTMLDivElement {
	return conditionTreePanel(condition, label, foldLabels);
}

//#endregion

//#region Card rendering

interface RenderedCard {
	card: IdeaCard;
	element: HTMLDivElement;
}

let rendered: RenderedCard[] = [];

function textFor(loc: { key: string; text: string }): string {
	return showLocalisation ? loc.text : loc.key;
}

export function modifierLineToDom(line: ModifierLine): HTMLDivElement {
	const row = document.createElement("div");
	row.className = "idea-mod";

	const name = document.createElement("span");
	name.className = "idea-mod-name";
	name.textContent = line.name;
	// The token the file was written with, for a reader who has to go and find it.
	name.title = line.key;
	row.appendChild(name);

	const value = document.createElement("span");
	value.className = "idea-mod-value idea-mod-" + line.tone;
	value.textContent = line.value;
	row.appendChild(value);

	return row;
}

function modifierSection(title: string | undefined, lines: ModifierLine[]): HTMLDivElement | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const box = document.createElement("div");
	box.className = "idea-mods";
	if (title !== undefined) {
		const head = document.createElement("div");
		head.className = "idea-mods-head";
		head.textContent = title;
		box.appendChild(head);
	}
	for (const line of lines) {
		box.appendChild(modifierLineToDom(line));
	}
	return box;
}

function appendGroups(card: HTMLDivElement, groups: ModifierGroup[]): void {
	for (const group of groups) {
		const section = modifierSection(group.title, group.lines);
		if (section) {
			card.appendChild(section);
		}
	}
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
		const modifiers = modifierSection(undefined, card.modifiers);
		if (modifiers) {
			element.appendChild(modifiers);
		}
		const research = modifierSection(
			feLocalize("ideapreview.research", "Research bonus"),
			card.research,
		);
		if (research) {
			element.appendChild(research);
		}
		appendGroups(element, card.targeted);
		appendGroups(element, card.equipment);
	}

	if (showConditions) {
		if (card.allowed !== true) {
			element.appendChild(
				conditionPanel(card.allowed, feLocalize("ideapreview.allowed", "Allowed")),
			);
		}
		if (card.available !== true) {
			element.appendChild(
				conditionPanel(card.available, feLocalize("ideapreview.available", "Available")),
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

// Each unit of work is one group, so a file of a thousand ideas paints its first category
// immediately rather than freezing until the last one is built.
type RenderTask = () => void;

// How many cards one task builds. Small enough that the budget loop below can stop between two of
// them on the largest real file, large enough that a small file is still one or two tasks.
const cardsPerBatch = 40;

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
		// Nothing to highlight, but the counter still has to stop claiming the matches of the roster
		// that was on screen a moment ago -- which is what refreshing with the emptied list does.
		search.refresh(rendered);
		return;
	}

	const tasks: RenderTask[] = [];
	for (const group of payload.groups) {
		const groupCards = group.ideaIds
			.map((id) => cardsById.get(id))
			.filter((c): c is IdeaCard => c !== undefined && visibleIds.has(c.id));
		const groupChains = chainsByGroup.get(group.category) ?? [];
		if (groupCards.length === 0 && groupChains.length === 0) {
			continue;
		}

		// Ideas the chain rows draw are not drawn again loose below them.
		const inChain = new Set(
			groupChains.flatMap((chain) => chain.ideaIds).filter((id) => cardsById.has(id)),
		);
		const loose = groupCards.filter((c) => !inChain.has(c.id));

		// The header, the chains and an empty flow first, so the group is on screen before its cards
		// are; the cards then go in a batch at a time. Millennium Dawn's largest ideas file is a
		// single category of nearly eight hundred ideas, so a group is exactly the wrong unit to
		// stop at -- one task per group would put that whole file in one unbroken block.
		let flow: HTMLDivElement | undefined = undefined;
		tasks.push(() => {
			const section = buildGroup(group, loose.length, groupChains, visibleIds, cardsById);
			flow = section.flow;
			container.appendChild(section.element);
		});

		for (let i = 0; i < loose.length; i += cardsPerBatch) {
			const batch = loose.slice(i, i + cardsPerBatch);
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

const search = new SearchBox<RenderedCard>({
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
	filters = gateFilters(flags, readFilters(state.ideaFilters));
}

// Returns the selection that should be in force, and puts the list on screen in step with it: an
// entry this file cannot match is hidden, which is enough for DivDropdown to stop offering it, and
// the whole control goes when every entry is gone.
function gateFilters(flags: IdeaToolbarFlags, stored: IdeaFilter[]): IdeaFilter[] {
	const available = ideaFilters.filter((filter) => flags[filterAvailability[filter]]);
	const select = document.getElementById("idea-filters");
	const container = document.getElementById("idea-filter-container");

	if (container) {
		container.style.display = available.length === 0 ? "none" : "";
	}
	select?.querySelectorAll(".option").forEach((option) => {
		const value = option.getAttribute("value") as IdeaFilter | null;
		if (value !== null && available.includes(value)) {
			option.removeAttribute("hidden");
		} else {
			option.setAttribute("hidden", "");
		}
	});

	const selection = stored.filter((filter) => available.includes(filter));
	if (filterDropdown) {
		// Pushing this back into the widget is what puts the closed combobox in step with a gating
		// that just dropped an entry. The guard keeps that push out of the subscription below: it is
		// this code's own value, not a click, and storing it would lose the reader's real preference.
		syncingFilters = true;
		try {
			filterDropdown.selectedValues$.next(selection);
		} finally {
			syncingFilters = false;
		}
	}

	return selection;
}

function gateToggle(
	id: string,
	available: boolean,
	stored: boolean | undefined,
	neutral: boolean,
): boolean {
	const input = document.getElementById(id) as HTMLInputElement | null;
	const widget = input?.nextElementSibling as HTMLElement | null;
	if (widget) {
		widget.style.display = available ? "" : "none";
	}
	// `neutral` doubles as the default here.
	const value = available ? (stored ?? neutral) : neutral;
	if (input && input.checked !== value) {
		input.checked = value;
		syncCheckbox(input);
	}
	return value;
}

// The restored selection is pushed into the widget before the subscription is attached, so the
// BehaviorSubject's immediate first emission -- which carries whatever the widget was built with,
// not a choice anyone made -- cannot write an empty selection over the stored one.
function wireFilters(): void {
	const element = document.getElementById("idea-filters") as HTMLDivElement | null;
	if (!element) {
		return;
	}

	filterDropdown = new DivDropdown(element, true, {
		// Selecting nothing is not "no selection" here: it is the whole file, unfiltered.
		empty: feLocalize("ideapreview.filterall", "(All ideas)"),
	});

	syncingFilters = true;
	try {
		filterDropdown.selectedValues$.next(filters);
		filterDropdown.selectedValues$.subscribe(
			tryRun((selection: readonly string[]) => {
				if (syncingFilters) {
					return;
				}
				filters = readFilters(selection);
				setState({ ideaFilters: filters });
				buildContent();
			}),
		);
	} finally {
		syncingFilters = false;
	}
}

function bindToggle(id: string, initial: boolean, apply: (value: boolean) => void): void {
	const input = document.getElementById(id) as HTMLInputElement | null;
	if (!input) {
		return;
	}
	input.checked = initial;
	// initCommon's load handler runs before this one, so the codicon checkbox over this input was
	// already built from the unrestored value and would announce a toggle that is on as unchecked.
	syncCheckbox(input);
	input.addEventListener(
		"change",
		tryRun(() => {
			apply(input.checked);
			buildContent();
		}),
	);
}

//#endregion

// In-place update pushed by LoaderPreview when the previewed file changed: re-render from the fresh
// payload without a full reload, so scroll survives. Falls back to a full reload if the DOM the
// re-render needs is gone (e.g. the webview shows the error page, which has no listener).
window.addEventListener(
	"message",
	tryRun(function (event: MessageEvent) {
		const msg = event.data;
		if (!msg || msg.type !== "updateBody") {
			return;
		}

		const contentElement = document.getElementById("ideapreviewcontent") as HTMLDivElement | null;
		if (!contentElement) {
			vscode.postMessage({ command: "reload" });
			return;
		}

		if (typeof msg.styleCss === "string") {
			const serverStyles = document.getElementById("idea-server-styles");
			if (serverStyles) {
				serverStyles.textContent = msg.styleCss;
			}
		}

		const data = msg.data ?? {};
		if (data.ideaPreview) {
			const scrollX = window.scrollX;
			const scrollY = window.scrollY;
			payload = data.ideaPreview as IdeaPreviewPayload;
			buildContent();
			window.scrollTo(scrollX, scrollY);
		}
	}),
);

window.addEventListener(
	"load",
	tryRun(function () {
		bindToggle("show-localisation", showLocalisation, (value) => {
			showLocalisation = value;
			setState({ showLocalisation: value });
		});
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
		wireFilters();

		// Before the first buildContent, so the restored query is applied by the first render rather
		// than only by the next one.
		search.wire();

		buildContent();
	}),
);

// Exported for the tests, which drive the roster without a load event.
export { buildContent };
