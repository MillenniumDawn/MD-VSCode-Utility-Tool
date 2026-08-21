import { UserError } from "../../../util/common";
import { readFileFromModOrHOI4 } from "../../../util/fileloader";
import { localize } from "../../../util/i18n";
import { BMP, parseBmp } from "../../../util/image/bmp/bmpparser";
import {
	Point,
	ProgressReporter,
	ProvinceBmp,
	ProvinceEdgeGraph,
	ProvinceGraph,
	Region,
	WorldMapWarning,
	Zone,
} from "../definitions";
import { FileLoader, LoadResult, LoadResultOD, mergeRegions } from "./common";

export class ProvinceBmpLoader extends FileLoader<ProvinceBmp> {
	protected async loadFromFile(): Promise<LoadResultOD<ProvinceBmp>> {
		const warnings: WorldMapWarning[] = [];
		return {
			result: await loadProvincesBmp(
				this.file,
				(e) => this.fireOnProgressEvent(e),
				warnings,
			),
			warnings,
		};
	}

	protected extraMesurements(result: LoadResult<ProvinceBmp>) {
		return {
			...super.extraMesurements(result),
			width: result.result.width,
			height: result.result.height,
			provinceCount: result.result.provinces.length,
		};
	}

	public toString() {
		return `[ProvinceBmpLoader: ${this.file}]`;
	}
}

async function loadProvincesBmp(
	provincesFile: string,
	progressReporter: ProgressReporter,
	warnings: WorldMapWarning[],
): Promise<ProvinceBmp> {
	await progressReporter(
		localize("worldmap.progress.loadingprovincebmp", "Loading province bmp..."),
	);

	const [provinceMapImageBuffer] = await readFileFromModOrHOI4(provincesFile);
	const provinceMapImage = parseBmp(
		provinceMapImageBuffer.buffer as ArrayBuffer,
		provinceMapImageBuffer.byteOffset,
	);

	await progressReporter(
		localize(
			"worldmap.progress.calculatingregion",
			"Calculating province region...",
		),
	);

	const {
		colorByPosition,
		provinces: colorOnlyProvinces,
		colorToProvince,
	} = getProvincesByPosition(provinceMapImage);

	const width = provinceMapImage.width;
	const height = provinceMapImage.height;
	const provincesWithZone = fillProvinceZones(
		colorOnlyProvinces,
		colorToProvince,
		colorByPosition,
		width,
		height,
		provincesFile,
		warnings,
	);

	await progressReporter(
		localize(
			"worldmap.progress.calculatingedge",
			"Calculating province edges...",
		),
	);

	const provinces = fillEdges(
		provincesWithZone,
		colorToProvince as Record<number, ColorContainer & ProvinceZoneDef>,
		colorByPosition,
		width,
		height,
	);

	validateProvince(colorByPosition, width, height, provincesFile, warnings);

	return {
		width,
		height,
		colorByPosition,
		colorToProvince: colorToProvince as unknown as Record<
			number,
			ProvinceGraph
		>,
		provinces,
	};
}

type ColorContainer = { color: number; warnings: [] };
function getProvincesByPosition(provinceMapImage: BMP): {
	colorByPosition: Uint32Array;
	provinces: ColorContainer[];
	colorToProvince: Record<number, ColorContainer>;
} {
	if (
		provinceMapImage.width % 256 !== 0 ||
		provinceMapImage.height % 256 !== 0
	) {
		throw new UserError(
			localize(
				"worldmap.error.multiply256",
				"Height and width of map image must be multiply of 256: {0}x{1}.",
				provinceMapImage.width,
				provinceMapImage.height,
			),
		);
	}

	const colorByPosition = new Uint32Array(
		provinceMapImage.width * provinceMapImage.height,
	);
	const bitmapData = provinceMapImage.data;
	const provinces: ColorContainer[] = [];
	const colorToProvince: Record<number, ColorContainer> = {};

	for (
		let y = provinceMapImage.height - 1,
			sy = 0,
			dy = (provinceMapImage.height - 1) * provinceMapImage.width;
		y >= 0;
		y--, sy += provinceMapImage.bytesPerRow, dy -= provinceMapImage.width
	) {
		for (
			let x = 0, sx = sy, dx = dy;
			x < provinceMapImage.width;
			x++, sx += 3, dx++
		) {
			const blue = bitmapData[sx + 2] ?? 0;
			const green = bitmapData[sx + 1] ?? 0;
			const red = bitmapData[sx] ?? 0;
			const color = (blue << 16) | (green << 8) | red;
			const province = colorToProvince[color];
			if (province === undefined) {
				const newProvince: ColorContainer = { color, warnings: [] };

				provinces.push(newProvince);
				colorToProvince[color] = newProvince;
				colorByPosition[dx] = color;
			} else {
				colorByPosition[dx] = province.color;
			}
		}
	}

	return {
		colorByPosition,
		colorToProvince,
		provinces,
	};
}

