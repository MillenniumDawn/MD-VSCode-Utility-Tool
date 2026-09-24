import {
	WorldMapMessage,
	Province,
	WorldMapData,
	MapItemMessage,
	RequestMapItemMessage,
	State,
	Country,
	Point,
} from "./definitions";
import { copyArray } from "../util/common";
import { inBBox } from "./graphutils";
import { Subscriber } from "../util/event";
import {
	WorldMapWarning,
	Terrain,
	StrategicRegion,
	SupplyArea,
	Railway,
	SupplyNode,
	Resource,
	River,
} from "../../src/previewdef/worldmap/definitions";
import { vscode } from "../util/vscode";
import {
	BehaviorSubject,
	fromEvent,
	Observable,
	ObservedValueOf,
	Subject,
} from "rxjs";

interface ExtraMapData {
	provincesCount: number;
	statesCount: number;
	countriesCount: number;
	railwaysCount: number;
	supplyNodesCount: number;
}

// Warning indices into `warnings`, bucketed by source. Each bucket is ascending and holds a
// warning at most once, so merging buckets only has to dedupe across them.
type WarningBuckets = Record<number, number[] | undefined>;
interface WarningIndex {
	provinceId: WarningBuckets;
	provinceColor: WarningBuckets;
	state: WarningBuckets;
	strategicRegion: WarningBuckets;
	supplyArea: WarningBuckets;
	river: WarningBuckets;
}

// Uniform grid over the provinces' bounding boxes, in map coordinates. Each cell lists the
// provinces whose bounding box overlaps it, in forEachProvince order so that the first match
// is the same province a full scan would have returned.
interface ProvinceGrid {
	originX: number;
	originY: number;
	cellSize: number;
	cols: number;
	rows: number;
	cells: (Province[] | undefined)[];
}

const provinceGridCellSize = 64;

interface FEWorldMapClassExtra {
	getProvinceById(provinceId: number | undefined): Province | undefined;
	getStateById(stateId: number | undefined): State | undefined;
	getStrategicRegionById(
		strategicRegionId: number | undefined,
	): StrategicRegion | undefined;
	getSupplyAreaById(supplyAreaId: number | undefined): SupplyArea | undefined;

	getStateByProvinceId(provinceId: number): State | undefined;
	getProvinceToStateMap(): Record<number, number | undefined>;

	getStrategicRegionByProvinceId(
		provinceId: number,
	): StrategicRegion | undefined;
	getProvinceToStrategicRegionMap(): Record<number, number | undefined>;

	getSupplyAreaByStateId(stateId: number): SupplyArea | undefined;
	getStateToSupplyAreaMap(): Record<number, number | undefined>;

	getRailwayLevelByProvinceId(provinceId: number): number | undefined;

	getSupplyNodeByProvinceId(provinceId: number): SupplyNode | undefined;

	forEachRailwayTouching(
		provinces: Province[],
		callback: (railway: Railway) => void,
	): void;
	getSupplyAreaProvinces(
		supplyAreaId: number | undefined,
	): { provinces: number[] } | undefined;

	getProvinceByPosition(x: number, y: number): Province | undefined;

	getProvinceWarnings(
		province?: Province,
		state?: State,
		strategicRegion?: StrategicRegion,
		supplyArea?: SupplyArea,
	): string[];
	hasProvinceWarnings(
		province?: Province,
		state?: State,
		strategicRegion?: StrategicRegion,
		supplyArea?: SupplyArea,
	): boolean;
	getStateWarnings(state: State, supplyArea?: SupplyArea): string[];
	getStrategicRegionWarnings(strategicRegion: StrategicRegion): string[];
	getSupplyAreaWarnings(supplyArea: SupplyArea): string[];
	getRiverWarnings(riverIndex: number): string[];
	hasRiverWarnings(riverIndex: number): boolean;

