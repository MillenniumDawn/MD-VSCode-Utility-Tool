import type { __table } from "../../i18n/en";

// Every codicon the extension shows, in one table: the preview toolbars, the zoom controls, the
// status bar and the editor title bar all take their icon and tooltip from here, and
// src/test/toolbaricons.test.ts fails on any codicon written anywhere else. The rules the table has
// to keep are in issue #446 and in that test.
//
// Imported by webview bundles, so it must stay free of any runtime dependency -- no vscode, no
// localisation index. The caller passes its own localize function.

export type LocaleKey = keyof typeof __table;
export type Localizer = (key: LocaleKey, message: string) => string;

// Where an icon is drawn. The guard test uses it to know which surfaces to render.
export type IconSurface =
	| "focustree"
	| "gui"
	| "worldmap"
	| "zoom"
	| "decisiontree"
	| "checkbox"
	| "errorpage"
	| "statusbar"
	| "editortitle";

export interface IconAction {
	// A toggle with two looks names both; `on` is the icon while the thing it controls is shown.
	readonly icon: string | { readonly on: string; readonly off: string };
	// The attribute that carries a toggle's state. Absent for a plain action.
	readonly state?: "aria-pressed" | "aria-expanded" | "aria-checked";
	// How a toggle that keeps one icon shows its state instead: "pressed" is the button[aria-pressed]
	// style in common.css, "checkmark" the check that is only drawn while the box is ticked.
	readonly stateStyle?: "pressed" | "checkmark";
	// Tooltip and aria-label, starting with a verb. For an `aria-expanded` toggle the tooltip says
	// what a click does, so it has a second one for the expanded state.
	readonly tooltipKey?: LocaleKey;
	readonly tooltip?: string;
	readonly tooltipOnKey?: LocaleKey;
	readonly tooltipOn?: string;
	readonly shortcut?: string;
	// What a disabled button says instead, so the reader learns why it cannot be clicked. Every
	// action that is ever rendered disabled has one.
	readonly disabledTooltipKey?: LocaleKey;
	readonly disabledTooltip?: string;
	// Only an action that opens a list of problems may use an alarm icon (warning, error, ...).
	readonly reportsProblem?: true;
	// Why a button is not always on screen, for a button that is not.
	readonly shownWhen?: string;
	readonly surfaces: readonly IconSurface[];
}

export const iconActions = {
	preview: {
		icon: "open-preview",
		surfaces: ["editortitle"],
	},
	scanReferences: {
		icon: "references",
		surfaces: ["editortitle"],
		shownWhen: "the open file is an event file",
	},
	modFile: {
		icon: "file-code",
		surfaces: ["statusbar"],
	},
	modFileError: {
		icon: "error",
		reportsProblem: true,
		surfaces: ["statusbar"],
		shownWhen: "the selected mod file cannot be read",
	},
	refresh: {
		icon: "refresh",
		tooltipKey: "common.topbar.refresh.title",
		tooltip: "Refresh",
		surfaces: ["gui", "worldmap", "errorpage"],
	},
	resetCheckboxes: {
		icon: "discard",
		tooltipKey: "focustree.resetcheckboxes",
		tooltip: "Reset focus checkboxes",
		surfaces: ["focustree"],
	},
	showWarnings: {
		icon: "warning",
		state: "aria-pressed",
		stateStyle: "pressed",
		tooltipKey: "toolbar.warnings",
		tooltip: "Show warning list",
		disabledTooltipKey: "toolbar.nowarnings",
		disabledTooltip: "No warnings to show",
		reportsProblem: true,
		surfaces: ["focustree", "worldmap"],
	},
	warningMarkers: {
		icon: { on: "circle-large-filled", off: "circle-large-outline" },
		state: "aria-pressed",
		stateStyle: "pressed",
		tooltipKey: "toolbar.warningmarkers",
		tooltip: "Show warning markers on the tree",
		disabledTooltipKey: "toolbar.nowarnings",
		disabledTooltip: "No warnings to show",
		surfaces: ["focustree"],
	},
	editContinuous: {
		icon: "move",
		tooltipKey: "focustree.editcontinuous",
		tooltip: "Drag the continuous focus box to set its position",
		shownWhen: "the tree defines a continuous focus box",
		surfaces: ["focustree"],
	},
	copyWarnings: {
		icon: "copy",
		tooltipKey: "focustree.copywarnings",
		tooltip: "Copy this focus tree's warnings",
		disabledTooltipKey: "toolbar.nowarnings",
		disabledTooltip: "No warnings to show",
		surfaces: ["focustree"],
	},
	shortcutToggle: {
		icon: "chevron-left",
		state: "aria-expanded",
		stateStyle: "pressed",
		tooltipKey: "focustree.shortcuts.toggle",
		tooltip: "Show or hide the shortcuts",
		shownWhen: "the tree has shortcuts",
		surfaces: ["focustree"],
	},
	containerWindows: {
		icon: { on: "eye", off: "eye-closed" },
		state: "aria-pressed",
		stateStyle: "pressed",
		tooltipKey: "toolbar.containerwindows",
		tooltip: "Show container windows",
		surfaces: ["gui"],
	},
	saveImage: {
		icon: "save-as",
		tooltipKey: "toolbar.saveimage",
		tooltip: "Save map as image",
		surfaces: ["worldmap"],
	},
	openFile: {
		icon: "go-to-file",
		tooltipKey: "toolbar.openfile",
		tooltip: "Open file in editor",
		surfaces: ["worldmap"],
		shownWhen: "the view mode is state, strategic region or supply area",
	},
	clearTrace: {
		icon: "close",
		tooltipKey: "toolbar.cleartrace",
		tooltip: "Stop tracing prerequisite lines (Esc)",
		shortcut: "Esc",
		surfaces: ["focustree"],
		shownWhen: "a prerequisite trace is active",
	},
	search: {
		icon: "search",
		tooltipKey: "worldmap.topbar.search.title",
		tooltip: "Search",
		surfaces: ["worldmap"],
		shownWhen: "the view mode can be searched",
	},
	zoomOut: {
		icon: "zoom-out",
		tooltipKey: "zoom.out",
		tooltip: "Zoom out (-)",
		shortcut: "-",
		surfaces: ["zoom"],
	},
	zoomIn: {
		icon: "zoom-in",
		tooltipKey: "zoom.in",
		tooltip: "Zoom in (+)",
		shortcut: "+",
		surfaces: ["zoom"],
	},
	collapseCategory: {
		icon: { on: "chevron-down", off: "chevron-right" },
		state: "aria-expanded",
		tooltipKey: "decisiontree.expand",
		tooltip: "Expand this category",
		tooltipOnKey: "decisiontree.collapse",
		tooltipOn: "Collapse this category",
		surfaces: ["decisiontree"],
	},
	checkbox: {
		icon: "check",
		state: "aria-checked",
		stateStyle: "checkmark",
		surfaces: ["checkbox"],
	},
} as const satisfies Record<string, IconAction>;

