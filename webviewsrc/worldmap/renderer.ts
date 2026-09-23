import { Zone } from "../../src/previewdef/worldmap/definitions";
import { FEWorldMap, Loader } from "./loader";
import { ViewPoint } from "./viewpoint";
import { TopBar } from "./topbar";
import { Subscriber } from "../util/event";
import { feLocalize } from "../util/i18n";
import { combineLatest, fromEvent } from "rxjs";
import { distinctUntilChanged } from "rxjs/operators";
import {
	isEdgeVisible,
	isLabelVisible,
	isRiverVisible,
	isSupplyVisible,
	renderAllOffsets,
	RenderContext,
} from "./renderContext";
import { renderAllEdges, renderMapBackground } from "./provinceLayer";
import { loadResourceImages, renderMapLabels } from "./stateLayer";
import {
	renderHoverSelectionByViewMode,
	renderLoadingText,
	renderRivers,
	renderSupplyRelated,
} from "./overlayLayer";

export class Renderer extends Subscriber {
	private canvasWidth: number = 0;
	private canvasHeight: number = 0;

	private backCanvas: HTMLCanvasElement;
	private mapCanvas: HTMLCanvasElement;
	private mainCanvasContext: CanvasRenderingContext2D;
	private backCanvasContext: CanvasRenderingContext2D;

	private cursorX = 0;
	private cursorY = 0;

	constructor(
		private mainCanvas: HTMLCanvasElement,
		private viewPoint: ViewPoint,
		private loader: Loader,
		private topBar: TopBar,
	) {
		super();

		this.addSubscription(
			fromEvent(window, "resize").subscribe(this.resizeCanvas),
		);

		this.mainCanvasContext = this.mainCanvas.getContext("2d")!;
		this.backCanvas = document.createElement("canvas");
		this.backCanvasContext = this.backCanvas.getContext("2d")!;
		this.mapCanvas = document.createElement("canvas");

		this.registerCanvasEventHandlers();
		this.resizeCanvas();

		this.addSubscription(loader.worldMap$.subscribe(this.reloadImages));
		// Direct (not rAF-coalesced) so the load-completion emit always renders, even on a hidden panel.
		this.addSubscription(loader.worldMap$.subscribe(this.renderCanvas));
		this.addSubscription(
			combineLatest([
				loader.progress$,
				viewPoint.observable$,
				topBar.viewMode$,
				topBar.colorSet$,
				topBar.hoverProvinceId$,
				topBar.selectedProvinceId$,
				topBar.hoverStateId$,
				topBar.selectedStateId$,
				topBar.hoverStrategicRegionId$,
				topBar.selectedStrategicRegionId$,
				topBar.hoverSupplyAreaId$,
				topBar.selectedSupplyAreaId$,
				topBar.warningFilter.selectedValues$,
				topBar.display.selectedValues$,
			])
				.pipe(distinctUntilChanged((x, y) => x.every((v, i) => v === y[i])))
				.subscribe(this.scheduleRender),
		);
	}

	private renderScheduled = false;
	// Coalesces bursts of triggers into one render per frame; renderCanvas reads current state at
	// rAF time, so a coalesced render never paints stale data.
	private scheduleRender = () => {
		if (this.renderScheduled) {
			return;
		}
		this.renderScheduled = true;
		requestAnimationFrame(() => {
			this.renderScheduled = false;
			this.renderCanvas();
		});
	};

	private reloadImages = () => {
		loadResourceImages(this.loader.worldMap.resources);
	};

	public renderCanvas = () => {
		if (this.canvasWidth <= 0 && this.canvasHeight <= 0) {
			return;
		}

		const backCanvasContext = this.backCanvasContext;

		backCanvasContext.fillStyle = "black";
		backCanvasContext.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
		backCanvasContext.fillStyle = "white";
		backCanvasContext.font = "12px sans-serif";

		this.renderMap();
		backCanvasContext.drawImage(this.mapCanvas, 0, 0);

		renderHoverSelectionByViewMode({
			backCanvasContext,
			viewPoint: this.viewPoint,
			topBar: this.topBar,
			worldMap: this.loader.worldMap,
			cursorX: this.cursorX,
			cursorY: this.cursorY,
			canvasWidth: this.canvasWidth,
			canvasHeight: this.canvasHeight,
		});

		if (this.loader.progressText !== "") {
			renderLoadingText(backCanvasContext, this.loader.progressText);
		} else if (this.loader.loading$.value) {
			renderLoadingText(
				backCanvasContext,
				feLocalize(
					"worldmap.progress.visualizing",
					"Visualizing map data: {0}",
					Math.round(this.loader.progress * 100) + "%",
				),
			);
		}

		this.mainCanvasContext.drawImage(this.backCanvas, 0, 0);
	};