	forEachProvince(callback: (province: Province) => boolean | void): void;
	forEachState(callback: (state: State) => boolean | void): void;
	forEachStrategicRegion(
		callback: (strategicRegion: StrategicRegion) => boolean | void,
	): void;
	forEachSupplyArea(callback: (supplyArea: SupplyArea) => boolean | void): void;
	forEachRailway(callback: (railway: Railway) => boolean | void): void;
	forEachSupplyNode(callback: (supplyNode: SupplyNode) => boolean | void): void;
}

export type FEWorldMap = Omit<
	WorldMapData,
	| "states"
	| "provinces"
	| "strategicRegions"
	| "supplyAreas"
	| "railways"
	| "supplyNodes"
> &
	ExtraMapData &
	FEWorldMapClassExtra;

export class Loader extends Subscriber {
	public worldMap: FEWorldMapClass;
	public loading$ = new BehaviorSubject<boolean>(false);
	public progress: number = 0;
	public progressText: string = "";

	private writableWorldMap$ = new Subject<FEWorldMap>();
	public worldMap$: Observable<FEWorldMap> = this.writableWorldMap$;

	private writableProgress$ = new BehaviorSubject({
		progress: 0,
		progressText: "",
	});
	public progress$: Observable<ObservedValueOf<Loader["writableProgress$"]>> =
		this.writableProgress$;

	private loadingProvinceMap:
		| (WorldMapData & {
				provincesCount: number;
				statesCount: number;
				countriesCount: number;
		  })
		| undefined;
	private loadingQueue: WorldMapMessage[] = [];
	private loadingQueueStartLength = 0;

	constructor() {
		super();
		this.worldMap = new FEWorldMapClass();
		this.addSubscription({ dispose: () => this.cancelPendingEmit() });
		this.load();
		this.worldMap$.subscribe((wm) => {
			(window as Window & { worldMap?: FEWorldMap }).worldMap = wm;
		});
	}

	public refresh() {
		this.cancelPendingEmit();
		this.worldMap = new FEWorldMapClass();
		this.writableWorldMap$.next(this.worldMap);
		vscode.postMessage({ command: "loaded", force: true } as WorldMapMessage);
		this.loading$.next(true);
	}

	private load() {
		this.addSubscription(
			fromEvent<MessageEvent>(window, "message").subscribe((event) => {
				const message = event.data as WorldMapMessage;
				switch (message.command) {
					case "provincemapsummary":
						this.loadingProvinceMap = { ...message.data };
						this.loadingProvinceMap.provinces = new Array(
							this.loadingProvinceMap.provincesCount,
						);
						this.loadingProvinceMap.states = new Array(
							this.loadingProvinceMap.statesCount,
						);
						this.loadingProvinceMap.countries = new Array(
							this.loadingProvinceMap.countriesCount,
						);
						this.loadingProvinceMap.strategicRegions = new Array(
							this.loadingProvinceMap.strategicRegionsCount,
						);
						this.startLoading();
						break;
					case "provinces":
					case "states":
					case "countries":
					case "strategicregions":
					case "supplyareas":
					case "railways":
					case "supplynodes":
						this.receiveRequestedData(message);
						break;
					case "warnings":
						if (this.loadingProvinceMap) {
							try {
								this.loadingProvinceMap.warnings = JSON.parse(message.data);
							} catch (e) {
								console.error(e);
							}
							this.loadNext();
						}
						break;
					case "continents":
						if (this.loadingProvinceMap) {
							try {
								this.loadingProvinceMap.continents = JSON.parse(message.data);
							} catch (e) {
								console.error(e);
							}
							this.loadNext();
						}
						break;
					case "terrains":
						if (this.loadingProvinceMap) {
							try {
								this.loadingProvinceMap.terrains = JSON.parse(message.data);
							} catch (e) {
								console.error(e);
							}
							this.loadNext();
						}
						break;
					case "resources":
						if (this.loadingProvinceMap) {
							try {
								this.loadingProvinceMap.resources = JSON.parse(message.data);
							} catch (e) {
								console.error(e);
							}
							this.loadNext();
						}
						break;
					case "progress":
						this.progressText = message.data;
						this.writableProgress$.next({
							progressText: this.progressText,
							progress: this.progress,
						});
						break;
					case "error":
						this.progressText = message.data;
						this.writableProgress$.next({
							progressText: this.progressText,
							progress: this.progress,
						});
						this.loading$.next(false);
						break;
					default:
						break;
				}
			}),
		);

		vscode.postMessage({ command: "loaded", force: false } as WorldMapMessage);
		this.loading$.next(true);
	}

