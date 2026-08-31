import { Province, State, StrategicRegion, SupplyArea } from "./definitions";
import { FEWorldMap } from "./loader";
import { ViewPoint } from "./viewpoint";
import { TopBar, topBarHeight } from "./topbar";
import { feLocalize } from "../util/i18n";
import { chain, max } from "lodash";
import { toColor, waterWarning } from "./colors";
import {
	isMouseHighlightVisible,
	isTooltipVisible,
	renderAllOffsets,
	RenderContext,
} from "./renderContext";
import { renderProvince } from "./provinceLayer";
import { getResourcesSize, renderResources } from "./stateLayer";

export interface OverlaySession {
	backCanvasContext: CanvasRenderingContext2D;
	viewPoint: ViewPoint;
	topBar: TopBar;
	worldMap: FEWorldMap;
	cursorX: number;
	cursorY: number;
	canvasWidth: number;
	canvasHeight: number;
}

export function renderSupplyRelated(
	renderContext: RenderContext,
	worldMap: FEWorldMap,
	context: CanvasRenderingContext2D,
	xOffset: number,
): void {
	const { renderedProvincesById, viewPoint } = renderContext;

	context.strokeStyle = "rgb(200, 0, 0)";
	worldMap.forEachRailway((railway) => {
		if (railway.provinces.every((id) => !renderedProvincesById[id])) {
			return;
		}

		context.beginPath();
		context.lineWidth = Math.min(10, 2 * railway.level);
		let hasProvince = false;
		for (let i = 0; i < railway.provinces.length; i++) {
			const province = worldMap.getProvinceById(railway.provinces[i]);
			if (province) {
				if (!hasProvince) {
					context.moveTo(
						viewPoint.convertX(province.centerOfMass.x + xOffset),
						viewPoint.convertY(province.centerOfMass.y),
					);
				} else {
					context.lineTo(
						viewPoint.convertX(province.centerOfMass.x + xOffset),
						viewPoint.convertY(province.centerOfMass.y),
					);
				}
				hasProvince = true;
			} else {
				context.stroke();
				hasProvince = false;
			}
		}
		if (hasProvince) {
			context.stroke();
		}
	});

	context.fillStyle = "rgb(200, 0, 0)";
	const size = Math.min(30, viewPoint.scale * 10);
	worldMap.forEachSupplyNode((supplyNode) => {
		const province = renderedProvincesById[supplyNode.province];
		if (province) {
			const x = viewPoint.convertX(province.centerOfMass.x + xOffset);
			const y = viewPoint.convertY(province.centerOfMass.y);
			context.fillRect(x - size / 2, y - size / 2, size, size);
		}
	});
}

export function renderRivers(
	renderContext: RenderContext,
	worldMap: FEWorldMap,
	context: CanvasRenderingContext2D,
	xOffset: number,
): void {
	const { viewPoint, topBar } = renderContext;
	const showRiverWarning =
		topBar.colorSet$.value === "warnings" &&
		topBar.warningFilter.selectedValues$.value.includes("river");

	const riverColors: string[] = [
		"rgb(0, 255, 0)",
		"rgb(255, 0, 0)",
		"rgb(255, 252, 0)",
		"rgb(0, 225, 255)",
		"rgb(0, 200, 255)",
		"rgb(0, 150, 255)",
		"rgb(0, 100, 255)",
		"rgb(0, 0, 255)",
		"rgb(0, 0, 255)",
		"rgb(0, 0, 200)",
		"rgb(0, 0, 150)",
		"rgb(0, 0, 100)",
	];

	const warningColor = toColor(waterWarning);

	for (let i = 0; i < worldMap.rivers.length; i++) {
		const river = worldMap.rivers[i];
		if (
			river === undefined ||
			!viewPoint.bboxInView(river.boundingBox, xOffset)
		) {
			continue;
		}

		const hasWarning =
			showRiverWarning && worldMap.getRiverWarnings(i).length > 0;
		for (const key in river.colors) {
			const index = parseInt(key, 10);
			const x = (index % river.boundingBox.w) + river.boundingBox.x;
			const y = Math.floor(index / river.boundingBox.w) + river.boundingBox.y;
			const color = river.colors[key] ?? 0;
			context.fillStyle =
				hasWarning && color >= 3
					? warningColor
					: (riverColors[color] ?? riverColors[0] ?? warningColor);
			context.fillRect(
				viewPoint.convertX(x + xOffset),
				viewPoint.convertY(y),
				viewPoint.scale,
				viewPoint.scale,
			);
		}
	}
}