type ProvinceZoneDef = { coverZones: Zone[] } & Region;
function fillProvinceZones<T extends ColorContainer>(
	provincesWithoutCoverZones: (T & Partial<ProvinceZoneDef>)[],
	colorToProvince: Record<number, T & Partial<ProvinceZoneDef>>,
	colorByPosition: Uint32Array,
	width: number,
	height: number,
	file: string,
	warnings: WorldMapWarning[],
): (T & ProvinceZoneDef)[] {
	const blockStack: Zone[] = [];
	const blockSize = 256;
	for (let x = 0; x < width; x += blockSize) {
		for (let y = 0; y < height; y += blockSize) {
			blockStack.push({ x, y, w: blockSize, h: blockSize });
		}
	}

	for (const province of provincesWithoutCoverZones) {
		province.coverZones = [];
	}

	const provinces = provincesWithoutCoverZones as (T &
		Partial<ProvinceZoneDef> & { coverZones: Zone[] })[];

	while (blockStack.length > 0) {
		const block = blockStack.pop()!;
		const t = block.y;
		const l = block.x;
		const b = block.y + block.h;
		const r = block.x + block.w;
		const color = colorByPosition[t * width + l] ?? 0;
		let sameColor = true;
		for (let y = t, yi = t * width; y < b; y++, yi += width) {
			for (let x = l, xi = yi + l; x < r; x++, xi++) {
				if (colorByPosition[xi] !== color) {
					sameColor = false;
					break;
				}
			}
			if (!sameColor) {
				break;
			}
		}

		if (sameColor) {
			const province = colorToProvince[color];
			if (province) {
				province.coverZones!.push(block);
			}
		} else {
			const blockSize = block.w >> 1;
			blockStack.push({ ...block, w: blockSize, h: blockSize });
			blockStack.push({
				...block,
				x: block.x + blockSize,
				w: blockSize,
				h: blockSize,
			});
			blockStack.push({
				...block,
				y: block.y + blockSize,
				w: blockSize,
				h: blockSize,
			});
			blockStack.push({
				x: block.x + blockSize,
				y: block.y + blockSize,
				w: blockSize,
				h: blockSize,
			});
		}
	}

	for (const provinceWithoutRegion of provinces) {
		const province = Object.assign(
			provinceWithoutRegion,
			mergeRegions(provinceWithoutRegion.coverZones, width),
		);
		if (
			province.boundingBox.w > width / 2 ||
			province.boundingBox.h > height / 2
		) {
			warnings.push({
				source: [{ type: "province", color: province.color, id: -1 }],
				relatedFiles: [file],
				text: localize(
					"worldmap.warnings.provincetoolarge",
					"The province is too large: {0}x{1}.",
					province.boundingBox.w,
					province.boundingBox.h,
				),
			});
		}
	}

	return provinces as (T & ProvinceZoneDef)[];
}

type EdgeDef = { edges: ProvinceEdgeGraph[] };
export function fillEdges<T extends ColorContainer>(
	provincesWithoutEdges: (T & Partial<EdgeDef>)[],
	colorToProvinceWithoutEdges: Record<number, T & Partial<EdgeDef>>,
	colorByPosition: Uint32Array,
	width: number,
	height: number,
): (T & EdgeDef)[] {
	const accessedPixels = new Uint8Array(colorByPosition.length);

	for (const province of provincesWithoutEdges) {
		province.edges = [];
	}

	const provinces = provincesWithoutEdges as (T & EdgeDef)[];
	const colorToProvince = colorToProvinceWithoutEdges as Record<
		number,
		T & EdgeDef
	>;

	for (let y = 0, yi = 0; y < height; y++, yi += width) {
		for (let x = 0, xi = yi; x < width; x++, xi++) {
			if (accessedPixels[xi]) {
				continue;
			}

			fillEdgesOfProvince(
				xi,
				colorToProvince,
				colorByPosition,
				accessedPixels,
				width,
				height,
			);
		}
	}

	return provinces as (T & EdgeDef)[];
}