	private startLoading() {
		if (!this.loadingProvinceMap) {
			return;
		}

		this.loadingQueue.length = 0;

		this.queueLoadingRequest(
			"requestcountries",
			this.loadingProvinceMap.countriesCount,
			750,
		);
		this.queueLoadingRequest(
			"requeststrategicregions",
			this.loadingProvinceMap.strategicRegionsCount,
			750,
		);
		this.queueLoadingRequest(
			"requeststrategicregions",
			this.loadingProvinceMap.badStrategicRegionsCount,
			750,
			-this.loadingProvinceMap.badStrategicRegionsCount,
		);
		this.queueLoadingRequest(
			"requestsupplyareas",
			this.loadingProvinceMap.supplyAreasCount,
			750,
		);
		this.queueLoadingRequest(
			"requestsupplyareas",
			this.loadingProvinceMap.badSupplyAreasCount,
			750,
			-this.loadingProvinceMap.badSupplyAreasCount,
		);
		this.queueLoadingRequest(
			"requeststates",
			this.loadingProvinceMap.statesCount,
			750,
		);
		this.queueLoadingRequest(
			"requeststates",
			this.loadingProvinceMap.badStatesCount,
			750,
			-this.loadingProvinceMap.badStatesCount,
		);
		this.queueLoadingRequest(
			"requestprovinces",
			this.loadingProvinceMap.provincesCount,
			750,
		);
		this.queueLoadingRequest(
			"requestprovinces",
			this.loadingProvinceMap.badProvincesCount,
			750,
			-this.loadingProvinceMap.badProvincesCount,
		);
		this.queueLoadingRequest(
			"requestrailways",
			this.loadingProvinceMap.railwaysCount,
			2500,
		);
		this.queueLoadingRequest(
			"requestsupplynodes",
			this.loadingProvinceMap.supplyNodesCount,
			5000,
		);

		this.loadingQueueStartLength = this.loadingQueue.length;
		this.progressText = "";
		this.loadNext();
	}

	private queueLoadingRequest<C extends RequestMapItemMessage["command"]>(
		command: C,
		count: number,
		step: number,
		offset: number = 0,
	) {
		for (let i = offset, j = 0; j < count; i += step, j += step) {
			this.loadingQueue.push({
				command,
				start: i,
				end: Math.min(i + step, offset + count),
			});
		}
	}

	private loadNext() {
		this.progress = 1 - this.loadingQueue.length / this.loadingQueueStartLength;

		if (this.loadingQueue.length === 0) {
			// Final emit is synchronous against the now-complete arrays: guarantees the last frame is
			// never a partial one, and the finished map does not wait out the throttle.
			this.emitWorldMap();
			this.loading$.next(false);
		} else {
			// Keep the request pump immediate; only the map emit is throttled.
			vscode.postMessage(this.loadingQueue.shift());
			this.scheduleWorldMapEmit();
		}

		this.writableProgress$.next({
			progressText: this.progressText,
			progress: this.progress,
		});
	}

	// Every emit is a new FEWorldMapClass, so the renderer rebuilds its reverse maps and redraws the
	// whole map; mid-load that is paid a few times a second rather than once per frame.
	private static readonly midLoadEmitIntervalMs = 250;
	private lastEmitTime = 0;
	private pendingEmitTimer: ReturnType<typeof setTimeout> | undefined;
	private scheduleWorldMapEmit(): void {
		if (this.pendingEmitTimer !== undefined) {
			return;
		}
		const delay = Math.max(
			0,
			this.lastEmitTime + Loader.midLoadEmitIntervalMs - performance.now(),
		);
		this.pendingEmitTimer = setTimeout(() => this.emitWorldMap(), delay);
	}