export function renderHoverSelectionByViewMode(session: OverlaySession) {
	const { topBar, worldMap } = session;
	const viewMode = topBar.viewMode$.value;
	switch (viewMode) {
		case "province":
		case "warnings":
			renderProvinceHoverSelection(session, worldMap);
			break;
		case "state":
			renderStateHoverSelection(session, worldMap);
			break;
		case "strategicregion":
			renderStrategicRegionHoverSelection(session, worldMap);
			break;
		case "supplyarea":
			renderSupplyAreaHoverSelection(session, worldMap);
			break;
	}
}

export function renderLoadingText(
	backCanvasContext: CanvasRenderingContext2D,
	text: string,
) {
	backCanvasContext.font = "12px sans-serif";
	const mesurement = backCanvasContext.measureText(text);
	backCanvasContext.fillStyle = "black";
	backCanvasContext.fillRect(0, topBarHeight, 20 + mesurement.width, 32);
	backCanvasContext.fillStyle = "white";
	backCanvasContext.textAlign = "start";
	backCanvasContext.textBaseline = "top";
	backCanvasContext.fillText(text, 10, 10 + topBarHeight);
}

function renderHoverProvince(
	session: OverlaySession,
	province: Province,
	worldMap: FEWorldMap,
	renderAdjacent: boolean = true,
) {
	const { backCanvasContext, viewPoint } = session;
	backCanvasContext.fillStyle = "rgba(255, 255, 255, 0.7)";
	renderAllOffsets(viewPoint, province.boundingBox, worldMap.width, (xOffset) =>
		renderProvince(
			viewPoint,
			backCanvasContext,
			province,
			viewPoint.scale,
			xOffset,
		),
	);

	if (!renderAdjacent) {
		return;
	}

	for (const adjecent of province.edges) {
		const adjecentNumber = adjecent.to;
		if (adjecentNumber === -1 || adjecent.type === "impassable") {
			continue;
		}
		const adjecentProvince = worldMap.getProvinceById(adjecentNumber);
		if (adjecentProvince) {
			backCanvasContext.fillStyle = "rgba(255, 255, 255, 0.3)";
			renderAllOffsets(
				viewPoint,
				adjecentProvince.boundingBox,
				worldMap.width,
				(xOffset) =>
					renderProvince(
						viewPoint,
						backCanvasContext,
						adjecentProvince,
						viewPoint.scale,
						xOffset,
					),
			);
		}
	}
}

function renderSelectedProvince(
	session: OverlaySession,
	province: Province,
	worldMap: FEWorldMap,
) {
	session.backCanvasContext.fillStyle = "rgba(128, 255, 128, 0.7)";
	renderAllOffsets(
		session.viewPoint,
		province.boundingBox,
		worldMap.width,
		(xOffset) =>
			renderProvince(
				session.viewPoint,
				session.backCanvasContext,
				province,
				session.viewPoint.scale,
				xOffset,
			),
	);
}

