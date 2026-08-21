import {
	getState,
	setState,
	arrayToMap,
	subscribeNavigators,
	scrollToState,
	tryRun,
	enableZoom,
	initCommon,
} from "./util/common";
import { DivDropdown } from "./util/dropdown";
import { difference, minBy } from "lodash";
import {
	renderGridBoxCommon,
	GridBoxItem,
	GridBoxConnection,
} from "../src/util/hoi4gui/gridboxcommon";
import { StyleTable, normalizeForStyle } from "../src/util/styletable";
import { FocusTree, Focus } from "../src/previewdef/focustree/schema";
import {
	warningBadgeClass,
	warningBoxClass,
	warningEntryClass,
	warningFlashClass,
} from "../src/previewdef/focustree/warningstyles";
import {
	traceDimClass,
	traceLineClass,
} from "../src/previewdef/focustree/tracestyles";
import { applyExclusiveLinkStyle } from "../src/util/hoi4gui/exclusivelink";
import { applyCondition, ConditionItem } from "../src/hoiformat/condition";
import { NumberPosition } from "../src/util/common";
import { GridBoxType } from "../src/hoiformat/gui";
import { toNumberLike } from "../src/hoiformat/schema";
import { feLocalize } from "./util/i18n";
import { Checkbox } from "./util/checkbox";
import { vscode } from "./util/vscode";

initCommon();

function showBranch(visibility: boolean, optionClass: string) {
	const elements = document.getElementsByClassName(optionClass);

	const hiddenBranches = getState().hiddenBranches || {};
	if (visibility) {
		delete hiddenBranches[optionClass];
	} else {
		hiddenBranches[optionClass] = true;
	}
	setState({ hiddenBranches: hiddenBranches });

	for (let i = 0; i < elements.length; i++) {
		const element = elements[i] as HTMLDivElement;
		element.style.display = element.className
			.split(" ")
			.some((b) => hiddenBranches[b])
			? "none"
			: "block";
	}
}

function search(searchContent: string, navigate: boolean = true) {
	const focuses = document.getElementsByClassName("focus");
	const searchedFocus: HTMLDivElement[] = [];
	let navigated = false;
	for (let i = 0; i < focuses.length; i++) {
		const focus = focuses[i] as HTMLDivElement;
		if (
			searchContent &&
			focus.id
				.toLowerCase()
				.replace(/^focus_/, "")
				.includes(searchContent)
		) {
			focus.style.outline = "1px solid #E33";
			focus.style.background = "rgba(255, 0, 0, 0.5)";
			if (navigate && !navigated) {
				focus.scrollIntoView({ block: "center", inline: "center" });
				navigated = true;
			}
			searchedFocus.push(focus);
		} else {
			focus.style.outlineWidth = "0";
			focus.style.background = "transparent";
		}
	}

	return searchedFocus;
}

// Prerequisite line tracing. A dense tree draws hundreds of overlapping connector lines underneath
// the nodes, so following one by eye is guesswork. Shift+clicking a focus dims every connection in
// the tree except the ones that focus's own prerequisite blocks produce. Focus nodes are left
// untouched -- only lines are filtered.
let tracedFocusId: string | undefined;

// Exported for the same reason applyWarningMarkers is: the classes landing on the emitted
// connection divs is the whole behaviour, and only a DOM test can prove it.
export function applyPrerequisiteTrace(
	root: HTMLElement,
	focusId: string | undefined,
): void {
	const connections = root.querySelectorAll("[data-conn-from]");
	for (let i = 0; i < connections.length; i++) {
		const connection = connections[i] as HTMLElement;
		connection.classList.remove(traceLineClass, traceDimClass);
		if (focusId === undefined) {
			continue;
		}

		// data-conn-from is the focus that owns the connection, and data-conn-type is written
		// before renderGridBoxConnection flips a diagonal "parent" to "child", so this pair means
		// exactly "a line one of this focus's prerequisite blocks produced". A mutually exclusive
		// link is "related" and dims with everything else.
		const isPrerequisiteOfTraced =
			connection.dataset.connFrom === focusId &&
			connection.dataset.connType === "parent";
		connection.classList.add(
			isPrerequisiteOfTraced ? traceLineClass : traceDimClass,
		);
	}
}

function reapplyPrerequisiteTrace(): void {
	const placeholder = document.getElementById("focustreeplaceholder");
	if (placeholder) {
		applyPrerequisiteTrace(placeholder, tracedFocusId);
	}
}

function setTracedFocus(focusId: string | undefined): void {
	tracedFocusId = focusId;
	reapplyPrerequisiteTrace();

	const status = document.getElementById("trace-status");
	if (status) {
		// Focus ids come from the mod file, so they go in as text and never as markup.
		status.textContent = focusId
			? feLocalize("focustree.tracing", "Tracing: {0}", focusId)
			: "";
	}

	const container = document.getElementById("trace-status-container");
	if (container) {
		container.style.display = focusId ? "flex" : "none";
	}
}

