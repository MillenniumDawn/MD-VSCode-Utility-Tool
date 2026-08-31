import { Province, Zone } from "./definitions";
import { TopBar, ViewMode } from "./topbar";
import { ViewPoint } from "./viewpoint";

export const renderScaleByViewMode: Record<
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
	renderedProvinces?: Province[];
	overwriteRenderPrecision?: number;
	preciseEdge?: boolean;
	extraState: any;
}

export function isEdgeVisible(topBar: TopBar, viewPoint: ViewPoint) {
	if (topBar.display.selectedValues$.value.includes("adaptzooming")) {
		const viewMode = topBar.viewMode$.value;
		const renderScale = renderScaleByViewMode[viewMode];
		const scale = viewPoint.scale;
		return (
			renderScale.edge <= scale &&
			topBar.display.selectedValues$.value.includes("edge")
		);
	}

	return topBar.display.selectedValues$.value.includes("edge");
}

export function isLabelVisible(topBar: TopBar, viewPoint: ViewPoint) {
	if (topBar.display.selectedValues$.value.includes("adaptzooming")) {
		const viewMode = topBar.viewMode$.value;
		const renderScale = renderScaleByViewMode[viewMode];
		const scale = viewPoint.scale;
		return (
			renderScale.labels <= scale &&
			topBar.display.selectedValues$.value.includes("label")
		);
	}

	return topBar.display.selectedValues$.value.includes("label");
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
	if (topBar.display.selectedValues$.value.includes("adaptzooming")) {
		return (
			1 <= viewPoint.scale &&
			topBar.display.selectedValues$.value.includes("river")
		);
	}

	return topBar.display.selectedValues$.value.includes("river");
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
