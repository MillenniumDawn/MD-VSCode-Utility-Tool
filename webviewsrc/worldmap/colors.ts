import { Province, Terrain } from "./definitions";
import { arrayToMap } from "../util/common";
import { FEWorldMap } from "./loader";
import { ColorSet } from "./topbar";
import { RenderContext } from "./renderContext";

export const landWarning = 0xe02020;
export const landNoWarning = 0x7fff7f;
export const waterWarning = 0xc00000;
export const waterNoWarning = 0x20e020;

export function toColor(colorNum: number) {
	return "#" + colorNum.toString(16).padStart(6, "0");
}

export function getColorByColorSet(
	colorSet: ColorSet,
	province: Province,
	worldMap: FEWorldMap,
	renderContext: RenderContext,
): number {
	const {
		provinceToState,
		provinceToStrategicRegion,
		stateToSupplyArea,
		topBar,
	} = renderContext;
	switch (colorSet) {
		case "provincetype":
			return (
				(province.type === "land"
					? 0x007f00
					: province.type === "lake"
						? 0x00ffff
						: 0x00007f) | (province.coastal ? 0x7f0000 : 0)
			);
		case "country": {
			const stateId = provinceToState[province.id];
			return (
				worldMap.countries.find(
					(c) => c && c.tag === worldMap.getStateById(stateId)?.owner,
				)?.color ?? defaultColor(province)
			);
		}
		case "terrain": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = arrayToMap(worldMap.terrains, "name");
			}

			const navalTerrain =
				province.type === "land"
					? undefined
					: worldMap.getStrategicRegionById(
							provinceToStrategicRegion[province.id],
						)?.navalTerrain;
			return (
				(renderContext.extraState as Record<string, Terrain | undefined>)[
					navalTerrain ?? province.terrain
				]?.color ?? 0
			);
		}
		case "continent": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = avoidPowerOf2(
					highestContinent(worldMap) + 1,
				);
			}
			return province.continent !== 0
				? valueAndMaxToColor(province.continent + 1, renderContext.extraState)
				: defaultColor(province);
		}
		case "stateid": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = avoidPowerOf2(worldMap.statesCount);
			}
			const stateId = provinceToState[province.id];
			return stateId !== undefined
				? valueAndMaxToColor(
						stateId < 0 ? 0 : stateId,
						renderContext.extraState,
					)
				: defaultColor(province);
		}
		case "warnings": {
			const isLand = province.type === "land";
			const viewMode = topBar.viewMode$.value;
			const warningFilter = topBar.warningFilter.selectedValues$.value;
			const stateId = provinceToState[province.id];
			const state = worldMap.getStateById(stateId);
			const strategicRegion = worldMap.getStrategicRegionById(
				provinceToStrategicRegion[province.id],
			);
			const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
			const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
			return worldMap.getProvinceWarnings(
				viewMode !== "warnings" || warningFilter.includes("province")
					? province
					: undefined,
				viewMode !== "warnings" || warningFilter.includes("state")
					? state
					: undefined,
				viewMode !== "warnings" || warningFilter.includes("strategicregion")
					? strategicRegion
					: undefined,
				viewMode !== "warnings" || warningFilter.includes("supplyarea")
					? supplyArea
					: undefined,
			).length > 0
				? isLand
					? landWarning
					: waterWarning
				: isLand
					? landNoWarning
					: waterNoWarning;
		}
		case "manpower": {
			if (province.type === "sea") {
				return defaultColor(province);
			}

			if (renderContext.extraState === undefined) {
				renderContext.extraState = highestManpower(worldMap);
			}

			const stateId = provinceToState[province.id];
			const state = worldMap.getStateById(stateId);
			const value =
				manpowerHandler(state?.manpower ?? 0) /
				manpowerHandler(renderContext.extraState);
			return valueToColorGYR(value);
		}
		case "victorypoint": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = highestVictoryPoint(worldMap);
			}

			const stateId = provinceToState[province.id];
			const state = worldMap.getStateById(stateId);
			const value =
				victoryPointsHandler(
					state ? (state.victoryPoints[province.id] ?? 0.1) : 0,
				) / victoryPointsHandler(renderContext.extraState);
			return valueToColorGreyScale(value);
		}
		case "resources": {
			if (province.type === "sea") {
				return defaultColor(province);
			}

			if (renderContext.extraState === undefined) {
				renderContext.extraState = highestResources(worldMap);
			}

			const stateId = provinceToState[province.id];
			const state = worldMap.getStateById(stateId);
			const numResources = state
				? Object.values(state.resources).reduce<number>(
						(p, c) => p + (c ?? 0),
						0,
					)
				: 0;
			const value =
				resourcesHandler(numResources) /
				resourcesHandler(renderContext.extraState);
			return valueToColorGYR(value);
		}
		case "strategicregionid": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = avoidPowerOf2(
					worldMap.strategicRegionsCount,
				);
			}
			const strategicRegionId = provinceToStrategicRegion[province.id];
			return valueAndMaxToColor(
				strategicRegionId === undefined || strategicRegionId < 0
					? 0
					: strategicRegionId,
				renderContext.extraState,
			);
		}
		case "supplyareaid": {
			if (renderContext.extraState === undefined) {
				renderContext.extraState = avoidPowerOf2(worldMap.supplyAreasCount);
			}
			const stateId = provinceToState[province.id];
			const supplyAreaId =
				stateId !== undefined ? stateToSupplyArea[stateId] : undefined;
			return supplyAreaId !== undefined
				? valueAndMaxToColor(
						supplyAreaId < 0 ? 0 : supplyAreaId,
						renderContext.extraState,
					)
				: defaultColor(province);
		}
		case "supplyvalue": {
			if (province.type === "sea") {
				return defaultColor(province);
			}

			if (renderContext.extraState === undefined) {
				renderContext.extraState = highestSupplyValue(worldMap);
			}

			const stateId = provinceToState[province.id];
			const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
			const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
			const value = (supplyArea?.value ?? 0) / renderContext.extraState;
			return valueToColorGYR(value);
		}
		default:
			return province.color;
	}
}