// Wired to the shell elements, which outlive every rebuild of the tree, so this runs once.
function subscribeTracing(): void {
	const content = document.getElementById("focustreecontent");
	if (content) {
		content.addEventListener(
			"click",
			(e) => {
				if (!e.shiftKey) {
					return;
				}

				// Capture phase: stopping the event here is what keeps the bubble-phase .navigator
				// handler from also jumping to the focus in the editor, and keeps a shift+click that
				// lands on the completion checkbox from ticking it.
				e.preventDefault();
				e.stopPropagation();

				const item = (e.target as Element | null)?.closest(
					"[data-gridbox-item]",
				) as HTMLElement | null;
				const id = item?.dataset.gridboxItem;
				if (!id) {
					return;
				}

				setTracedFocus(id === tracedFocusId ? undefined : id);
			},
			true,
		);
	}

	const clearButton = document.getElementById("clear-trace");
	clearButton?.addEventListener("click", () => setTracedFocus(undefined));

	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && tracedFocusId !== undefined) {
			setTracedFocus(undefined);
		}
	});

	// Clicking empty canvas clears the trace. The end of a pan is a click on that same canvas, so
	// only a press that stayed where it started counts as one.
	const dragger = document.getElementById("dragger");
	if (dragger) {
		let downX = 0;
		let downY = 0;
		dragger.addEventListener("mousedown", (e) => {
			downX = e.pageX;
			downY = e.pageY;
		});
		dragger.addEventListener("mouseup", (e) => {
			if (
				tracedFocusId !== undefined &&
				Math.abs(e.pageX - downX) < 4 &&
				Math.abs(e.pageY - downY) < 4
			) {
				setTracedFocus(undefined);
			}
		});
	}
}

let useConditionInFocus: boolean = (window as any).useConditionInFocus;
let focusTrees: FocusTree[] = (window as any).focusTrees;

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedInlayExprs: ConditionItem[] = getState().selectedInlayExprs ?? [];
let selectedFocusTreeIndex: number = Math.min(
	focusTrees.length - 1,
	getState().selectedFocusTreeIndex ?? 0,
);
let allowBranches: DivDropdown | undefined = undefined;
let conditions: DivDropdown | undefined = undefined;
let inlayConditions: DivDropdown | undefined = undefined;
let checkedFocuses: Record<string, Checkbox> = {};

function showCustomTitlebars() {
	return getState().showCustomTitlebars ?? false;
}

function showFocusOverlays() {
	return getState().showFocusOverlays ?? false;
}

function showWarningMarkers() {
	return getState().showFocusWarningMarkers ?? true;
}

function showInlayWindows() {
	return !!(window as any).__showInlayWindows;
}

function getSelectedInlayWindowIds() {
	return (
		getState().selectedInlayWindowIds ??
		({} as Record<string, string | undefined>)
	);
}

function getSelectedInlayWindowId(focusTree: FocusTree): string | undefined {
	const selected = getSelectedInlayWindowIds()[focusTree.id];
	if (focusTree.inlayWindows.some((inlay) => inlay.id === selected)) {
		return selected;
	}

	return focusTree.inlayWindows[0]?.id;
}

function setSelectedInlayWindowId(
	focusTree: FocusTree,
	inlayWindowId: string | undefined,
) {
	const selectedInlayWindowIds = getSelectedInlayWindowIds();
	selectedInlayWindowIds[focusTree.id] = inlayWindowId;
	setState({ selectedInlayWindowIds });
}

function applyCustomTitlebarVisibility() {
	const visible = showCustomTitlebars();
	const elements = document.getElementsByClassName("focus-titlebar-layer");
	for (let i = 0; i < elements.length; i++) {
		const element = elements[i] as HTMLDivElement;
		if (element.dataset.hasCustomTitlebar === "true") {
			element.style.display = visible ? "block" : "none";
		}
	}
}

function applyFocusOverlayVisibility() {
	const visible = showFocusOverlays();
	const elements = document.getElementsByClassName("focus-overlay-layer");
	for (let i = 0; i < elements.length; i++) {
		const element = elements[i] as HTMLDivElement;
		if (element.dataset.hasFocusOverlay === "true") {
			element.style.display = visible ? "block" : "none";
		}
	}
}

