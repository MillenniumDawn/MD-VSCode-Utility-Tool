import { Loader } from "./loader";
import { ViewPoint } from "./viewpoint";
import { topBarHeight, TopBar } from "./topbar";
import { getState, setState } from "../util/common";
import { Renderer } from "./renderer";
import { fromEvent } from "rxjs";
import { auditTime } from "rxjs/operators";
import { WorldMapMessage } from "../../src/previewdef/worldmap/definitions";

fromEvent(window, "load").subscribe(function () {
	applySupplyAreaFlag((window as any).__enableSupplyArea ?? false);

	const state = getState();
	const loader = new Loader();
	const mainCanvas = document.getElementById(
		"main-canvas",
	) as HTMLCanvasElement;
	const viewPoint = new ViewPoint(
		mainCanvas,
		loader,
		topBarHeight,
		state.viewPoint || { x: 0, y: -topBarHeight, scale: 1 },
	);
	const topBar = new TopBar(mainCanvas, viewPoint, loader, state);
	new Renderer(mainCanvas, viewPoint, loader, topBar);

	fromEvent(mainCanvas, "contextmenu").subscribe((event) =>
		event.preventDefault(),
	);

	// Dragging the map emits per mouse pixel, and every emit was a getState/merge/setState round
	// trip. auditTime, not debounceTime: each window still ends in an emit, so the position a drag
	// finished on is always the one that gets remembered.
	viewPoint.observable$
		.pipe(auditTime(150))
		.subscribe(setStateForKey("viewPoint"));
	topBar.viewMode$.subscribe(setStateForKey("viewMode"));
	topBar.colorSet$.subscribe(setStateForKey("colorSet"));
	topBar.selectedProvinceId$.subscribe(setStateForKey("selectedProvinceId"));
	topBar.selectedStateId$.subscribe(setStateForKey("selectedStateId"));
	topBar.selectedStrategicRegionId$.subscribe(
		setStateForKey("selectedStrategicRegionId"),
	);
	topBar.selectedSupplyAreaId$.subscribe(
		setStateForKey("selectedSupplyAreaId"),
	);
	topBar.warningFilter.selectedValues$.subscribe(
		setStateForKey("warningFilter"),
	);
	topBar.display.selectedValues$.subscribe(setStateForKey("display"));
});

function setStateForKey<T>(key: string): (newValue: T) => void {
	return (newValue) => {
		setState({ [key]: newValue });
	};
}

// The host pushes the flag when mdHoi4Utilities.enableSupplyArea changes with the panel open, or
// when a refresh re-reads it; the page had it only as this one script value before, so the
// toolbar could not follow an open panel.
fromEvent<MessageEvent>(window, "message").subscribe((event) => {
	const message = event.data as WorldMapMessage;
	if (message.command === "enablesupplyarea") {
		applySupplyAreaFlag(message.data);
	}
});

// The toolbar options the page ships with, captured the first time a flag is applied, before
// anything is hidden. The elements are hidden by detaching and kept alive, so turning the setting
// back on puts the same elements back in their original order; removing them outright could not
// be undone.
interface SupplyAreaGatedOptions {
	container: HTMLElement;
	options: HTMLElement[];
}

let supplyAreaGatedOptions: SupplyAreaGatedOptions[] | undefined = undefined;

function applySupplyAreaFlag(enableSupplyArea: boolean): void {
	(window as any).__enableSupplyArea = enableSupplyArea;

	// A page that loads again starts a new DOM, so the capture is taken again when the one held
	// belongs to elements that document has thrown away.
	if (
		supplyAreaGatedOptions === undefined ||
		supplyAreaGatedOptions.some(({ container }) => !container.isConnected)
	) {
		supplyAreaGatedOptions = ["viewmode", "colorset", "display", "warningfilter"].map(
			(id) => {
				const container = document.getElementById(id)!;
				return {
					container,
					options: Array.from(
						container.querySelectorAll("option, .option"),
					) as HTMLElement[],
				};
			},
		);
	}

	for (const { container, options } of supplyAreaGatedOptions) {
		const isSelect = container.tagName === "SELECT";
		// Read before the rebuild: the browser may have already repaired a lost selection.
		const previousValue = isSelect ? (container as HTMLSelectElement).value : undefined;
		const keep = options.filter((option) => {
			const attribute = option.getAttribute("enablesupplyarea");
			return !attribute || attribute === enableSupplyArea.toString();
		});
		for (const option of options) {
			if (!keep.includes(option)) {
				option.remove();
			}
		}
		// Re-appending also restores the original order after part of the list was hidden.
		container.append(...keep);
		if (isSelect && keep.length < options.length) {
			restoreUsableSelection(container as HTMLSelectElement, keep, previousValue);
		}
	}
}

// A view mode or color set the setting took away cannot stay selected: the renderers read those
// values into tables keyed by the view mode, and a select left pointing at an option it lost
// would render nothing instead. Fall back to the first kept option and let the change listeners
// hear it — including the browser that quietly repaired the selection itself, which must not
// leave the page's view mode stale.
function restoreUsableSelection(
	select: HTMLSelectElement,
	keep: HTMLElement[],
	previousValue: string | undefined,
): void {
	const values = new Set(keep.map((option) => (option as HTMLOptionElement).value));
	if (values.size === 0 || (previousValue !== undefined && values.has(previousValue))) {
		return;
	}
	const first = keep[0] as HTMLOptionElement;
	if (values.has(select.value) === false) {
		select.value = first.value;
	}
	select.dispatchEvent(new Event("change"));
}