export type IconActionId = keyof typeof iconActions;

// The order of the buttons in a toolbar's action group. Every preview draws the ones it has in this
// order, so a button shared by two previews is in the same place in both.
export const actionGroupOrder: readonly IconActionId[] = [
	"refresh",
	"resetCheckboxes",
	"showWarnings",
	"warningMarkers",
	"editContinuous",
	"copyWarnings",
	"containerWindows",
	"saveImage",
	"openFile",
	"clearTrace",
];

// The class of the group of icon buttons pinned to the right end of a toolbar. See common.css.
export const toolbarActionsClass = "toolbar-actions";

function action(id: IconActionId): IconAction {
	return iconActions[id];
}

export function iconOf(id: IconActionId, on = true): string {
	const icon = action(id).icon;
	return typeof icon === "string" ? icon : on ? icon.on : icon.off;
}

export function iconClassOf(id: IconActionId, on = true): string {
	return "codicon codicon-" + iconOf(id, on);
}

// The icon in the form VS Code draws in status bar text.
export function statusBarIcon(id: IconActionId): string {
	return "$(" + iconOf(id) + ")";
}

export function tooltipOf(id: IconActionId, localize: Localizer, on = false): string {
	const a = action(id);
	if (on && a.tooltipOnKey !== undefined) {
		return localize(a.tooltipOnKey, a.tooltipOn ?? "");
	}
	return a.tooltipKey === undefined ? "" : localize(a.tooltipKey, a.tooltip ?? "");
}

function escapeAttribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export interface IconButtonOptions {
	// The element id; the webview finds the button by it.
	domId: string;
	// The toggle's state at render time. Ignored for a plain action.
	on?: boolean;
	disabled?: boolean;
	// Extra attributes, written as they are.
	attributes?: string;
}

export function iconButtonHtml(id: IconActionId, localize: Localizer, options: IconButtonOptions): string {
	const a = action(id);
	const on = options.on ?? false;
	const title = escapeAttribute(options.disabled && a.disabledTooltipKey !== undefined
		? localize(a.disabledTooltipKey, a.disabledTooltip ?? "")
		: tooltipOf(id, localize, on));
	const state = a.state === undefined ? "" : ` ${a.state}="${on}"`;
	const disabled = options.disabled ? " disabled" : "";
	const attributes = options.attributes ? " " + options.attributes : "";
	return `<button id="${escapeAttribute(options.domId)}" type="button" data-action="${id}" title="${title}" aria-label="${title}"${state}${disabled}${attributes}>` +
		`<i class="${iconClassOf(id, a.state === undefined || on)}" aria-hidden="true"></i></button>`;
}

// The buttons a toolbar has, in actionGroupOrder, inside the group pinned to its right end.
export function actionGroupHtml(buttons: Partial<Record<IconActionId, string>>, extraClass = ""): string {
	const ordered = actionGroupOrder.map(id => buttons[id]).filter((b): b is string => b !== undefined);
	return `<div class="${(toolbarActionsClass + " " + extraClass).trim()}">${ordered.join("")}</div>`;
}

// Brings a toggle button in line with its state: the icon, the state attribute and, where the
// tooltip names what a click does, the tooltip and aria-label.
export function applyIconState(button: HTMLElement, id: IconActionId, on: boolean, localize: Localizer): void {
	const a = action(id);
	if (a.state !== undefined) {
		button.setAttribute(a.state, String(on));
	}
	const icon = button.querySelector("i.codicon");
	if (icon) {
		icon.className = iconClassOf(id, on);
		icon.setAttribute("aria-hidden", "true");
	}
	if (a.tooltipOnKey !== undefined) {
		const title = tooltipOf(id, localize, on);
		button.title = title;
		button.setAttribute("aria-label", title);
	}
}