export function getHighConstrastColor(color: number): number {
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	return r * 0.7 + g * 2 + b * 0.3 > 3 * 0x7f ? 0 : 0xffffff;
}

function highestContinent(worldMap: FEWorldMap): number {
	let continent = 0;
	worldMap.forEachProvince(
		(p) => (p.continent > continent ? (continent = p.continent) : 0, false),
	);
	return continent;
}

function highestManpower(worldMap: FEWorldMap): number {
	let result = 0;
	worldMap.forEachState(
		(state) => (
			state.manpower > result ? (result = state.manpower) : 0, false
		),
	);
	return result;
}

function highestVictoryPoint(worldMap: FEWorldMap): number {
	let result = 0;
	worldMap.forEachState((state) =>
		Object.values(state.victoryPoints).forEach((vp) =>
			vp !== undefined && vp > result ? (result = vp) : 0,
		),
	);
	return result;
}

function highestResources(worldMap: FEWorldMap): number {
	let result = 0;
	worldMap.forEachState((state) => {
		const numResources = Object.values(state.resources).reduce<number>(
			(p, c) => p + (c ?? 0),
			0,
		);
		if (numResources > result) {
			result = numResources;
		}
		return false;
	});
	return result;
}

function highestSupplyValue(worldMap: FEWorldMap): number {
	let result = 0;
	worldMap.forEachSupplyArea(
		(supplyArea) => (
			supplyArea.value > result ? (result = supplyArea.value) : 0, false
		),
	);
	return result;
}

function manpowerHandler(manpower: number): number {
	if (manpower < 0) {
		manpower = 0;
	}
	return Math.pow(manpower, 0.2);
}

function victoryPointsHandler(victoryPoints: number): number {
	if (victoryPoints < 0) {
		victoryPoints = 0;
	}
	return Math.pow(victoryPoints, 0.5);
}

function resourcesHandler(resources: number): number {
	if (resources < 0) {
		resources = 0;
	}
	return Math.pow(resources, 0.2);
}

function valueToColorGYR(value: number): number {
	return value < 0.5
		? 0xff00 | (Math.floor(255 * 2 * value) << 16)
		: 0xff0000 | (Math.floor(255 * 2 * (1 - value)) << 8);
}

function valueToColorGreyScale(value: number): number {
	return Math.floor(value * 255) * 0x10101;
}

function valueAndMaxToColor(value: number, max: number): number {
	return Math.floor(value * (0xffffff / max));
}

function avoidPowerOf2(value: number): number {
	const v = Math.log2(value);
	if (v > 0 && v >>> 0 === v) {
		return value + 1;
	}

	return value;
}

function defaultColor(province: Province) {
	return province.type === "land" ? 0 : 0x1010b0;
}
