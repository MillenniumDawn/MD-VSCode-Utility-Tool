import { GridBoxItem } from "../../src/util/hoi4gui/gridboxcommon";
import {
	warningBadgeClass,
	warningBoxClass,
	warningEntryClass,
	warningFlashClass,
} from "../../src/util/hoi4gui/warningstyles";
import { applyIconState } from "../../src/previewdef/toolbaricons";
import { feLocalize } from "./i18n";

// The warnings of a grid box tree -- a focus tree or a MIO -- as the webview shows them: a marker on
// every node a warning names, and a panel listing them. `idPrefix` turns a node id into the id of its
// grid box item element (`focus_` or `trait_`).
interface TreeWarning {
	text: string;
	source: string;
	relatedSources?: string[];
}

export interface WarnedTree {
	warnings: TreeWarning[];
}

// Every node a warning involves (source + related sources), so both ends of a pair are marked.
export function warningIdsFor(tree: WarnedTree): Set<string> {
	const ids = new Set<string>();
	for (const warning of tree.warnings) {
		ids.add(warning.source);
		for (const related of warning.relatedSources ?? []) {
			ids.add(related);
		}
	}
	return ids;
}

// How many warned nodes resolve to each grid slot, keyed by node id. Nodes stacked on the same slot
// are drawn on top of each other, so all but the last one rendered are invisible -- the count on the
// badge is the only way to see that more than one node is hiding there. Counting is restricted to
// nodes that already carry a warning, so a stack of shared or joint focuses merged in from another
// file (which the validator deliberately ignores) can't manufacture a marker.
//
// Maps rather than objects throughout: the ids are tokens from the mod, and one named constructor or
// __proto__ would otherwise land on the prototype.
export function warningCellCountsFor(
	items: GridBoxItem[],
	warningIds: Set<string>,
): Map<string, number> {
	const countByCell = new Map<string, number>();
	const cellById = new Map<string, string>();
	for (const item of items) {
		if (!warningIds.has(item.id)) {
			continue;
		}
		const cell = item.gridX + "," + item.gridY;
		cellById.set(item.id, cell);
		countByCell.set(cell, (countByCell.get(cell) ?? 0) + 1);
	}

	const countById = new Map<string, number>();
	for (const [id, cell] of cellById) {
		countById.set(id, countByCell.get(cell) ?? 1);
	}
	return countById;
}

// Warning texts per node, filed under the warning's source *and* every related source, so both
// ends of a pair explain themselves on hover instead of only the node the warning was filed under.
function warningTextsById(tree: WarnedTree): Map<string, string[]> {
	const texts = new Map<string, string[]>();
	for (const warning of tree.warnings) {
		for (const id of [warning.source, ...(warning.relatedSources ?? [])]) {
			const nodeTexts = texts.get(id);
			if (nodeTexts) {
				nodeTexts.push(warning.text);
			} else {
				texts.set(id, [warning.text]);
			}
		}
	}
	return texts;
}

// Nodes named in a warning get a red box with a warning badge so the problem is visible on the tree
// itself, not only as a line in the warnings panel. Runs after every (re)render.
export function applyWarningMarkers(
	tree: WarnedTree,
	items: GridBoxItem[],
	idPrefix: string,
	visible: boolean,
): void {
	const warningIds = warningIdsFor(tree);
	if (warningIds.size === 0) {
		return;
	}

	const cellCounts = warningCellCountsFor(items, warningIds);
	const texts = warningTextsById(tree);

	warningIds.forEach((id) => {
		// A node hidden by a condition, or belonging to another tree, simply has no element.
		const element = document.getElementById(idPrefix + id);
		if (!element) {
			return;
		}

		// Built through the DOM rather than innerHTML: nothing derived from a mod-supplied id is
		// ever interpolated into markup.
		const marker = document.createElement("div");
		marker.className = warningBoxClass;
		if (!visible) {
			marker.style.display = "none";
		}
		const badge = document.createElement("span");
		badge.className = warningBadgeClass;
		const stacked = cellCounts.get(id) ?? 1;
		badge.textContent = stacked > 1 ? `⚠×${stacked}` : "⚠";
		marker.appendChild(badge);
		element.appendChild(marker);

		// The tooltip lives on the .navigator child, which is what carries the node id and position
		// title; the marker itself is pointer-events:none so it can't show one.
		const navigator = element.querySelector(".navigator") as HTMLElement | null;
		const nodeTexts = texts.get(id);
		if (navigator && nodeTexts) {
			navigator.title = [navigator.title, ...nodeTexts.map((t) => `⚠ ${t}`)]
				.filter((line) => line)
				.join("\n");
		}
	});
}

// Flips the existing marker elements instead of rebuilding the tree, so hiding them stays instant
// on large trees.
export function setWarningMarkersVisible(visible: boolean): void {
	const markers = document.getElementsByClassName(warningBoxClass);
	for (let i = 0; i < markers.length; i++) {
		(markers[i] as HTMLDivElement).style.display = visible ? "block" : "none";
	}

	const button = document.getElementById("toggle-warning-markers") as HTMLButtonElement | null;
	if (button) {
		applyIconState(button, "warningMarkers", visible, feLocalize);
	}
}

// The warnings panel lists one clickable entry per warning: activating it closes the panel and
// scrolls the offending node into view with a short flash, so a warning never has to be read off
// as coordinates and hunted for by hand.
export function renderWarningList(tree: WarnedTree, idPrefix: string): void {
	const warnings = document.getElementById("warnings") as HTMLDivElement | null;
	if (!warnings) {
		return;
	}

	warnings.textContent = "";
	if (tree.warnings.length === 0) {
		const empty = document.createElement("div");
		empty.textContent = feLocalize("worldmap.warnings.nowarnings", "No warnings.");
		warnings.appendChild(empty);
		return;
	}

	for (const warning of tree.warnings) {
		const entry = document.createElement("div");
		entry.className = warningEntryClass;
		entry.setAttribute("role", "button");
		entry.tabIndex = 0;
		entry.textContent = `[${warning.source}] ${warning.text}`;
		const reveal = () => revealNode(idPrefix + warning.source);
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

export function revealNode(elementId: string): void {
	hideWarningPanel();

	// A node hidden by a condition has no element; the entry then just closes the panel.
	const element = document.getElementById(elementId);
	if (!element) {
		return;
	}

	element.scrollIntoView({ block: "center", inline: "center" });
	element.classList.add(warningFlashClass);
	setTimeout(() => element.classList.remove(warningFlashClass), 1200);
}

function hideWarningPanel(): void {
	const container = document.getElementById("warnings-container") as HTMLDivElement | null;
	if (container) {
		container.style.display = "none";
		document.body.style.overflow = "";
	}
	const button = document.getElementById("show-warnings");
	if (button) {
		applyIconState(button, "showWarnings", false, feLocalize);
	}
}

// The show-warnings button opens and closes the panel. Wired to the shell, which outlives every
// rebuild of the tree, so this runs once.
export function bindWarningPanelButton(): void {
	const showWarnings = document.getElementById("show-warnings") as HTMLButtonElement | null;
	const warnings = document.getElementById("warnings-container") as HTMLDivElement | null;
	if (!showWarnings || !warnings) {
		return;
	}
	showWarnings.addEventListener("click", () => {
		const visible = warnings.style.display === "block";
		document.body.style.overflow = visible ? "" : "hidden";
		warnings.style.display = visible ? "none" : "block";
		applyIconState(showWarnings, "showWarnings", !visible, feLocalize);
	});
}
