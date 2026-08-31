import { State } from "./definitions";
import { FEWorldMap } from "./loader";
import { getColorByColorSet, getHighConstrastColor, toColor } from "./colors";
import { isSupplyVisible, RenderContext } from "./renderContext";

export const resourceImages: Record<string, HTMLImageElement | undefined> = {};

export function renderMapLabels(
	renderContext: RenderContext,
	worldMap: FEWorldMap,
	context: CanvasRenderingContext2D,
	xOffset: number,
) {
	const {
		provinceToState,
		provinceToStrategicRegion,
		stateToSupplyArea,
		topBar,
		viewPoint,
	} = renderContext;
	const renderedProvinces =
		renderContext.renderedProvincesByOffset[xOffset] ?? [];
	const viewMode = topBar.viewMode$.value;
	const colorSet = topBar.colorSet$.value;
	const showSupply = isSupplyVisible(topBar);

	context.font = "10px sans-serif";
	context.textAlign = "center";
	context.textBaseline = "middle";
	if (viewMode === "province" || viewMode === "warnings") {
		for (const province of renderedProvinces) {
			const provinceColor =
				showSupply && worldMap.getSupplyNodeByProvinceId(province.id)
					? 0xff0000
					: getColorByColorSet(colorSet, province, worldMap, renderContext);
			context.fillStyle = toColor(getHighConstrastColor(provinceColor));
			const labelPosition = province.centerOfMass;
			context.fillText(
				province.id.toString(),
				viewPoint.convertX(labelPosition.x + xOffset),
				viewPoint.convertY(labelPosition.y),
			);
		}
	} else {
		const renderedRegions: Record<number, boolean> = {};
		const regionMap =
			viewMode === "state" ? provinceToState : provinceToStrategicRegion;
		const getRegionById =
			viewMode === "state"
				? worldMap.getStateById
				: viewMode === "supplyarea"
					? worldMap.getSupplyAreaById
					: worldMap.getStrategicRegionById;

		for (const province of renderedProvinces) {
			const stateId =
				viewMode === "supplyarea" ? provinceToState[province.id] : undefined;
			const regionId =
				viewMode === "supplyarea"
					? stateId !== undefined
						? stateToSupplyArea[stateId]
						: undefined
					: regionMap[province.id];
			if (regionId !== undefined && !renderedRegions[regionId]) {
				renderedRegions[regionId] = true;
				const region = getRegionById(regionId);
				if (region) {
					const labelPosition = region.centerOfMass;
					const provinceAtLabel = worldMap.getProvinceByPosition(
						labelPosition.x,
						labelPosition.y,
					);
					const provinceColor = getColorByColorSet(
						colorSet,
						provinceAtLabel ?? province,
						worldMap,
						renderContext,
					);
					context.fillStyle = toColor(getHighConstrastColor(provinceColor));
					context.fillText(
						region.id.toString(),
						viewPoint.convertX(labelPosition.x + xOffset),
						viewPoint.convertY(labelPosition.y),
					);
					if (viewMode === "state" && colorSet === "resources") {
						const { width } = getResourcesSize(region as State, 0.7, 16);
						renderResources(
							context,
							region as State,
							viewPoint.convertX(labelPosition.x + xOffset) - width / 2,
							viewPoint.convertY(labelPosition.y) + 5,
							0.7,
							16,
						);
					}
				}
			}
		}
	}
}

export function getResourcesSize(
	state: State,
	scale: number = 1,
	labelWidth: number = 30,
): { width: number; height: number } {
	let fullWidth = 0;
	let maxHeight = 0;
	for (const resource in state.resources) {
		if (!state.resources[resource]) {
			continue;
		}
		const image = resourceImages[resource];
		if (image) {
			maxHeight = Math.max(maxHeight, image.naturalHeight * scale);
			fullWidth += image.naturalWidth * scale;
		} else {
			maxHeight = Math.max(maxHeight, 24 * scale);
			fullWidth += 24 * scale;
		}
		fullWidth += labelWidth;
	}
	return { width: fullWidth, height: maxHeight };
}

export function renderResources(
	context: CanvasRenderingContext2D,
	state: State,
	x: number,
	y: number,
	scale: number = 1,
	labelWidth: number = 30,
) {
	context.textAlign = "center";
	context.textBaseline = "middle";
	for (const resource in state.resources) {
		const resourceNumber = state.resources[resource];
		if (!resourceNumber) {
			continue;
		}

		const image = resourceImages[resource];
		if (image) {
			context.drawImage(
				image,
				x,
				y,
				image.naturalWidth * scale,
				image.naturalHeight * scale,
			);
			context.fillText(
				resourceNumber.toString(),
				x + (image?.naturalWidth ?? 0) * scale + labelWidth / 2,
				y + (Math.max(0, image?.naturalHeight ?? 0) * scale) / 2,
			);
			x += (image?.naturalWidth ?? 0) * scale + labelWidth;
		} else {
			context.fillStyle = "gray";
			context.fillRect(x, y, 24 * scale, 24 * scale);
			context.fillText(
				resourceNumber.toString(),
				x + 24 * scale + labelWidth / 2,
				y + (24 * scale) / 2,
			);
			x += 24 * scale + labelWidth;
		}
	}
}
