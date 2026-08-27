import { isEqual } from "lodash";
import { slice } from "../../util/common";
import { MapItemMessage, WorldMapData, WorldMapMessage } from "./definitions";
import { defaultHashItem, diffItemList } from "./worldmapdiff";

type MapItemChange = {
	command: MapItemMessage["command"];
	list: unknown[];
	cachedList: unknown[];
	start: number;
	end: number;
};

const summaryKeys: (keyof WorldMapData)[] = [
	"width",
	"height",
	"provincesCount",
	"statesCount",
	"countriesCount",
	"strategicRegionsCount",
	"supplyAreasCount",
	"railwaysCount",
	"supplyNodesCount",
	"badProvincesCount",
	"badStatesCount",
	"badStrategicRegionsCount",
	"badSupplyAreasCount",
];

export function buildWorldMapChangeMessages(
	cachedWorldMap: WorldMapData,
	worldMap: WorldMapData,
): WorldMapMessage[] | undefined {
	if (summaryKeys.some((key) => !isEqual(cachedWorldMap[key], worldMap[key]))) {
		return undefined;
	}

	const changeMessages: WorldMapMessage[] = [];
	appendSummaryChanges(changeMessages, cachedWorldMap, worldMap);

	const mapItemChanges: MapItemChange[] = [
		{
			command: "provinces",
			list: worldMap.provinces,
			cachedList: cachedWorldMap.provinces,
			start: -worldMap.badProvincesCount,
			end: worldMap.provincesCount,
		},
		{
			command: "states",
			list: worldMap.states,
			cachedList: cachedWorldMap.states,
			start: -worldMap.badStatesCount,
			end: worldMap.statesCount,
		},
		{
			command: "countries",
			list: worldMap.countries,
			cachedList: cachedWorldMap.countries,
			start: 0,
			end: worldMap.countriesCount,
		},
		{
			command: "strategicregions",
			list: worldMap.strategicRegions,
			cachedList: cachedWorldMap.strategicRegions,
			start: -worldMap.badStrategicRegionsCount,
			end: worldMap.strategicRegionsCount,
		},
		{
			command: "supplyareas",
			list: worldMap.supplyAreas,
			cachedList: cachedWorldMap.supplyAreas,
			start: -worldMap.badSupplyAreasCount,
			end: worldMap.supplyAreasCount,
		},
		{
			command: "railways",
			list: worldMap.railways,
			cachedList: cachedWorldMap.railways,
			start: 0,
			end: worldMap.railwaysCount,
		},
		{
			command: "supplynodes",
			list: worldMap.supplyNodes,
			cachedList: cachedWorldMap.supplyNodes,
			start: 0,
			end: worldMap.supplyNodesCount,
		},
	];

	for (const change of mapItemChanges) {
		if (!appendMapItemChanges(changeMessages, change)) {
			return undefined;
		}
	}

	return changeMessages;
}

function appendSummaryChanges(
	changeMessages: WorldMapMessage[],
	cachedWorldMap: WorldMapData,
	worldMap: WorldMapData,
): void {
	const summaryChanges: [
		"warnings" | "continents" | "terrains" | "resources",
		keyof Pick<
			WorldMapData,
			"warnings" | "continents" | "terrains" | "resources"
		>,
	][] = [
		["warnings", "warnings"],
		["continents", "continents"],
		["terrains", "terrains"],
		["resources", "resources"],
	];

	for (const [command, key] of summaryChanges) {
		if (!isEqual(cachedWorldMap[key], worldMap[key])) {
			changeMessages.push({
				command,
				data: JSON.stringify(worldMap[key]),
				start: 0,
				end: 0,
			});
		}
	}
}

function appendMapItemChanges(
	changeMessages: WorldMapMessage[],
	{ command, list, cachedList, start, end }: MapItemChange,
): boolean {
	const ranges = diffItemList(
		list,
		cachedList,
		start,
		end,
		defaultHashItem,
		30 - changeMessages.length,
	);
	if (ranges === undefined) {
		return false;
	}

	for (const range of ranges) {
		changeMessages.push({
			command,
			data: JSON.stringify(slice(list, range.start, range.end)),
			start: range.start,
			end: range.end,
		});
	}

	return true;
}