function renderProvinceTooltip(
	session: OverlaySession,
	province: Province,
	worldMap: FEWorldMap,
) {
	const stateObject = worldMap.getStateByProvinceId(province.id);
	const strategicRegion = worldMap.getStrategicRegionByProvinceId(province.id);
	const supplyArea = stateObject
		? worldMap.getSupplyAreaByStateId(stateObject.id)
		: undefined;
	const railwayLevel = worldMap.getRailwayLevelByProvinceId(province.id);
	const supplyNode = worldMap.getSupplyNodeByProvinceId(province.id);
	const vp = stateObject?.victoryPoints[province.id];

	renderTooltip(
		session,
		`
${stateObject?.impassable ? "|r|" + feLocalize("worldmap.tooltip.impassable", "Impassable") : ""}
${feLocalize("worldmap.tooltip.province", "Province")}=${province.id}
${vp ? `${feLocalize("worldmap.tooltip.victorypoint", "Victory point")}=${vp}` : ""}
${
	stateObject
		? `
${feLocalize("worldmap.tooltip.state", "State")}=${stateObject.id}`
		: ""
}
${
	supplyArea
		? `
${feLocalize("worldmap.tooltip.supplyarea", "Supply area")}=${supplyArea.id}
`
		: ""
}
${
	railwayLevel
		? `
${feLocalize("worldmap.tooltip.railwaylevel", "Railway level")}=${railwayLevel}
`
		: ""
}
${
	supplyNode
		? `
${feLocalize("worldmap.tooltip.supplynode", "Supply node")}=true
`
		: ""
}
${
	strategicRegion
		? `
${feLocalize("worldmap.tooltip.strategicregion", "Strategic region")}=${strategicRegion.id}
`
		: ""
}
${
	stateObject
		? `
${feLocalize("worldmap.tooltip.owner", "Owner")}=${stateObject.owner}
${feLocalize("worldmap.tooltip.coreof", "Core of")}=${stateObject.cores.join(",")}
${feLocalize("worldmap.tooltip.manpower", "Manpower")}=${toCommaDivideNumber(stateObject.manpower)}`
		: ""
}
${
	supplyArea
		? `
${feLocalize("worldmap.tooltip.supplyvalue", "Supply value")}=${supplyArea.value}
`
		: ""
}
${feLocalize("worldmap.tooltip.type", "Type")}=${province.type}
${feLocalize("worldmap.tooltip.terrain", "Terrain")}=${province.terrain}
${
	strategicRegion && strategicRegion.navalTerrain
		? `
${feLocalize("worldmap.tooltip.navalterrain", "Naval terrain")}=${strategicRegion.navalTerrain}
`
		: ""
}
${feLocalize("worldmap.tooltip.coastal", "Coastal")}=${province.coastal}
${feLocalize("worldmap.tooltip.continent", "Continent")}=${province.continent !== 0 ? `${worldMap.continents[province.continent]}(${province.continent})` : "0"}
${feLocalize("worldmap.tooltip.adjacencies", "Adjecencies")}=${province.edges
			.filter((e) => e.type !== "impassable" && e.to !== -1)
			.map((e) => e.to)
			.join(",")}
${worldMap
	.getProvinceWarnings(province, stateObject, strategicRegion, supplyArea)
	.map((v) => "|r|" + v)
	.join("\n")}`,
	);
}

function renderProvinceHoverSelection(
	session: OverlaySession,
	worldMap: FEWorldMap,
) {
	let province = worldMap.getProvinceById(
		session.topBar.selectedProvinceId$.value,
	);
	if (province) {
		renderSelectedProvince(session, province, worldMap);
	}
	province = worldMap.getProvinceById(session.topBar.hoverProvinceId$.value);
	if (province) {
		if (
			session.topBar.selectedProvinceId$ !== session.topBar.hoverProvinceId$ &&
			isMouseHighlightVisible(session.topBar)
		) {
			renderHoverProvince(session, province, worldMap);
		}
		if (isTooltipVisible(session.topBar)) {
			renderProvinceTooltip(session, province, worldMap);
		}
	}
}

function renderStateHoverSelection(
	session: OverlaySession,
	worldMap: FEWorldMap,
) {
	const hover = worldMap.getStateById(session.topBar.hoverStateId$.value);
	renderHoverSelection(
		session,
		worldMap,
		hover,
		worldMap.getStateById(session.topBar.selectedStateId$.value),
	);
	hover &&
		isTooltipVisible(session.topBar) &&
		renderStateTooltip(session, hover, worldMap);
}

function renderStrategicRegionHoverSelection(
	session: OverlaySession,
	worldMap: FEWorldMap,
) {
	const hover = worldMap.getStrategicRegionById(
		session.topBar.hoverStrategicRegionId$.value,
	);
	renderHoverSelection(
		session,
		worldMap,
		hover,
		worldMap.getStrategicRegionById(
			session.topBar.selectedStrategicRegionId$.value,
		),
	);
	hover &&
		isTooltipVisible(session.topBar) &&
		renderStrategicRegionTooltip(session, hover, worldMap);
}