	private cancelPendingEmit(): void {
		if (this.pendingEmitTimer !== undefined) {
			clearTimeout(this.pendingEmitTimer);
			this.pendingEmitTimer = undefined;
		}
	}

	private emitWorldMap(): void {
		this.cancelPendingEmit();
		this.lastEmitTime = performance.now();
		if (!this.loadingProvinceMap) {
			return;
		}

		this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
		this.writableWorldMap$.next(this.worldMap);
	}

	private receiveRequestedData(message: MapItemMessage): void {
		let arr: unknown[] | undefined;
		switch (message.command) {
			case "provinces":
				arr = this.loadingProvinceMap?.provinces;
				break;
			case "states":
				arr = this.loadingProvinceMap?.states;
				break;
			case "countries":
				arr = this.loadingProvinceMap?.countries;
				break;
			case "strategicregions":
				arr = this.loadingProvinceMap?.strategicRegions;
				break;
			case "supplyareas":
				arr = this.loadingProvinceMap?.supplyAreas;
				break;
			case "railways":
				arr = this.loadingProvinceMap?.railways;
				break;
			case "supplynodes":
				arr = this.loadingProvinceMap?.supplyNodes;
				break;
			default:
				return;
		}

		this.receiveData(arr, message.start, message.end, message.data);
		this.loadNext();
	}

	private receiveData<T>(
		arr: T[] | undefined,
		start: number,
		end: number,
		data: string,
	): void {
		if (arr) {
			try {
				copyArray(JSON.parse(data), arr, 0, start, end - start);
			} catch (e) {
				console.error(e);
			}
		}
	}
}

export class FEWorldMapClass implements FEWorldMap {
	width!: number;
	height!: number;
	countries!: Country[];
	warnings!: WorldMapWarning[];
	provincesCount!: number;
	statesCount!: number;
	countriesCount!: number;
	strategicRegionsCount!: number;
	supplyAreasCount!: number;
	railwaysCount!: number;
	supplyNodesCount!: number;
	badProvincesCount!: number;
	badStatesCount!: number;
	badStrategicRegionsCount!: number;
	badSupplyAreasCount!: number;
	continents!: string[];
	terrains!: Terrain[];
	resources!: Resource[];
	rivers!: River[];

	private provinces!: (Province | null | undefined)[];
	private states!: (State | null | undefined)[];
	private strategicRegions!: (StrategicRegion | null | undefined)[];
	private supplyAreas!: (SupplyArea | null | undefined)[];
	private railways!: (Railway | null | undefined)[];
	private supplyNodes!: (SupplyNode | null | undefined)[];

	// Reverse-lookup maps, memoized per instance. Lifetime is strictly this instance: the loader
	// builds a fresh FEWorldMapClass per emit, so a memo built mid-load is discarded next emit and
	// the final post-load instance memoizes against complete arrays.
	private provinceToStateMemo: Record<number, number | undefined> | undefined =
		undefined;
	private provinceToStrategicRegionMemo:
		| Record<number, number | undefined>
		| undefined = undefined;
	private stateToSupplyAreaMemo:
		| Record<number, number | undefined>
		| undefined = undefined;
	private provinceToRailwayLevelMemo:
		| Record<number, number | undefined>
		| undefined = undefined;
	private provinceToSupplyNodeMemo:
		| Record<number, SupplyNode | undefined>
		| undefined = undefined;
	private provinceToRailwayIndicesMemo:
		| Record<number, number[] | undefined>
		| undefined = undefined;
	private supplyAreaToProvincesMemo:
		| Record<number, { provinces: number[] } | undefined>
		| undefined = undefined;
	private provinceGridMemo: ProvinceGrid | undefined = undefined;
	private warningIndexMemo: WarningIndex | undefined = undefined;