async function buildContent() {
	const focusCheckState = getState().checkedFocuses ?? {};
	const checkedFocusesExprs = Object.keys(focusCheckState)
		.filter((fid) => focusCheckState[fid])
		.map((fid) => ({
			scopeName: "",
			nodeContent: "has_completed_focus = " + fid,
		}));
	clearCheckedFocuses();

	const focustreeplaceholder = document.getElementById(
		"focustreeplaceholder",
	) as HTMLDivElement;

	const styleTable = new StyleTable();
	const renderedFocus: Record<string, string> = (window as any).renderedFocus;
	const focusTree = focusTrees[selectedFocusTreeIndex];
	if (!focusTree) {
		return;
	}
	const focuses = Object.values(focusTree.focuses);

	const allowBranchOptionsValue: Record<string, boolean> = {};
	const exprs = [
		{ scopeName: "", nodeContent: "has_focus_tree = " + focusTree.id },
		...checkedFocusesExprs,
		...selectedExprs,
		...selectedInlayExprs,
	];
	focusTree.allowBranchOptions.forEach((option) => {
		const focus = focusTree.focuses[option];
		allowBranchOptionsValue[option] =
			!focus ||
			focus.allowBranch === undefined ||
			applyCondition(focus.allowBranch, exprs);
	});

	// For synthetic trees (shared focuses), always allow branches to show them in preview
	if (focusTree.isSharedFocues) {
		focusTree.allowBranchOptions.forEach((option) => {
			allowBranchOptionsValue[option] = true;
		});
	}

	const gridbox: GridBoxType = (window as any).gridBox;

	const focusPosition: Record<string, NumberPosition> = {};
	calculateFocusAllowed(focusTree, allowBranchOptionsValue);
	const focusGrixBoxItems = focuses
		.map((focus) =>
			focusToGridItem(
				focus,
				focusTree,
				allowBranchOptionsValue,
				focusPosition,
				exprs,
			),
		)
		.filter((v): v is GridBoxItem => !!v);

	applyExclusiveLinkStyle(focusGrixBoxItems);

	const minX = minBy(Object.values(focusPosition), "x")?.x ?? 0;
	const leftPadding =
		gridbox.position.x._value - Math.min(minX * (window as any).xGridSize, 0);

	const focusTreeContent = await renderGridBoxCommon(
		{
			...gridbox,
			position: { ...gridbox.position, x: toNumberLike(leftPadding) },
		},
		{
			size: { width: 0, height: 0 },
			orientation: "upper_left",
		},
		{
			styleTable,
			items: arrayToMap(focusGrixBoxItems, "id"),
			onRenderItem: (item) =>
				Promise.resolve(
					(renderedFocus[item.id] ?? "")
						.replace("{{position}}", item.gridX + ", " + item.gridY)
						.replace(
							"{{iconClass}}",
							getFocusIcon(
								focusTree.focuses[item.id] ?? emptyFocus,
								exprs,
								styleTable,
							),
						),
				),
			cornerPosition: 0.5,
		},
	);

	focustreeplaceholder.innerHTML =
		focusTreeContent + styleTable.toStyleElement((window as any).styleNonce);
	const inlayWindowPlaceholder = document.getElementById(
		"inlaywindowplaceholder",
	) as HTMLDivElement;
	inlayWindowPlaceholder.innerHTML = renderInlayWindows(focusTree, exprs);

	subscribeNavigators();
	setupCheckedFocuses(focuses, focusTree);
	applyWarningMarkers(focusTree, focusGrixBoxItems);
	applyCustomTitlebarVisibility();
	applyFocusOverlayVisibility();
	// The connection divs are new after every rebuild, so an active trace has to be put back on.
	reapplyPrerequisiteTrace();
}

// Focuses named in a layout warning get a red box with a warning badge so the problem is visible
// on the tree itself, not only as a line in the warnings panel. Runs after every (re)render,
// including the in-place update path, and marks every focus the warning involves (source +
// related sources).
// Exported (like miopreview's findOverlaps) so the id-collection logic is unit-testable.
export function warningFocusIdsFor(focusTree: FocusTree): Set<string> {
	const warningFocusIds = new Set<string>();
	for (const warning of focusTree.warnings) {
		warningFocusIds.add(warning.source);
		for (const related of warning.relatedSources ?? []) {
			warningFocusIds.add(related);
		}
	}
	return warningFocusIds;
}

// How many warned focuses resolve to each grid slot, keyed by focus id. Focuses stacked on the
// same slot are drawn on top of each other, so all but the last one rendered are invisible -- the
// count on the badge is the only way to see that more than one focus is hiding there. Counting is
// restricted to focuses that already carry a warning, so a stack of shared or joint focuses merged
// in from another file (which the validator deliberately ignores) can't manufacture a marker.
// Exported for the same testability reason as warningFocusIdsFor.
export function warningCellCountsFor(
	items: GridBoxItem[],
	warningFocusIds: Set<string>,
): Record<string, number> {
	const countByCell: Record<string, number> = {};
	const cellByFocusId: Record<string, string> = {};
	for (const item of items) {
		if (!warningFocusIds.has(item.id)) {
			continue;
		}
		const cell = item.gridX + "," + item.gridY;
		cellByFocusId[item.id] = cell;
		countByCell[cell] = (countByCell[cell] ?? 0) + 1;
	}

	const countByFocusId: Record<string, number> = {};
	for (const [id, cell] of Object.entries(cellByFocusId)) {
		countByFocusId[id] = countByCell[cell] ?? 1;
	}
	return countByFocusId;
}

// Warning texts per focus, filed under the warning's source *and* every related source, so both
// ends of a pair explain themselves on hover instead of only the focus the warning was filed under.
function warningTextsByFocusId(focusTree: FocusTree): Record<string, string[]> {
	const texts: Record<string, string[]> = {};
	for (const warning of focusTree.warnings) {
		for (const id of [warning.source, ...(warning.relatedSources ?? [])]) {
			(texts[id] ??= []).push(warning.text);
		}
	}
	return texts;
}

