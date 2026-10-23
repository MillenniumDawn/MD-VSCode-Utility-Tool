import { Province, Zone } from "./definitions";
import { TopBar, ViewMode } from "./topbar";
import { ViewPoint } from "./viewpoint";

const renderScaleByViewMode: Record<
	ViewMode,
	{ edge: number; labels: number }
> = {
	province: { edge: 2, labels: 3 },
	state: { edge: 1, labels: 1 },
	strategicregion: { edge: 0.25, labels: 0.25 },
	supplyarea: { edge: 0.5, labels: 1 },
	warnings: { edge: 2, labels: 3 },
};

export interface RenderContext {
	topBar: TopBar;
	viewPoint: ViewPoint;
	mapCanvasContext: CanvasRenderingContext2D;
	provinceToState: Record<number, number | undefined>;
	provinceToStrategicRegion: Record<number, number | undefined>;
	stateToSupplyArea: Record<number, number | undefined>;
	renderedProvincesByOffset: Record<number, Province[]>;
	renderedProvincesById: Record<number, Province>;
	overwriteRenderPrecision?: number;
	preciseEdge?: boolean;
	extraState: any;
}

// A display option the reader ticked, hidden below minScale while adaptive zooming is on.
function displayOn(topBar: TopBar, viewPoint: ViewPoint, option: string, minScale: number) {
	const selected = topBar.display.selectedValues$.value;
	return selected.includes(option) && (!selected.includes("adaptzooming") || minScale <= viewPoint.scale);
}

export function isEdgeVisible(topBar: TopBar, viewPoint: ViewPoint) {
	return displayOn(topBar, viewPoint, "edge", renderScaleByViewMode[topBar.viewMode$.value].edge);
}

export function isLabelVisible(topBar: TopBar, viewPoint: ViewPoint) {
	return displayOn(topBar, viewPoint, "label", renderScaleByViewMode[topBar.viewMode$.value].labels);
}

export function isMouseHighlightVisible(topBar: TopBar) {
	return topBar.display.selectedValues$.value.includes("mousehighlight");
}

export function isTooltipVisible(topBar: TopBar) {
	return topBar.display.selectedValues$.value.includes("tooltip");
}

export function isSupplyVisible(topBar: TopBar) {
	return topBar.display.selectedValues$.value.includes("supply");
}

export function isRiverVisible(topBar: TopBar, viewPoint: ViewPoint) {
	return displayOn(topBar, viewPoint, "river", 1);
}

export function renderAllOffsets(
	viewPoint: ViewPoint,
	boundingBox: Zone,
	step: number,
	callback: (xOffset: number) => void,
	minimalRenderCount: number = 1,
) {
	let xOffset = 0;
	let i = 0;
	let inView = viewPoint.bboxInView(boundingBox, xOffset);
	while (inView || i < minimalRenderCount) {
		if (inView) {
			callback(xOffset);
		}
		if (step <= 0) {
			return;
		}
		xOffset += step;
		i++;
		inView = viewPoint.bboxInView(boundingBox, xOffset);
	}
}