	constructor(worldMap?: WorldMapData & ExtraMapData) {
		Object.assign(
			this,
			worldMap ??
				({
					width: 0,
					height: 0,
					provinces: [],
					states: [],
					countries: [],
					warnings: [],
					continents: [],
					strategicRegions: [],
					supplyAreas: [],
					terrains: [],
					railways: [],
					supplyNodes: [],
					resources: [],
					rivers: [],
					provincesCount: 0,
					statesCount: 0,
					countriesCount: 0,
					strategicRegionsCount: 0,
					supplyAreasCount: 0,
					badProvincesCount: 0,
					badStatesCount: 0,
					badStrategicRegionsCount: 0,
					badSupplyAreasCount: 0,
					railwaysCount: 0,
					supplyNodesCount: 0,
				} as WorldMapData & ExtraMapData),
		);
	}

	public getProvinceById = (
		provinceId: number | undefined,
	): Province | undefined => {
		return provinceId ? (this.provinces[provinceId] ?? undefined) : undefined;
	};

	public getStateById = (stateId: number | undefined): State | undefined => {
		return stateId ? (this.states[stateId] ?? undefined) : undefined;
	};

	public getStrategicRegionById = (
		strategicRegionId: number | undefined,
	): StrategicRegion | undefined => {
		return strategicRegionId
			? (this.strategicRegions[strategicRegionId] ?? undefined)
			: undefined;
	};

	public getSupplyAreaById = (
		supplyAreaId: number | undefined,
	): SupplyArea | undefined => {
		return supplyAreaId
			? (this.supplyAreas[supplyAreaId] ?? undefined)
			: undefined;
	};

	public getStateByProvinceId(provinceId: number): State | undefined {
		return this.getStateById(this.getProvinceToStateMap()[provinceId]);
	}

	public getStrategicRegionByProvinceId(
		provinceId: number,
	): StrategicRegion | undefined {
		return this.getStrategicRegionById(
			this.getProvinceToStrategicRegionMap()[provinceId],
		);
	}

	public getSupplyAreaByStateId(stateId: number): SupplyArea | undefined {
		return this.getSupplyAreaById(this.getStateToSupplyAreaMap()[stateId]);
	}

	public getRailwayLevelByProvinceId(provinceId: number): number | undefined {
		if (this.provinceToRailwayLevelMemo === undefined) {
			const result: Record<number, number | undefined> = {};
			this.forEachRailway((railway) =>
				railway.provinces.forEach((p) => {
					const existing = result[p];
					result[p] =
						existing === undefined
							? railway.level
							: Math.max(existing, railway.level);
				}),
			);
			this.provinceToRailwayLevelMemo = result;
		}
		return this.provinceToRailwayLevelMemo[provinceId];
	}

	public getSupplyNodeByProvinceId(provinceId: number): SupplyNode | undefined {
		if (this.provinceToSupplyNodeMemo === undefined) {
			const result: Record<number, SupplyNode | undefined> = {};
			this.forEachSupplyNode((supplyNode) => {
				if (result[supplyNode.province] === undefined) {
					result[supplyNode.province] = supplyNode;
				}
			});
			this.provinceToSupplyNodeMemo = result;
		}
		return this.provinceToSupplyNodeMemo[provinceId];
	}

	/**
	 * The railways that touch any of the given provinces, in the mod's own order. The render pass
	 * used to walk every railway in the file once per visible world-wrap copy just to reject the
	 * ones off screen; this answers the same question from the provinces already drawn.
	 */
	public forEachRailwayTouching(
		provinces: Province[],
		callback: (railway: Railway) => void,
	): void {
		if (this.provinceToRailwayIndicesMemo === undefined) {
			const result: Record<number, number[] | undefined> = {};
			const count = this.railwaysCount;
			for (let i = 0; i < count; i++) {
				const railway = this.railways[i];
				if (!railway) {
					continue;
				}
				for (const provinceId of railway.provinces) {
					(result[provinceId] ??= []).push(i);
				}
			}
			this.provinceToRailwayIndicesMemo = result;
		}

		const indices = new Set<number>();
		for (const province of provinces) {
			const touching = this.provinceToRailwayIndicesMemo[province.id];
			if (touching !== undefined) {
				for (const index of touching) {
					indices.add(index);
				}
			}
		}

		// Sorted, because the draw order has to stay the file's, not the order the visible
		// provinces happened to be visited in.
		for (const index of [...indices].sort((a, b) => a - b)) {
			const railway = this.railways[index];
			if (railway) {
				callback(railway);
			}
		}
	}