export function fillEdgesOfProvince<T extends EdgeDef>(
	index: number,
	colorToProvince: Record<number, T>,
	colorByPosition: Uint32Array,
	accessedPixels: Uint8Array,
	width: number,
	height: number,
): void {
	const color = colorByPosition[index] ?? 0;
	const edgePixels = findEdgePixels(
		index,
		accessedPixels,
		color,
		colorByPosition,
		width,
		height,
	);
	const edgePixelsByAdjecentProvince: Record<number, [Point, Point][]> = {};
	edgePixels.forEach(([p, line]) => {
		let lines = edgePixelsByAdjecentProvince[p];
		if (lines === undefined) {
			edgePixelsByAdjecentProvince[p] = lines = [];
		}
		lines.push(line);
	});

	const province = colorToProvince[color];
	if (province === undefined) {
		return;
	}
	const edgeSetByColor = new Map<number, ProvinceEdgeGraph>();
	for (const edgeSet of province.edges) {
		edgeSetByColor.set(edgeSet.toColor, edgeSet);
	}
	for (const [key, value] of Object.entries(edgePixelsByAdjecentProvince)) {
		const numKey = parseInt(key);
		let edgeSet = edgeSetByColor.get(numKey);
		const isNew = edgeSet === undefined;
		if (edgeSet === undefined) {
			edgeSet = { toColor: numKey, path: [] };
		}
		const concatedEdges = concatEdges(value);
		edgeSet.path.push(...concatedEdges);
		if (isNew) {
			province.edges.push(edgeSet);
			edgeSetByColor.set(numKey, edgeSet);
		}
	}
}

const indicesToOffset: [number, number][][] = [
	[
		[0, 1],
		[0, 0],
	],
	[
		[0, 0],
		[1, 0],
	],
	[
		[1, 0],
		[1, 1],
	],
	[
		[1, 1],
		[0, 1],
	],
];
function findEdgePixels(
	index: number,
	accessedPixels: Uint8Array,
	color: number,
	colorByPosition: Uint32Array,
	width: number,
	height: number,
) {
	const edgePixels: [number, [Point, Point]][] = [];
	const pixelStack: number[] = [index];
	const indices: number[] = new Array(4);

	while (pixelStack.length > 0) {
		const pixelIndex = pixelStack.pop()!;
		if (accessedPixels[pixelIndex]) {
			continue;
		}

		const x = pixelIndex % width;
		const y = Math.floor(pixelIndex / width);

		indices[0] = x === 0 ? pixelIndex + width - 1 : pixelIndex - 1;
		indices[1] = pixelIndex - width;
		indices[2] = x === width - 1 ? pixelIndex - width + 1 : pixelIndex + 1;
		indices[3] = y === height - 1 ? -1 : pixelIndex + width;

		for (let i = 0; i < 4; i++) {
			const adjecentIndex = indices[i];
			const offsets = indicesToOffset[i];
			if (offsets === undefined) {
				continue;
			}
			if (adjecentIndex === undefined || adjecentIndex < 0) {
				edgePixels.push([
					-1,
					offsets.map(([xOff, yOff]) => ({ x: x + xOff, y: y + yOff })) as [
						Point,
						Point,
					],
				]);
			} else {
				const adjecentColor = colorByPosition[adjecentIndex] ?? 0;
				if (color !== adjecentColor) {
					edgePixels.push([
						adjecentColor,
						offsets.map(([xOff, yOff]) => ({ x: x + xOff, y: y + yOff })) as [
							Point,
							Point,
						],
					]);
				} else {
					pixelStack.push(adjecentIndex);
				}
			}
		}

		accessedPixels[pixelIndex] = 1;
	}

	return edgePixels;
}