// Exported so a test can assert the markers really land on the rendered nodes: the previous
// highlight silently did nothing because its CSS was registered after the stylesheet had already
// been serialized, and nothing covered the DOM side.
export function applyWarningMarkers(focusTree: FocusTree, items: GridBoxItem[]) {
	const warningFocusIds = warningFocusIdsFor(focusTree);
	if (warningFocusIds.size === 0) {
		return;
	}

	const cellCounts = warningCellCountsFor(items, warningFocusIds);
	const texts = warningTextsByFocusId(focusTree);
	const visible = showWarningMarkers();

	warningFocusIds.forEach((id) => {
		// A focus hidden by allow_branch, or belonging to another tree, simply has no element.
		const element = document.getElementById(`focus_${id}`);
		if (!element) {
			return;
		}

		// Built through the DOM rather than innerHTML: nothing derived from a mod-supplied focus id
		// is ever interpolated into markup.
		const marker = document.createElement("div");
		marker.className = warningBoxClass;
		if (!visible) {
			marker.style.display = "none";
		}
		const badge = document.createElement("span");
		badge.className = warningBadgeClass;
		const stacked = cellCounts[id] ?? 1;
		badge.textContent = stacked > 1 ? `⚠×${stacked}` : "⚠";
		marker.appendChild(badge);
		element.appendChild(marker);

		// The tooltip lives on the .navigator child, which is what carries the focus id and
		// position title; the marker itself is pointer-events:none so it can't show one.
		const navigator = element.querySelector(".navigator") as HTMLElement | null;
		const focusTexts = texts[id];
		if (navigator && focusTexts) {
			navigator.title = [navigator.title, ...focusTexts.map((t) => `⚠ ${t}`)]
				.filter((line) => line)
				.join("\n");
		}
	});
}

function setWarningMarkersVisible(visible: boolean) {
	const markers = document.getElementsByClassName(warningBoxClass);
	for (let i = 0; i < markers.length; i++) {
		(markers[i] as HTMLDivElement).style.display = visible ? "block" : "none";
	}

	const button = document.getElementById(
		"toggle-warning-markers",
	) as HTMLButtonElement | null;
	if (button) {
		button.style.opacity = visible ? "" : "0.4";
	}
}

function calculateFocusAllowed(
	focusTree: FocusTree,
	allowBranchOptionsValue: Record<string, boolean>,
) {
	const focuses = focusTree.focuses;

	let changed = true;
	while (changed) {
		changed = false;
		for (const key in focuses) {
			const focus = focuses[key];
			if (!focus || focus.prerequisite.length === 0) {
				continue;
			}

			if (focus.id in allowBranchOptionsValue) {
				continue;
			}

			let allow = true;
			for (const andPrerequests of focus.prerequisite) {
				if (andPrerequests.length === 0) {
					continue;
				}
				allow =
					allow &&
					andPrerequests.some((p) => allowBranchOptionsValue[p] === true);
				const deny = andPrerequests.every(
					(p) => allowBranchOptionsValue[p] === false,
				);
				if (deny) {
					allowBranchOptionsValue[focus.id] = false;
					changed = true;
					break;
				}
			}
			if (allow) {
				allowBranchOptionsValue[focus.id] = true;
				changed = true;
			}
		}
	}
}

function updateSelectedFocusTree(clearCondition: boolean) {
	const focusTree = focusTrees[selectedFocusTreeIndex];
	if (!focusTree) {
		return;
	}
	const continuousFocuses = document.getElementById(
		"continuousFocuses",
	) as HTMLDivElement;

	if (
		focusTree.continuousFocusPositionX !== undefined &&
		focusTree.continuousFocusPositionY !== undefined
	) {
		continuousFocuses.style.left =
			focusTree.continuousFocusPositionX - 59 + "px";
		continuousFocuses.style.top = focusTree.continuousFocusPositionY + 7 + "px";
		continuousFocuses.style.display = "block";
	} else {
		continuousFocuses.style.display = "none";
	}

	if (useConditionInFocus) {
		const conditionExprs = dedupeConditionExprs(
			focusTree.conditionExprs,
		).filter(
			(e) =>
				e.scopeName !== "" ||
				(!e.nodeContent.startsWith("has_focus_tree = ") &&
					!e.nodeContent.startsWith("has_completed_focus = ")),
		);
		const inlayConditionExprs = dedupeConditionExprs(
			focusTree.inlayConditionExprs,
		).filter(
			(e) =>
				e.scopeName !== "" ||
				(!e.nodeContent.startsWith("has_focus_tree = ") &&
					!e.nodeContent.startsWith("has_completed_focus = ")),
		);

		const conditionContainerElement = document.getElementById(
			"condition-container",
		) as HTMLDivElement | null;
		if (conditionContainerElement) {
			conditionContainerElement.style.display =
				conditionExprs.length > 0 ? "block" : "none";
		}

		if (conditions) {
			conditions.select.innerHTML = `<span class="value"></span>
                ${conditionExprs
									.map(
										(option) =>
											`<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ""}${option.nodeContent}</div>`,
									)
									.join("")}`;
			conditions.selectedValues$.next(
				clearCondition
					? []
					: selectedExprs.map((e) => `${e.scopeName}!|${e.nodeContent}`),
			);
		}

		const inlayConditionContainerElement = document.getElementById(
			"inlay-condition-container",
		) as HTMLDivElement | null;
		if (inlayConditionContainerElement) {
			inlayConditionContainerElement.style.display =
				showInlayWindows() && inlayConditionExprs.length > 0 ? "block" : "none";
		}

		if (inlayConditions) {
			inlayConditions.select.innerHTML = `<span class="value"></span>
                ${inlayConditionExprs
									.map(
										(option) =>
											`<div class="option" value='${option.scopeName}!|${option.nodeContent}'>${option.scopeName ? `[${option.scopeName}]` : ""}${option.nodeContent}</div>`,
									)
									.join("")}`;
			inlayConditions.selectedValues$.next(
				clearCondition
					? []
					: selectedInlayExprs.map((e) => `${e.scopeName}!|${e.nodeContent}`),
			);
		}
	} else {
		const allowBranchesContainerElement = document.getElementById(
			"allowbranch-container",
		) as HTMLDivElement | null;
		if (allowBranchesContainerElement) {
			allowBranchesContainerElement.style.display =
				focusTree.allowBranchOptions.length > 0 ? "block" : "none";
		}

		if (allowBranches) {
			allowBranches.select.innerHTML = `<span class="value"></span>
                ${focusTree.allowBranchOptions.map((option) => `<div class="option" value="inbranch_${option}">${option}</div>`).join("")}`;
			allowBranches.selectAll();
		}
	}

	const inlayWindowsElement = document.getElementById(
		"inlay-windows",
	) as HTMLSelectElement | null;
	const inlayWindowsContainerElement = document.getElementById(
		"inlay-window-container",
	) as HTMLDivElement | null;
	if (inlayWindowsContainerElement) {
		inlayWindowsContainerElement.style.display =
			focusTree.inlayWindows.length > 0 ? "block" : "none";
	}
	if (inlayWindowsElement) {
		inlayWindowsElement.innerHTML = focusTree.inlayWindows
			.map((inlay) => `<option value="${inlay.id}">${inlay.id}</option>`)
			.join("");
		const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
		if (selectedInlayWindowId) {
			inlayWindowsElement.value = selectedInlayWindowId;
			setSelectedInlayWindowId(focusTree, selectedInlayWindowId);
		}
	}

	renderWarningList(focusTree);
}