	/**
	 * A supply area's provinces, as one object per area that stays the same across renders. The
	 * identity matters: the hover pass skips the highlight when the hovered and selected objects
	 * are the same one, and a freshly built list defeated that every frame.
	 */
	public getSupplyAreaProvinces(
		supplyAreaId: number | undefined,
	): { provinces: number[] } | undefined {
		const supplyArea = this.getSupplyAreaById(supplyAreaId);
		if (!supplyArea) {
			return undefined;
		}

		if (this.supplyAreaToProvincesMemo === undefined) {
			this.supplyAreaToProvincesMemo = {};
		}

		const cached = this.supplyAreaToProvincesMemo[supplyArea.id];
		if (cached !== undefined) {
			return cached;
		}

		const provinces = supplyArea.states.flatMap(
			(stateId) => this.getStateById(stateId)?.provinces ?? [],
		);
		const result = { provinces };
		this.supplyAreaToProvincesMemo[supplyArea.id] = result;
		return result;
	}

	public getProvinceByPosition(x: number, y: number): Province | undefined {
		const grid = this.getProvinceGrid();
		const col = Math.floor((x - grid.originX) / grid.cellSize);
		const row = Math.floor((y - grid.originY) / grid.cellSize);
		if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) {
			return undefined;
		}
		const candidates = grid.cells[row * grid.cols + col];
		if (candidates === undefined) {
			return undefined;
		}
		const point: Point = { x, y };
		for (const province of candidates) {
			if (
				inBBox(point, province.boundingBox) &&
				province.coverZones.some((z) => inBBox(point, z))
			) {
				return province;
			}
		}
		return undefined;
	}

	private getProvinceGrid(): ProvinceGrid {
		if (this.provinceGridMemo === undefined) {
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			this.forEachProvince((province) => {
				const bbox = province.boundingBox;
				minX = Math.min(minX, bbox.x);
				minY = Math.min(minY, bbox.y);
				maxX = Math.max(maxX, bbox.x + bbox.w);
				maxY = Math.max(maxY, bbox.y + bbox.h);
			});

			const cellSize = provinceGridCellSize;
			const grid: ProvinceGrid =
				minX < maxX && minY < maxY
					? {
							originX: minX,
							originY: minY,
							cellSize,
							cols: Math.ceil((maxX - minX) / cellSize),
							rows: Math.ceil((maxY - minY) / cellSize),
							cells: [],
						}
					: { originX: 0, originY: 0, cellSize, cols: 0, rows: 0, cells: [] };

			this.forEachProvince((province) => {
				const bbox = province.boundingBox;
				const colStart = Math.floor((bbox.x - grid.originX) / cellSize);
				const rowStart = Math.floor((bbox.y - grid.originY) / cellSize);
				// The far edge is exclusive in inBBox, so a box ending exactly on a cell boundary
				// does not reach the next cell.
				const colEnd = Math.min(
					grid.cols - 1,
					Math.ceil((bbox.x + bbox.w - grid.originX) / cellSize) - 1,
				);
				const rowEnd = Math.min(
					grid.rows - 1,
					Math.ceil((bbox.y + bbox.h - grid.originY) / cellSize) - 1,
				);
				for (let row = rowStart; row <= rowEnd; row++) {
					for (let col = colStart; col <= colEnd; col++) {
						const index = row * grid.cols + col;
						(grid.cells[index] ??= []).push(province);
					}
				}
			});

			this.provinceGridMemo = grid;
		}
		return this.provinceGridMemo;
	}

	public getProvinceToStateMap(): Record<number, number | undefined> {
		if (this.provinceToStateMemo === undefined) {
			const result: Record<number, number | undefined> = {};
			this.forEachState((state) =>
				state.provinces.forEach((p) => {
					result[p] = state.id;
				}),
			);
			this.provinceToStateMemo = result;
		}
		return this.provinceToStateMemo;
	}

	public getProvinceToStrategicRegionMap(): Record<number, number | undefined> {
		if (this.provinceToStrategicRegionMemo === undefined) {
			const result: Record<number, number | undefined> = {};
			this.forEachStrategicRegion((strategicRegion) =>
				strategicRegion.provinces.forEach((p) => {
					result[p] = strategicRegion.id;
				}),
			);
			this.provinceToStrategicRegionMemo = result;
		}
		return this.provinceToStrategicRegionMemo;
	}

	public getStateToSupplyAreaMap(): Record<number, number | undefined> {
		if (this.stateToSupplyAreaMemo === undefined) {
			const result: Record<number, number | undefined> = {};
			this.forEachSupplyArea((supplyArea) =>
				supplyArea.states.forEach((s) => {
					result[s] = supplyArea.id;
				}),
			);
			this.stateToSupplyAreaMemo = result;
		}
		return this.stateToSupplyAreaMemo;
	}

	public forEachProvince(callback: (province: Province) => boolean | void) {
		const count = this.provincesCount;
		for (let i = -this.badProvincesCount; i < count; i++) {
			const province = this.provinces[i];
			if (province && callback(province)) {
				break;
			}
		}
	}

	public forEachState(callback: (state: State) => boolean | void) {
		const count = this.statesCount;
		for (let i = -this.badStatesCount; i < count; i++) {
			const state = this.states[i];
			if (state && callback(state)) {
				break;
			}
		}
	}

	public forEachStrategicRegion(
		callback: (strategicRegion: StrategicRegion) => boolean | void,
	): void {
		const count = this.strategicRegionsCount;
		for (let i = -this.badStrategicRegionsCount; i < count; i++) {
			const strategicRegion = this.strategicRegions[i];
			if (strategicRegion && callback(strategicRegion)) {
				break;
			}
		}
	}

	public forEachSupplyArea(
		callback: (supplyArea: SupplyArea) => boolean | void,
	): void {
		const count = this.supplyAreasCount;
		for (let i = -this.badSupplyAreasCount; i < count; i++) {
			const supplyArea = this.supplyAreas[i];
			if (supplyArea && callback(supplyArea)) {
				break;
			}
		}
	}

	public forEachRailway(callback: (railway: Railway) => boolean | void): void {
		const count = this.railwaysCount;
		for (let i = 0; i < count; i++) {
			const railway = this.railways[i];
			if (railway && callback(railway)) {
				break;
			}
		}
	}

	public forEachSupplyNode(
		callback: (supplyNode: SupplyNode) => boolean | void,
	): void {
		const count = this.supplyNodesCount;
		for (let i = 0; i < count; i++) {
			const supplyNode = this.supplyNodes[i];
			if (supplyNode && callback(supplyNode)) {
				break;
			}
		}
	}

	private getWarningIndex(): WarningIndex {
		if (this.warningIndexMemo === undefined) {
			const index: WarningIndex = {
				provinceId: {},
				provinceColor: {},
				state: {},
				strategicRegion: {},
				supplyArea: {},
				river: {},
			};
			const add = (buckets: WarningBuckets, key: number, i: number) => {
				const bucket = (buckets[key] ??= []);
				if (bucket[bucket.length - 1] !== i) {
					bucket.push(i);
				}
			};
			this.warnings.forEach((warning, i) => {
				for (const source of warning.source) {
					switch (source.type) {
						case "province":
							if (source.id !== null) {
								add(index.provinceId, source.id, i);
							}
							add(index.provinceColor, source.color, i);
							break;
						case "state":
							add(index.state, source.id, i);
							break;
						case "strategicregion":
							add(index.strategicRegion, source.id, i);
							break;
						case "supplyarea":
							add(index.supplyArea, source.id, i);
							break;
						case "river":
							add(index.river, source.index, i);
							break;
						default:
							break;
					}
				}
			});
			this.warningIndexMemo = index;
		}
		return this.warningIndexMemo;
	}

	private collectWarningTexts(
		bucket1?: number[],
		bucket2?: number[],
		bucket3?: number[],
		bucket4?: number[],
		bucket5?: number[],
	): string[] {
		let offset1 = 0;
		let offset2 = 0;
		let offset3 = 0;
		let offset4 = 0;
		let offset5 = 0;
		let current1 = bucket1?.[0] ?? Infinity;
		let current2 = bucket2?.[0] ?? Infinity;
		let current3 = bucket3?.[0] ?? Infinity;
		let current4 = bucket4?.[0] ?? Infinity;
		let current5 = bucket5?.[0] ?? Infinity;
		let previous: number | undefined;
		const texts: string[] = [];

		while (
			current1 !== Infinity ||
			current2 !== Infinity ||
			current3 !== Infinity ||
			current4 !== Infinity ||
			current5 !== Infinity
		) {
			let index = current1;
			if (current2 < index) {
				index = current2;
			}
			if (current3 < index) {
				index = current3;
			}
			if (current4 < index) {
				index = current4;
			}
			if (current5 < index) {
				index = current5;
			}

			if (index !== previous) {
				texts.push(this.warnings[index]?.text ?? "");
				previous = index;
			}

			if (current1 === index) {
				current1 = bucket1?.[++offset1] ?? Infinity;
			}
			if (current2 === index) {
				current2 = bucket2?.[++offset2] ?? Infinity;
			}
			if (current3 === index) {
				current3 = bucket3?.[++offset3] ?? Infinity;
			}
			if (current4 === index) {
				current4 = bucket4?.[++offset4] ?? Infinity;
			}
			if (current5 === index) {
				current5 = bucket5?.[++offset5] ?? Infinity;
			}
		}
		return texts;
	}

	public getProvinceWarnings(
		province?: Province,
		state?: State,
		strategicRegion?: StrategicRegion,
		supplyArea?: SupplyArea,
	): string[] {
		const index = this.getWarningIndex();
		return this.collectWarningTexts(
			province && index.provinceId[province.id],
			province && index.provinceColor[province.color],
			state && index.state[state.id],
			strategicRegion && index.strategicRegion[strategicRegion.id],
			supplyArea && index.supplyArea[supplyArea.id],
		);
	}

	public hasProvinceWarnings(
		province?: Province,
		state?: State,
		strategicRegion?: StrategicRegion,
		supplyArea?: SupplyArea,
	): boolean {
		const index = this.getWarningIndex();
		return (
			(province !== undefined &&
				(index.provinceId[province.id] !== undefined ||
					index.provinceColor[province.color] !== undefined)) ||
			(state !== undefined && index.state[state.id] !== undefined) ||
			(strategicRegion !== undefined &&
				index.strategicRegion[strategicRegion.id] !== undefined) ||
			(supplyArea !== undefined &&
				index.supplyArea[supplyArea.id] !== undefined)
		);
	}

	public getStateWarnings(state: State, supplyArea?: SupplyArea): string[] {
		const index = this.getWarningIndex();
		return this.collectWarningTexts(
			index.state[state.id],
			supplyArea && index.supplyArea[supplyArea.id],
		);
	}

	public getStrategicRegionWarnings(
		strategicRegion: StrategicRegion,
	): string[] {
		return this.collectWarningTexts(
			this.getWarningIndex().strategicRegion[strategicRegion.id],
		);
	}

	public getSupplyAreaWarnings(supplyArea: SupplyArea): string[] {
		return this.collectWarningTexts(
			this.getWarningIndex().supplyArea[supplyArea.id],
		);
	}

	public getRiverWarnings(riverIndex: number): string[] {
		return this.collectWarningTexts(this.getWarningIndex().river[riverIndex]);
	}

	public hasRiverWarnings(riverIndex: number): boolean {
		return this.getWarningIndex().river[riverIndex] !== undefined;
	}
}