function renderSupplyAreaHoverSelection(
	session: OverlaySession,
	worldMap: FEWorldMap,
) {
	const hover = worldMap.getSupplyAreaById(
		session.topBar.hoverSupplyAreaId$.value,
	);
	const selected = worldMap.getSupplyAreaById(
		session.topBar.selectedSupplyAreaId$.value,
	);
	const toProvinces = (supplyArea: SupplyArea | undefined) => {
		return supplyArea
			? {
					provinces: chain(supplyArea.states)
						.map((stateId) => worldMap.getStateById(stateId)?.provinces)
						.filter((v): v is number[] => !!v)
						.flatten()
						.value(),
				}
			: undefined;
	};

	renderHoverSelection(
		session,
		worldMap,
		toProvinces(hover),
		toProvinces(selected),
	);
	hover &&
		isTooltipVisible(session.topBar) &&
		renderSupplyAreaTooltip(session, hover, worldMap);
}

function renderHoverSelection(
	session: OverlaySession,
	worldMap: FEWorldMap,
	hover: { provinces: number[] } | undefined,
	selected: { provinces: number[] } | undefined,
) {
	if (selected) {
		for (const provinceId of selected.provinces) {
			const province = worldMap.getProvinceById(provinceId);
			if (province) {
				renderSelectedProvince(session, province, worldMap);
			}
		}
	}

	if (hover && isMouseHighlightVisible(session.topBar) && hover !== selected) {
		for (const provinceId of hover.provinces) {
			const province = worldMap.getProvinceById(provinceId);
			if (province) {
				renderHoverProvince(session, province, worldMap, false);
			}
		}
	}
}

function renderStateTooltip(
	session: OverlaySession,
	state: State,
	worldMap: FEWorldMap,
) {
	const supplyArea = worldMap.getSupplyAreaByStateId(state.id);
	renderTooltip(
		session,
		`
${state.impassable ? "|r|" + feLocalize("worldmap.tooltip.impassable", "Impassable") : ""}
${state.impassableIgnoredLinks.length > 0 ? feLocalize("worldmap.tooltip.impassableignoredlinks", "Impassable ignored links") + "=" + state.impassableIgnoredLinks.join(",") : ""}
${feLocalize("worldmap.tooltip.state", "State")}=${state.id}
${
	supplyArea
		? `
${feLocalize("worldmap.tooltip.supplyarea", "Supply area")}=${supplyArea.id}
`
		: ""
}
${feLocalize("worldmap.tooltip.owner", "Owner")}=${state.owner}
${feLocalize("worldmap.tooltip.coreof", "Core of")}=${state.cores.join(",")}
${feLocalize("worldmap.tooltip.manpower", "Manpower")}=${toCommaDivideNumber(state.manpower)}
${feLocalize("worldmap.tooltip.category", "Category")}=${state.category}
${
	supplyArea
		? `
${feLocalize("worldmap.tooltip.supplyvalue", "Supply value")}=${supplyArea.value}
`
		: ""
}
${feLocalize("worldmap.tooltip.provinces", "Provinces")}=${state.provinces.join(",")}
${worldMap
	.getStateWarnings(state, supplyArea)
	.map((v) => "|r|" + v)
	.join("\n")}`,
		(width, height) => {
			const { width: w, height: h } = getResourcesSize(state);
			return { width: Math.max(width, w), height: height + h };
		},
		(x, y) => {
			renderResources(session.backCanvasContext, state, x, y);
		},
	);
}

function renderStrategicRegionTooltip(
	session: OverlaySession,
	strategicRegion: StrategicRegion,
	worldMap: FEWorldMap,
) {
	renderTooltip(
		session,
		`
${feLocalize("worldmap.tooltip.strategicregion", "Strategic region")}=${strategicRegion.id}
${
	strategicRegion.navalTerrain
		? `
${feLocalize("worldmap.tooltip.navalterrain", "Naval terrain")}=${strategicRegion.navalTerrain}
`
		: ""
}
${feLocalize("worldmap.tooltip.provinces", "Provinces")}=${strategicRegion.provinces.join(",")}
${worldMap
	.getStrategicRegionWarnings(strategicRegion)
	.map((v) => "|r|" + v)
	.join("\n")}`,
	);
}