// The warnings panel lists one clickable entry per warning: activating it closes the panel and
// scrolls the offending focus into view with a short flash, so a warning never has to be read
// off as coordinates and hunted for by hand.
function renderWarningList(focusTree: FocusTree) {
	const warnings = document.getElementById("warnings") as HTMLDivElement | null;
	if (!warnings) {
		return;
	}

	warnings.textContent = "";
	if (focusTree.warnings.length === 0) {
		const empty = document.createElement("div");
		empty.textContent = feLocalize(
			"worldmap.warnings.nowarnings",
			"No warnings.",
		);
		warnings.appendChild(empty);
		return;
	}

	for (const warning of focusTree.warnings) {
		const entry = document.createElement("div");
		entry.className = warningEntryClass;
		entry.setAttribute("role", "button");
		entry.tabIndex = 0;
		entry.textContent = `[${warning.source}] ${warning.text}`;
		const reveal = () => revealFocus(warning.source);
		entry.addEventListener("click", reveal);
		entry.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				reveal();
			}
		});
		warnings.appendChild(entry);
	}
}

function revealFocus(focusId: string) {
	hideWarningPanel();

	// A focus hidden by allow_branch has no element; the entry then just closes the panel.
	const element = document.getElementById(`focus_${focusId}`);
	if (!element) {
		return;
	}

	element.scrollIntoView({ block: "center", inline: "center" });
	element.classList.add(warningFlashClass);
	setTimeout(() => element.classList.remove(warningFlashClass), 1200);
}

function hideWarningPanel() {
	const container = document.getElementById(
		"warnings-container",
	) as HTMLDivElement | null;
	if (container) {
		container.style.display = "none";
		document.body.style.overflow = "";
	}
}

function getFocusPosition(
	focus: Focus | undefined,
	positionByFocusId: Record<string, NumberPosition>,
	focusTree: FocusTree,
	focusStack: Focus[] = [],
	exprs: ConditionItem[],
): NumberPosition {
	if (focus === undefined) {
		return { x: 0, y: 0 };
	}

	const cached = positionByFocusId[focus.id];
	if (cached) {
		return cached;
	}

	if (focusStack.includes(focus)) {
		return { x: 0, y: 0 };
	}

	let position: NumberPosition = { x: focus.x, y: focus.y };
	if (focus.relativePositionId !== undefined) {
		focusStack.push(focus);
		const relativeFocusPosition = getFocusPosition(
			focusTree.focuses[focus.relativePositionId],
			positionByFocusId,
			focusTree,
			focusStack,
			exprs,
		);
		focusStack.pop();
		position.x += relativeFocusPosition.x;
		position.y += relativeFocusPosition.y;
	}

	for (const offset of focus.offset) {
		if (offset.trigger !== undefined && applyCondition(offset.trigger, exprs)) {
			position.x += offset.x;
			position.y += offset.y;
		}
	}

	positionByFocusId[focus.id] = position;
	return position;
}

const emptyFocus: Focus = {
	id: "",
	icon: [],
	textIcon: undefined,
	overlay: undefined,
	x: 0,
	y: 0,
	relativePositionId: undefined,
	prerequisite: [],
	exclusive: [],
	hasAllowBranch: false,
	inAllowBranch: [],
	allowBranch: false,
	offset: [],
	token: undefined,
	file: "",
	text: undefined,
};

function getFocusIcon(
	focus: Focus,
	exprs: ConditionItem[],
	styleTable: StyleTable,
): string {
	for (const icon of focus.icon) {
		if (applyCondition(icon.condition, exprs)) {
			const iconName = icon.icon;
			return styleTable.name(
				"focus-icon-" + normalizeForStyle(iconName ?? "-empty"),
			);
		}
	}

	return styleTable.name("focus-icon-" + normalizeForStyle("-empty"));
}