	private resizeCanvas = () => {
		this.canvasWidth =
			this.mainCanvas.width =
			this.mapCanvas.width =
			this.backCanvas.width =
				window.innerWidth;
		this.canvasHeight =
			this.mainCanvas.height =
			this.mapCanvas.height =
			this.backCanvas.height =
				window.innerHeight;
		this.renderCanvas();
	};

	private oldMapState: MapRenderState | undefined = undefined;
	private renderMap() {
		const newMapState = mapRenderState(
			this.loader.worldMap,
			this.canvasWidth,
			this.canvasHeight,
			this.topBar,
			this.viewPoint,
		);
		if (sameMapState(this.oldMapState, newMapState)) {
			return;
		}
		this.oldMapState = newMapState;
		Renderer.renderMapImpl(
			this.mapCanvas,
			this.topBar,
			this.viewPoint,
			newMapState.worldMap,
			mapRenderOptions(newMapState.fastRendering),
		);
	}

	public static renderMapImpl(
		canvas: HTMLCanvasElement,
		topBar: TopBar,
		viewPoint: ViewPoint,
		worldMap: FEWorldMap,
		otherRenderContext?: Partial<RenderContext>,
	) {
		const mapCanvasContext = canvas.getContext("2d")!;
		mapCanvasContext.fillStyle = "black";
		mapCanvasContext.fillRect(0, 0, canvas.width, canvas.height);

		const renderContext: RenderContext = {
			topBar,
			viewPoint,
			mapCanvasContext,
			provinceToState: worldMap.getProvinceToStateMap(),
			provinceToStrategicRegion: worldMap.getProvinceToStrategicRegionMap(),
			stateToSupplyArea: worldMap.getStateToSupplyAreaMap(),
			renderedProvincesByOffset: {},
			renderedProvincesById: {},
			extraState: undefined,
			...otherRenderContext,
		};

		const mapZone: Zone = { x: 0, y: 0, w: worldMap.width, h: worldMap.height };
		renderAllOffsets(viewPoint, mapZone, worldMap.width, (xOffset) =>
			renderMapBackground(worldMap, xOffset, renderContext),
		);

		renderAllOffsets(viewPoint, mapZone, worldMap.width, (xOffset) =>
			renderMapForeground(worldMap, xOffset, renderContext),
		);
	}

	private registerCanvasEventHandlers() {
		this.addSubscription(
			fromEvent<MouseEvent>(this.mainCanvas, "mousemove").subscribe((e) => {
				this.cursorX = e.pageX;
				this.cursorY = e.pageY;
				this.scheduleRender();
			}),
		);
	}
}

export type MapRenderState = ReturnType<typeof mapRenderState>;

// Everything the map canvas depends on; the map is only redrawn when one of these changes.
export function mapRenderState(
	worldMap: FEWorldMap,
	canvasWidth: number,
	canvasHeight: number,
	topBar: TopBar,
	viewPoint: ViewPoint,
) {
	const displayOptions = topBar.display.selectedValues$.value;
	return {
		worldMap,
		canvasWidth,
		canvasHeight,
		viewMode: topBar.viewMode$.value,
		colorSet: topBar.colorSet$.value,
		warningFilter: topBar.warningFilter.selectedValues$.value,
		edgeVisible: displayOptions.includes("edge"),
		labelVisible: displayOptions.includes("label"),
		adaptZooming: displayOptions.includes("adaptzooming"),
		fastRendering: displayOptions.includes("fastrending"),
		supplyVisible: displayOptions.includes("supply"),
		riverVisible: displayOptions.includes("river"),
		...viewPoint.toJson(),
	};
}

export function sameMapState(
	oldState: MapRenderState | undefined,
	newState: MapRenderState,
): boolean {
	if (oldState === undefined) {
		return false;
	}
	return (Object.keys(newState) as (keyof MapRenderState)[]).every(
		(k) => oldState[k] === newState[k],
	);
}

export function mapRenderOptions(
	fastRendering: boolean,
): Partial<RenderContext> {
	return fastRendering ? {} : { preciseEdge: true, overwriteRenderPrecision: 1 };
}

function renderMapForeground(
	worldMap: FEWorldMap,
	xOffset: number,
	renderContext: RenderContext,
) {
	const { mapCanvasContext: context, topBar, viewPoint } = renderContext;

	if (isRiverVisible(topBar, viewPoint)) {
		renderRivers(renderContext, worldMap, context, xOffset);
	}

	if (isEdgeVisible(topBar, viewPoint)) {
		renderAllEdges(renderContext, worldMap, context, xOffset);
	}

	if (isSupplyVisible(topBar)) {
		renderSupplyRelated(renderContext, worldMap, context, xOffset);
	}

	if (isLabelVisible(topBar, viewPoint)) {
		renderMapLabels(renderContext, worldMap, context, xOffset);
	}
}