function renderSupplyAreaTooltip(
	session: OverlaySession,
	supplyArea: SupplyArea,
	worldMap: FEWorldMap,
) {
	renderTooltip(
		session,
		`
${feLocalize("worldmap.tooltip.supplyarea", "Supply area")}=${supplyArea.id}
${feLocalize("worldmap.tooltip.supplyvalue", "Supply value")}=${supplyArea.value}
${feLocalize("worldmap.tooltip.states", "States")}=${supplyArea.states.join(",")}
${worldMap
	.getSupplyAreaWarnings(supplyArea)
	.map((v) => "|r|" + v)
	.join("\n")}`,
	);
}

function renderTooltip(
	session: OverlaySession,
	tooltip: string,
	sizeCallback?: (
		width: number,
		height: number,
	) => { width: number; height: number },
	renderCallback?: (x: number, y: number) => void,
) {
	const backCanvasContext = session.backCanvasContext;
	const cursorX = session.cursorX;
	const cursorY = session.cursorY;

	let mapX = session.viewPoint.convertBackX(cursorX);
	if (session.worldMap.width > 0 && mapX >= session.worldMap.width) {
		mapX -= session.worldMap.width;
	}
	const mapY = session.viewPoint.convertBackY(cursorY);

	tooltip =
		`(${mapX}, ${mapY})\nX=${mapX}, Z=${session.worldMap.height - 1 - mapY}\n` +
		tooltip;

	const colorPrefix = /^\|r\|/;
	const regex = /(\n)|((?:\|r\|)?(?:.{40,59}[, ]|.{60}))/g;
	const text = tooltip
		.trim()
		.split(regex)
		.map((v, i, a) => {
			if (!v?.trim() || colorPrefix.test(v)) {
				return v;
			}
			for (let j = i - 1; j >= 0; j--) {
				const previous = a[j];
				if (!previous || previous === "\n") {
					return v;
				}
				const match = colorPrefix.exec(previous);
				if (match) {
					return match[0] + v;
				}
			}
			return v;
		})
		.filter((v): v is string => v !== undefined && v.trim() !== "");

	const fontSize = 14;
	let toolTipOffsetX = 10;
	let toolTipOffsetY = 10;
	const marginX = 10;
	const marginY = 10;
	const linePadding = 3;

	backCanvasContext.font = `${fontSize}px sans-serif`;
	backCanvasContext.textAlign = "start";
	let width = max(text.map((t) => backCanvasContext.measureText(t).width)) ?? 0;
	let height = fontSize * text.length + linePadding * (text.length - 1);

	if (cursorX + toolTipOffsetX + width + 2 * marginX > session.canvasWidth) {
		toolTipOffsetX = -10 - (width + 2 * marginX);
	}

	if (cursorY + toolTipOffsetY + height + 2 * marginY > session.canvasHeight) {
		toolTipOffsetY = -10 - (height + 2 * marginY);
	}
	backCanvasContext.strokeStyle = "#7F7F7F";
	backCanvasContext.fillStyle = "white";
	backCanvasContext.textBaseline = "top";

	if (sizeCallback) {
		const result = sizeCallback(width, height);
		width = result.width;
		height = result.height;
	}

	backCanvasContext.fillRect(
		cursorX + toolTipOffsetX,
		cursorY + toolTipOffsetY,
		width + 2 * marginX,
		height + 2 * marginY,
	);
	backCanvasContext.strokeRect(
		cursorX + toolTipOffsetX,
		cursorY + toolTipOffsetY,
		width + 2 * marginX,
		height + 2 * marginY,
	);

	text.forEach((t, i) => {
		backCanvasContext.fillStyle = "black";
		if (t.startsWith("|r|")) {
			backCanvasContext.fillStyle = "red";
			t = t.substring(3);
		}
		t = t.trim();
		backCanvasContext.fillText(
			t,
			cursorX + toolTipOffsetX + marginX,
			cursorY + toolTipOffsetY + marginY + i * (fontSize + linePadding),
		);
	});

	backCanvasContext.fillStyle = "black";
	if (renderCallback) {
		renderCallback(
			cursorX + toolTipOffsetX + marginX,
			cursorY +
				toolTipOffsetY +
				marginY +
				text.length * (fontSize + linePadding),
		);
	}
}

function toCommaDivideNumber(value: number): string {
	return value.toString(10).replace(/(?<!^)(\d{3})(?=(?:\d{3})*$)/g, ",$1");
}