function focusToGridItem(
	focus: Focus,
	focustree: FocusTree,
	allowBranchOptionsValue: Record<string, boolean>,
	positionByFocusId: Record<string, NumberPosition>,
	exprs: ConditionItem[],
): GridBoxItem | undefined {
	if (useConditionInFocus) {
		if (allowBranchOptionsValue[focus.id] === false) {
			return undefined;
		}
	}

	const classNames = focus.inAllowBranch.map((v) => "inbranch_" + v).join(" ");
	const connections: GridBoxConnection[] = [];

	for (const prerequisites of focus.prerequisite) {
		let style: string;
		if (prerequisites.length > 1) {
			style = "1px dashed #88aaff";
		} else {
			style = "1px solid #88aaff";
		}

		prerequisites.forEach((p) => {
			const fp = focustree.focuses[p];
			const classNames2 =
				fp?.inAllowBranch.map((v) => "inbranch_" + v).join(" ") ?? "";
			connections.push({
				target: p,
				targetType: "parent",
				style: style,
				classNames: classNames + " " + classNames2,
			});
		});
	}

	focus.exclusive.forEach((e) => {
		const fe = focustree.focuses[e];
		const classNames2 =
			fe?.inAllowBranch.map((v) => "inbranch_" + v).join(" ") ?? "";
		connections.push({
			target: e,
			targetType: "related",
			style: "1px solid red",
			classNames: classNames + " " + classNames2,
		});
	});

	const position = getFocusPosition(
		focus,
		positionByFocusId,
		focustree,
		[],
		exprs,
	);

	return {
		id: focus.id,
		htmlId: "focus_" + focus.id,
		classNames: classNames + " focus",
		gridX: position.x,
		gridY: position.y,
		connections,
	};
}

function clearCheckedFocuses() {
	for (const focusId in checkedFocuses) {
		checkedFocuses[focusId]?.dispose();
	}
	checkedFocuses = {};
}

function setupCheckedFocuses(focuses: Focus[], focusTree: FocusTree) {
	const focusCheckState = getState().checkedFocuses ?? {};
	for (const focus of focuses) {
		const checkbox = document.getElementById(
			`checkbox-${normalizeForStyle(focus.id)}`,
		) as HTMLInputElement;
		if (checkbox) {
			if (
				focusTree.conditionExprs.some(
					(e) =>
						e.scopeName === "" &&
						e.nodeContent === "has_completed_focus = " + focus.id,
				)
			) {
				checkbox.checked = !!focusCheckState[focus.id];
				const checkboxItem = new Checkbox(checkbox);
				checkedFocuses[focus.id] = checkboxItem;
				checkbox.addEventListener("change", async () => {
					if (checkbox.checked) {
						for (const exclusiveFocus of focus.exclusive) {
							const exclusiveCheckbox = checkedFocuses[exclusiveFocus];
							if (exclusiveCheckbox) {
								exclusiveCheckbox.input.checked = false;
								focusCheckState[exclusiveFocus] = false;
							}
						}
					}
					focusCheckState[focus.id] = checkbox.checked;
					setState({ checkedFocuses: focusCheckState });

					const rect = checkbox.getBoundingClientRect();
					const oldLeft = rect.left,
						oldTop = rect.top;
					await buildContent();

					const newCheckbox = document.getElementById(
						`checkbox-${normalizeForStyle(focus.id)}`,
					) as HTMLInputElement;
					if (newCheckbox) {
						const rect = newCheckbox.getBoundingClientRect();
						const newLeft = rect.left,
							newTop = rect.top;
						window.scrollBy(newLeft - oldLeft, newTop - oldTop);
					}

					retriggerSearch();
				});
			} else {
				checkbox.parentElement?.remove();
			}
		}
	}
}

function dedupeConditionExprs(exprs: ConditionItem[]): ConditionItem[] {
	const result: ConditionItem[] = [];
	for (const expr of exprs) {
		if (
			!result.some(
				(existing) =>
					existing.scopeName === expr.scopeName &&
					existing.nodeContent === expr.nodeContent,
			)
		) {
			result.push(expr);
		}
	}

	return result;
}

function renderInlayWindows(
	focusTree: FocusTree,
	exprs: ConditionItem[],
): string {
	if (!showInlayWindows()) {
		return "";
	}

	const selectedInlayWindowId = getSelectedInlayWindowId(focusTree);
	if (!selectedInlayWindowId) {
		return "";
	}

	const selectedInlayWindow = focusTree.inlayWindows.find(
		(inlay) => inlay.id === selectedInlayWindowId,
	);
	if (
		!selectedInlayWindow ||
		!applyCondition(selectedInlayWindow.visible, exprs)
	) {
		return "";
	}

	const renderedInlayWindows: Record<string, string> =
		(window as any).renderedInlayWindows ?? {};
	const template = renderedInlayWindows[selectedInlayWindow.id] ?? "";
	return selectedInlayWindow.scriptedImages.reduce((content, slot) => {
		const activeOption = getActiveInlayOption(slot.gfxOptions, exprs);
		return content
			.split(`{{inlay_slot_class:${slot.id}}}`)
			.join(
				activeOption
					? getInlayGfxClassName(activeOption.gfxName, activeOption.gfxFile)
					: "",
			);
	}, template);
}