type EdgeBucket = { idx: number[]; ptr: number };
export function concatEdges(edges: [Point, Point][]): Point[][] {
	const result: Point[][] = [];
	const accessedEdges = new Array<boolean>(edges.length).fill(false);

	// Index segments by endpoint coordinates so joining is O(1) amortized per join
	// instead of a linear findIndex scan. byTail keys a point to the ascending list
	// of edges whose tail (e[1]) is that point; byHead keys by head (e[0]). Each
	// bucket keeps a pointer that only skips forward past already-consumed edges, so
	// firstUnaccessed returns the same lowest-index unconsumed match findIndex did.
	const pointKey = (p: Point): string => `${p.x},${p.y}`;
	const byTail = new Map<string, EdgeBucket>();
	const byHead = new Map<string, EdgeBucket>();
	const pushInto = (
		map: Map<string, EdgeBucket>,
		key: string,
		i: number,
	): void => {
		let bucket = map.get(key);
		if (bucket === undefined) {
			map.set(key, (bucket = { idx: [], ptr: 0 }));
		}
		bucket.idx.push(i);
	};
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		if (edge) {
			pushInto(byHead, pointKey(edge[0]), i);
			pushInto(byTail, pointKey(edge[1]), i);
		}
	}
	const firstUnaccessed = (
		map: Map<string, EdgeBucket>,
		key: string,
	): number => {
		const bucket = map.get(key);
		if (bucket === undefined) {
			return -1;
		}
		while (bucket.ptr < bucket.idx.length) {
			const edgeIndex = bucket.idx[bucket.ptr];
			if (edgeIndex === undefined) {
				break;
			}
			if (!accessedEdges[edgeIndex]) {
				break;
			}
			bucket.ptr++;
		}
		return bucket.ptr < bucket.idx.length ? (bucket.idx[bucket.ptr] ?? -1) : -1;
	};

	for (let i = 0; i < edges.length; i++) {
		if (accessedEdges[i]) {
			continue;
		}

		const edge = edges[i];
		if (edge === undefined) {
			continue;
		}
		// A path grows at both ends. Collecting the head side in its own array and reversing it
		// once keeps that linear: unshifting each new point into a single array moved every point
		// already found, so assembling one border of k segments cost k^2 element moves, and a
		// coastline or the ocean/land boundary runs to thousands of segments. headPoints holds
		// them in the order they were found, which is the reverse of their order in the path.
		const headPoints: Point[] = [];
		const tailPoints: Point[] = [...edge];
		accessedEdges[i] = true;

		let foundNew = true;
		while (foundNew) {
			foundNew = false;
			const head = headPoints[headPoints.length - 1] ?? tailPoints[0];
			if (head === undefined) {
				break;
			}
			const headTail = firstUnaccessed(byTail, pointKey(head));
			if (headTail !== -1) {
				accessedEdges[headTail] = foundNew = true;
				const previousEdge = edges[headTail];
				if (previousEdge) {
					headPoints.push(previousEdge[0]);
				}
			}

			const tail = tailPoints[tailPoints.length - 1];
			if (tail === undefined) {
				break;
			}
			const tailHead = firstUnaccessed(byHead, pointKey(tail));
			if (tailHead !== -1) {
				accessedEdges[tailHead] = foundNew = true;
				const nextEdge = edges[tailHead];
				if (nextEdge) {
					tailPoints.push(nextEdge[1]);
				}
			}
		}

		headPoints.reverse();
		const edgePoints: Point[] = headPoints.concat(tailPoints);

		const newEdge: Point[] = [];
		const firstPoint = edgePoints[0];
		if (firstPoint === undefined) {
			continue;
		}
		let lastPoint: Point = firstPoint;
		for (const point of edgePoints) {
			if (newEdge.length < 2) {
				newEdge.push(point);
			} else {
				if (point.x === lastPoint.x || point.y === lastPoint.y) {
					newEdge[newEdge.length - 1] = point;
				} else {
					const previousPoint = newEdge[newEdge.length - 1];
					if (previousPoint) {
						lastPoint = previousPoint;
					}
					newEdge.push(point);
				}
			}
		}

		result.push(newEdge);
	}

	return result;
}

export function validateProvince(
	colorByPosition: Uint32Array,
	width: number,
	height: number,
	file: string,
	warnings: WorldMapWarning[],
) {
	for (let y = 1, y0 = width, index = width; y < height; y++, y0 += width) {
		for (let x = 0; x < width; x++, index++) {
			const i1 = index + (x === width - 1 ? -width : 0) + 1;
			const c0 = colorByPosition[index] ?? 0;
			const c1 = colorByPosition[i1] ?? 0;
			const c2 = colorByPosition[index - width] ?? 0;
			const c3 = colorByPosition[i1 - width] ?? 0;
			if (
				c0 !== c1 &&
				c0 !== c2 &&
				c0 !== c3 &&
				c1 !== c2 &&
				c1 !== c3 &&
				c2 !== c3
			) {
				const colors = [c0, c1, c2, c3];
				warnings.push({
					source: colors.map((color) => ({ color, id: -1, type: "province" })),
					relatedFiles: [file],
					text: localize(
						"worldmap.warnings.xcrossing",
						"Map invalid X crossing at: ({0}, {1}).",
						x,
						y - 1,
					),
				});
			}
		}
	}
}
