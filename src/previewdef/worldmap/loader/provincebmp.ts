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

	protected override extraMeasurements(result: LoadResult<ProvinceBmp>) {
		return {
			...super.extraMeasurements(result),
			width: result.result.width,
			height: result.result.height,
			provinceCount: result.result.provinces.length,
		};
	}

	public override toString() {
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

	const { colorByPosition, provinces: colorOnlyProvinces } =
		getProvincesByPosition(provinceMapImage);

	const width = provinceMapImage.width;
	const height = provinceMapImage.height;
	const provincesWithZone = fillProvinceZones(
		colorOnlyProvinces,
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

	// The annotation is the check that the two stages add up to a ProvinceGraph.
	const provinces: ProvinceGraph[] = fillEdges(
		provincesWithZone,
		colorByPosition,
		width,
		height,
	);

	validateProvince(colorByPosition, width, height, provincesFile, warnings);

	return {
		width,
		height,
		colorByPosition,
		colorToProvince: byColor(provinces),
		provinces,
	};
}

type ColorContainer = { color: number };

function byColor<T extends ColorContainer>(provinces: T[]): Record<number, T> {
	const result: Record<number, T> = {};
	for (const province of provinces) {
		result[province.color] = province;
	}
	return result;
}

function getProvincesByPosition(provinceMapImage: BMP): {
	colorByPosition: Uint32Array;
	provinces: ColorContainer[];
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

	// The loop below reads three bytes per pixel; any other depth would be read as colours
	// that no province has.
	if (provinceMapImage.bitsPerPixel !== 24) {
		throw new UserError(
			localize(
				"worldmap.error.provinceimagebpp",
				"The provinces image should be 24 bits per pixel, but it is {0}.",
				provinceMapImage.bitsPerPixel,
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
				const newProvince: ColorContainer = { color };

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
		provinces,
	};
}

type ProvinceWithZones = ColorContainer & Region & { coverZones: Zone[] };
function fillProvinceZones(
	provincesWithoutCoverZones: ColorContainer[],
	colorByPosition: Uint32Array,
	width: number,
	height: number,
	file: string,
	warnings: WorldMapWarning[],
): ProvinceWithZones[] {
	const blockStack: Zone[] = [];
	const blockSize = 256;
	for (let x = 0; x < width; x += blockSize) {
		for (let y = 0; y < height; y += blockSize) {
			blockStack.push({ x, y, w: blockSize, h: blockSize });
		}
	}

	const coverZonesByColor = new Map<number, Zone[]>();
	for (const province of provincesWithoutCoverZones) {
		coverZonesByColor.set(province.color, []);
	}

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
			coverZonesByColor.get(color)?.push(block);
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

	const provinces: ProvinceWithZones[] = provincesWithoutCoverZones.map(
		(province) => {
			const coverZones = coverZonesByColor.get(province.color) ?? [];
			return { ...province, coverZones, ...mergeRegions(coverZones, width) };
		},
	);

	for (const province of provinces) {
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

	return provinces;
}

type EdgeDef = { edges: ProvinceEdgeGraph[] };
export function fillEdges<T extends ColorContainer>(
	provincesWithoutEdges: T[],
	colorByPosition: Uint32Array,
	width: number,
	height: number,
): (T & EdgeDef)[] {
	const accessedPixels = new Uint8Array(colorByPosition.length);

	const provinces: (T & EdgeDef)[] = provincesWithoutEdges.map((province) => ({
		...province,
		edges: [],
	}));
	const colorToProvince = byColor(provinces);

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

	return provinces;
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
	const edgePixelsByAdjecentProvince = findEdgePixels(
		index,
		accessedPixels,
		color,
		colorByPosition,
		width,
		height,
	);

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
		const concatedEdges = concatFlatEdges(value, height + 1);
		edgeSet.path.push(...concatedEdges);
		if (isNew) {
			province.edges.push(edgeSet);
			edgeSetByColor.set(numKey, edgeSet);
		}
	}
}

// Flood-fills the province under `index` and returns its boundary segments grouped by the colour
// on their far side (-1 past the top or bottom of the map). Each segment is four numbers
// x0, y0, x1, y1 in its group's array rather than a pair of points: a world map has millions of
// them, and an object per endpoint was most of what a load left for the garbage collector.
function findEdgePixels(
	index: number,
	accessedPixels: Uint8Array,
	color: number,
	colorByPosition: Uint32Array,
	width: number,
	height: number,
): Record<number, number[]> {
	const edgesByAdjecentColor: Record<number, number[]> = {};
	const pixelStack: number[] = [index];

	const addEdge = (
		adjecentColor: number,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
	): void => {
		let edges = edgesByAdjecentColor[adjecentColor];
		if (edges === undefined) {
			edgesByAdjecentColor[adjecentColor] = edges = [];
		}
		edges.push(x0, y0, x1, y1);
	};
	const visit = (
		adjecentIndex: number,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
	): void => {
		if (adjecentIndex < 0) {
			addEdge(-1, x0, y0, x1, y1);
			return;
		}
		const adjecentColor = colorByPosition[adjecentIndex] ?? 0;
		if (color !== adjecentColor) {
			addEdge(adjecentColor, x0, y0, x1, y1);
		} else {
			pixelStack.push(adjecentIndex);
		}
	};

	while (pixelStack.length > 0) {
		const pixelIndex = pixelStack.pop()!;
		if (accessedPixels[pixelIndex]) {
			continue;
		}

		const x = pixelIndex % width;
		const y = Math.floor(pixelIndex / width);

		// Left, up, right, down; the map wraps horizontally but not vertically. Each side is
		// traced in the same rotational direction, so a province's segments chain head to tail.
		visit(x === 0 ? pixelIndex + width - 1 : pixelIndex - 1, x, y + 1, x, y);
		visit(pixelIndex - width, x, y, x + 1, y);
		visit(
			x === width - 1 ? pixelIndex - width + 1 : pixelIndex + 1,
			x + 1,
			y,
			x + 1,
			y + 1,
		);
		visit(
			y === height - 1 ? -1 : pixelIndex + width,
			x + 1,
			y + 1,
			x,
			y + 1,
		);

		accessedPixels[pixelIndex] = 1;
	}

	return edgesByAdjecentColor;
}

export function concatEdges(edges: [Point, Point][]): Point[][] {
	const flatEdges: number[] = [];
	let maxY = 0;
	for (const [head, tail] of edges) {
		flatEdges.push(head.x, head.y, tail.x, tail.y);
		maxY = Math.max(maxY, head.y, tail.y);
	}
	return concatFlatEdges(flatEdges, maxY + 1);
}

type EdgeBucket = { idx: number[]; ptr: number };
// Joins directed segments, four numbers x0, y0, x1, y1 each, into paths. A point is keyed as
// x * stride + y, so stride has to be larger than every y: the map height plus one.
function concatFlatEdges(edges: number[], stride: number): Point[][] {
	const result: Point[][] = [];
	const edgeCount = edges.length >> 2;
	const accessedEdges = new Uint8Array(edgeCount);

	// Index segments by endpoint coordinates so joining is O(1) amortized per join
	// instead of a linear findIndex scan. byTail keys a point to the ascending list
	// of edges whose tail (x1, y1) is that point; byHead keys by head (x0, y0). Each
	// bucket keeps a pointer that only skips forward past already-consumed edges, so
	// firstUnaccessed returns the same lowest-index unconsumed match findIndex did.
	const byTail = new Map<number, EdgeBucket>();
	const byHead = new Map<number, EdgeBucket>();
	const pushInto = (
		map: Map<number, EdgeBucket>,
		key: number,
		i: number,
	): void => {
		let bucket = map.get(key);
		if (bucket === undefined) {
			map.set(key, (bucket = { idx: [], ptr: 0 }));
		}
		bucket.idx.push(i);
	};
	for (let i = 0, j = 0; i < edgeCount; i++, j += 4) {
		pushInto(byHead, (edges[j] ?? 0) * stride + (edges[j + 1] ?? 0), i);
		pushInto(byTail, (edges[j + 2] ?? 0) * stride + (edges[j + 3] ?? 0), i);
	}
	const firstUnaccessed = (
		map: Map<number, EdgeBucket>,
		key: number,
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

	for (let i = 0; i < edgeCount; i++) {
		if (accessedEdges[i]) {
			continue;
		}
		accessedEdges[i] = 1;

		// A path grows at both ends. Collecting the head side in its own array and reading it
		// backwards keeps that linear: unshifting each new point into a single array moved every
		// point already found, so assembling one border of k segments cost k^2 element moves, and
		// a coastline or the ocean/land boundary runs to thousands of segments. headPoints holds
		// x, y pairs in the order they were found, which is the reverse of their order in the path.
		const j = i * 4;
		let headX = edges[j] ?? 0;
		let headY = edges[j + 1] ?? 0;
		let tailX = edges[j + 2] ?? 0;
		let tailY = edges[j + 3] ?? 0;
		const headPoints: number[] = [];
		const tailPoints: number[] = [headX, headY, tailX, tailY];

		let foundNew = true;
		while (foundNew) {
			foundNew = false;
			const headTail = firstUnaccessed(byTail, headX * stride + headY);
			if (headTail !== -1) {
				accessedEdges[headTail] = 1;
				foundNew = true;
				headX = edges[headTail * 4] ?? 0;
				headY = edges[headTail * 4 + 1] ?? 0;
				headPoints.push(headX, headY);
			}

			const tailHead = firstUnaccessed(byHead, tailX * stride + tailY);
			if (tailHead !== -1) {
				accessedEdges[tailHead] = 1;
				foundNew = true;
				tailX = edges[tailHead * 4 + 2] ?? 0;
				tailY = edges[tailHead * 4 + 3] ?? 0;
				tailPoints.push(tailX, tailY);
			}
		}

		// Walk the path in order, dropping the middle points of straight runs. It is kept as
		// coordinates until the end so only the points that survive become objects.
		const kept: number[] = [];
		const headLength = headPoints.length;
		const pathLength = headLength + tailPoints.length;
		let lastX = headX;
		let lastY = headY;
		for (let k = 0; k < pathLength; k += 2) {
			const x =
				(k < headLength
					? headPoints[headLength - 2 - k]
					: tailPoints[k - headLength]) ?? 0;
			const y =
				(k < headLength
					? headPoints[headLength - 1 - k]
					: tailPoints[k - headLength + 1]) ?? 0;
			if (kept.length < 4) {
				kept.push(x, y);
			} else if (x === lastX || y === lastY) {
				kept[kept.length - 2] = x;
				kept[kept.length - 1] = y;
			} else {
				lastX = kept[kept.length - 2] ?? 0;
				lastY = kept[kept.length - 1] ?? 0;
				kept.push(x, y);
			}
		}

		const newEdge: Point[] = [];
		for (let k = 0; k < kept.length; k += 2) {
			newEdge.push({ x: kept[k] ?? 0, y: kept[k + 1] ?? 0 });
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