function getActiveInlayOption<T extends { condition: any }>(
	options: T[],
	exprs: ConditionItem[],
): T | undefined {
	for (const option of options) {
		if (applyCondition(option.condition, exprs)) {
			return option;
		}
	}

	return undefined;
}

function getInlayGfxClassName(
	gfxName: string | undefined,
	gfxFile: string | undefined,
): string {
	return (
		"st-inlay-gfx-" +
		normalizeForStyle((gfxFile ?? "missing") + "-" + (gfxName ?? "missing"))
	);
}

let retriggerSearch: () => void = () => {};

window.addEventListener("message", async (event) => {
	const msg = event.data;

	// Fills the nonced <style> with the real focus-icon background CSS once the deferred conversion finishes.
	if (msg.type === "iconStyles") {
		const styleEl = document.getElementById("ft-progressive-icons");
		if (styleEl) {
			styleEl.textContent = msg.css;
		}
		return;
	}

	if (msg.type !== "update") {
		return;
	}

	focusTrees = msg.focusTrees;
	(window as any).focusTrees = msg.focusTrees;
	(window as any).renderedFocus = msg.renderedFocus;
	(window as any).renderedInlayWindows = msg.renderedInlayWindows;
	(window as any).gridBox = msg.gridBox;
	useConditionInFocus = msg.useConditionInFocus;
	(window as any).useConditionInFocus = msg.useConditionInFocus;
	(window as any).xGridSize = msg.xGridSize;

	if (selectedFocusTreeIndex >= focusTrees.length) {
		selectedFocusTreeIndex = Math.max(0, focusTrees.length - 1);
		setState({ selectedFocusTreeIndex });
	}

	updateSelectedFocusTree(false);
	await buildContent();
	retriggerSearch();
});

window.addEventListener(
	"load",
	tryRun(async function () {
		// Custom titlebars
		const showCustomTitlebarsElement = document.getElementById(
			"show-custom-titlebars",
		) as HTMLInputElement | null;
		if (showCustomTitlebarsElement) {
			showCustomTitlebarsElement.checked = showCustomTitlebars();
			showCustomTitlebarsElement.addEventListener("change", () => {
				setState({ showCustomTitlebars: showCustomTitlebarsElement.checked });
				applyCustomTitlebarVisibility();
			});
		}
		const showFocusOverlaysElement = document.getElementById(
			"show-focus-overlays",
		) as HTMLInputElement | null;
		if (showFocusOverlaysElement) {
			showFocusOverlaysElement.checked = showFocusOverlays();
			showFocusOverlaysElement.addEventListener("change", () => {
				setState({ showFocusOverlays: showFocusOverlaysElement.checked });
				applyFocusOverlayVisibility();
			});
		}
		const showInlayWindowsElement = document.getElementById(
			"show-inlay-windows",
		) as HTMLInputElement | null;
		if (showInlayWindowsElement) {
			(window as any).__showInlayWindows = false;
			showInlayWindowsElement.checked = false;
			showInlayWindowsElement.addEventListener("change", async () => {
				(window as any).__showInlayWindows = showInlayWindowsElement.checked;
				updateSelectedFocusTree(false);
				await buildContent();
				retriggerSearch();
			});
		}

		// Focuses
		const focusesElement = document.getElementById(
			"focuses",
		) as HTMLSelectElement | null;
		if (focusesElement) {
			focusesElement.value = selectedFocusTreeIndex.toString();
			focusesElement.addEventListener("change", async () => {
				selectedFocusTreeIndex = parseInt(focusesElement.value);
				setState({ selectedFocusTreeIndex });
				updateSelectedFocusTree(true);
				await buildContent();
				retriggerSearch();
			});
		}

		const inlayWindowsElement = document.getElementById(
			"inlay-windows",
		) as HTMLSelectElement | null;
		if (inlayWindowsElement) {
			inlayWindowsElement.addEventListener("change", async () => {
				const focusTree = focusTrees[selectedFocusTreeIndex];
				if (focusTree === undefined) {
					return;
				}
				setSelectedInlayWindowId(focusTree, inlayWindowsElement.value);
				await buildContent();
				retriggerSearch();
			});
		}

		// Allow branch
		if (!useConditionInFocus) {
			const hiddenBranches = getState().hiddenBranches || {};
			for (const key in hiddenBranches) {
				showBranch(false, key);
			}

			const allowBranchesElement = document.getElementById(
				"allowbranch",
			) as HTMLDivElement | null;
			if (allowBranchesElement) {
				allowBranches = new DivDropdown(allowBranchesElement, true);
				allowBranches.selectAll();

				const allValues = allowBranches.selectedValues$.value;
				allowBranches.selectedValues$.next(
					allValues.filter((v) => !hiddenBranches[v]),
				);

				let oldSelection = allowBranches.selectedValues$.value;
				allowBranches.selectedValues$.subscribe((selection) => {
					const showBranches = difference(selection, oldSelection);
					showBranches.forEach((s) => showBranch(true, s));
					const hideBranches = difference(oldSelection, selection);
					hideBranches.forEach((s) => showBranch(false, s));
					oldSelection = selection;

					const hiddenBranches = difference(allValues, selection);
					setState({ hiddenBranches });
				});
			}
		}

		// Searchbox
		const searchbox = document.getElementById("searchbox") as HTMLInputElement;
		let currentNavigatedIndex = 0;
		let oldSearchboxValue: string = getState().searchboxValue || "";
		let searchedFocus: HTMLDivElement[] = search(oldSearchboxValue, false);

		searchbox.value = oldSearchboxValue;

		const searchboxChangeFunc = function (this: HTMLInputElement) {
			const searchboxValue = this.value.toLowerCase();
			if (oldSearchboxValue !== searchboxValue) {
				currentNavigatedIndex = 0;
				searchedFocus = search(searchboxValue);
				oldSearchboxValue = searchboxValue;
				setState({ searchboxValue });
			}
		};

		searchbox.addEventListener("change", searchboxChangeFunc);
		searchbox.addEventListener("keypress", function (e) {
			if (e.key === "Enter") {
				const visibleSearchedFocus = searchedFocus.filter(
					(f) => f.style.display !== "none",
				);
				if (visibleSearchedFocus.length > 0) {
					currentNavigatedIndex =
						(currentNavigatedIndex +
							(e.shiftKey ? visibleSearchedFocus.length - 1 : 1)) %
						visibleSearchedFocus.length;
					visibleSearchedFocus[currentNavigatedIndex]?.scrollIntoView({
						block: "center",
						inline: "center",
					});
				}
			} else {
				searchboxChangeFunc.apply(this);
			}
		});
		searchbox.addEventListener("keyup", searchboxChangeFunc);
		searchbox.addEventListener("paste", searchboxChangeFunc);
		searchbox.addEventListener("cut", searchboxChangeFunc);

		retriggerSearch = () => {
			searchedFocus = search(oldSearchboxValue, false);
		};

		// Conditions
		if (useConditionInFocus) {
			const conditionsElement = document.getElementById(
				"conditions",
			) as HTMLDivElement | null;
			if (conditionsElement) {
				conditions = new DivDropdown(conditionsElement, true);

				conditions.selectedValues$.next(
					selectedExprs.map((e) => `${e.scopeName}!|${e.nodeContent}`),
				);
				conditions.selectedValues$.subscribe(async (selection) => {
					selectedExprs = selection.map<ConditionItem>((selection) => {
						const index = selection.indexOf("!|");
						if (index === -1) {
							return {
								scopeName: "",
								nodeContent: selection,
							};
						} else {
							return {
								scopeName: selection.substring(0, index),
								nodeContent: selection.substring(index + 2),
							};
						}
					});

					setState({ selectedExprs });

					await buildContent();
					retriggerSearch();
				});
			}

			const inlayConditionsElement = document.getElementById(
				"inlay-conditions",
			) as HTMLDivElement | null;
			if (inlayConditionsElement) {
				inlayConditions = new DivDropdown(inlayConditionsElement, true);

				inlayConditions.selectedValues$.next(
					selectedInlayExprs.map((e) => `${e.scopeName}!|${e.nodeContent}`),
				);
				inlayConditions.selectedValues$.subscribe(async (selection) => {
					selectedInlayExprs = selection.map<ConditionItem>((selection) => {
						const index = selection.indexOf("!|");
						if (index === -1) {
							return {
								scopeName: "",
								nodeContent: selection,
							};
						} else {
							return {
								scopeName: selection.substring(0, index),
								nodeContent: selection.substring(index + 2),
							};
						}
					});

					setState({ selectedInlayExprs });

					await buildContent();
					retriggerSearch();
				});
			}
		}

		// Zoom
		const contentElement = document.getElementById(
			"focustreecontent",
		) as HTMLDivElement;
		enableZoom(contentElement, 0, 40);

		// Shift+click a focus to isolate its prerequisite lines
		subscribeTracing();

		// Toggle warnings
		const showWarnings = document.getElementById(
			"show-warnings",
		) as HTMLButtonElement;
		if (showWarnings) {
			const warnings = document.getElementById(
				"warnings-container",
			) as HTMLDivElement;
			showWarnings.addEventListener("click", () => {
				const visible = warnings.style.display === "block";
				document.body.style.overflow = visible ? "" : "hidden";
				warnings.style.display = visible ? "none" : "block";
			});
		}

		// Toggle the on-canvas warning markers. Flips the existing marker elements instead of
		// rebuilding the tree, so hiding them stays instant on large focus trees.
		const toggleWarningMarkers = document.getElementById(
			"toggle-warning-markers",
		) as HTMLButtonElement | null;
		if (toggleWarningMarkers) {
			setWarningMarkersVisible(showWarningMarkers());
			toggleWarningMarkers.addEventListener("click", () => {
				const visible = !showWarningMarkers();
				setState({ showFocusWarningMarkers: visible });
				setWarningMarkersVisible(visible);
			});
		}

		// Reset focus-completion checkboxes
		const resetFocusCheckboxes = document.getElementById(
			"reset-focus-checkboxes",
		) as HTMLButtonElement | null;
		if (resetFocusCheckboxes) {
			resetFocusCheckboxes.addEventListener("click", async () => {
				setState({ checkedFocuses: {} });
				await buildContent();
				retriggerSearch();
			});
		}

		updateSelectedFocusTree(false);
		await buildContent();
		scrollToState();

		// Tells the extension the structure is on screen so it can post the deferred focus-icon CSS.
		vscode.postMessage({ command: "ready" });
	}),
);
