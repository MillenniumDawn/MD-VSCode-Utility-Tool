import { Point, Province } from "./definitions";
import { bboxCenter, distanceHamming, distanceSqr } from "./graphutils";
import { FEWorldMap } from "./loader";
import { ViewPoint } from "./viewpoint";
import { getColorByColorSet, toColor } from "./colors";
import { isEdgeVisible, RenderContext } from "./renderContext";

export function renderMapBackground(
	worldMap: FEWorldMap,
	xOffset: number,
	renderContext: RenderContext,
) {
	const {
		mapCanvasContext: context,
		topBar,
		viewPoint,
		overwriteRenderPrecision,
	} = renderContext;
	const scale = viewPoint.scale;
	const renderedProvinces =
		renderContext.renderedProvincesByOffset[xOffset] ?? [];
	const { renderedProvincesById } = renderContext;
	renderContext.renderedProvincesByOffset[xOffset] = renderedProvinces;
	const edgeVisible = isEdgeVisible(topBar, viewPoint);

	worldMap.forEachProvince((province) => {
		if (renderContext.viewPoint.bboxInView(province.boundingBox, xOffset)) {
			const color = getColorByColorSet(
				topBar.colorSet$.value,
				province,
				worldMap,
				renderContext,
			);
			context.fillStyle = toColor(color);
			renderProvince(
				viewPoint,
				context,
				province,
				scale,
				xOffset,
				overwriteRenderPrecision,
			);
			renderedProvinces.push(province);
			renderedProvincesById[province.id] = province;
		}

		if (edgeVisible) {
			for (const edge of province.edges) {
				if (edge.path.length > 0) {
					continue;
				}

				const toProvince = worldMap.getProvinceById(edge.to);
				if (!toProvince) {
					continue;
				}

				const [startPoint, endPoint] = findNearestPoints(
					edge.start,
					edge.stop,
					province,
					toProvince,
				);
				if (
					renderContext.viewPoint.lineInView(startPoint, endPoint, xOffset)
				) {
					if (!(province.id in renderedProvincesById)) {
						renderedProvinces.push(province);
						renderedProvincesById[province.id] = province;
					}
					if (!(edge.to in renderedProvincesById)) {
						renderedProvinces.push(toProvince);
						renderedProvincesById[edge.to] = toProvince;
					}
				}
			}
		}
	});
}

export function renderAllEdges(
	renderContext: RenderContext,
	worldMap: FEWorldMap,
	context: CanvasRenderingContext2D,
	xOffset: number,
) {
	const renderedProvinces =
		renderContext.renderedProvincesByOffset[xOffset] ?? [];
	const preciseEdge = renderContext.preciseEdge;

	context.strokeStyle = "black";
	context.beginPath();
	for (const province of renderedProvinces) {
		renderEdges(
			renderContext,
			province,
			worldMap,
			context,
			xOffset,
			false,
			preciseEdge,
		);
	}
	context.stroke();

	context.strokeStyle = "red";
	context.beginPath();
	for (const province of renderedProvinces) {
		renderEdges(
			renderContext,
			province,
			worldMap,
			context,
			xOffset,
			true,
			preciseEdge,
		);
	}
	context.stroke();
}

export function renderProvince(
	viewPoint: ViewPoint,
	context: CanvasRenderingContext2D,
	province: Province,
	scale?: number,
	xOffset: number = 0,
	overwriteRenderPrecision?: number,
): void {
	scale = scale ?? viewPoint.scale;
	const renderPrecisionBase = 2;
	const renderPrecision =
		scale < 1
			? Math.pow(
					2,
					Math.floor(Math.log2(1 / scale)) +
						(overwriteRenderPrecision !== undefined
							? 0
							: renderPrecisionBase),
				)
			: (overwriteRenderPrecision ??
				(scale <= renderPrecisionBase
					? Math.pow(2, renderPrecisionBase + 1 - Math.round(scale))
					: 1));
	const renderPrecisionMask = renderPrecision - 1;
	const renderPrecisionOffset = (renderPrecision - 1) / 2;
	for (const zone of province.coverZones) {
		if (zone.w < renderPrecision) {
			if (
				(zone.x & renderPrecisionMask) === 0 &&
				(zone.y & renderPrecisionMask) === 0
			) {
				context.fillRect(
					viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset),
					viewPoint.convertY(zone.y - renderPrecisionOffset),
					renderPrecision * scale,
					renderPrecision * scale,
				);
			}
		} else {
			context.fillRect(
				viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset),
				viewPoint.convertY(zone.y - renderPrecisionOffset),
				zone.w * scale,
				zone.h * scale,
			);
		}
	}
}

function renderEdges(
	renderContext: RenderContext,
	province: Province,
	worldMap: FEWorldMap,
	context: CanvasRenderingContext2D,
	xOffset: number,
	isRed: boolean,
	preciseEdge?: boolean,
) {
	const {
		provinceToState,
		provinceToStrategicRegion,
		stateToSupplyArea,
		renderedProvinces,
		topBar,
		viewPoint,
	} = renderContext;
	const scale = viewPoint.scale;
	const viewMode = topBar.viewMode$.value;

	context.lineWidth = 2;
	for (const provinceEdge of province.edges) {
		if (!("path" in provinceEdge)) {
			continue;
		}

		if (provinceEdge.to > province.id) {
			continue;
		}

		const stateFromId = provinceToState[province.id];
		const stateToId = provinceToState[provinceEdge.to];

		const stateFromImpassable =
			worldMap.getStateById(stateFromId)?.impassable ?? false;
		const stateToImpassable =
			worldMap.getStateById(stateToId)?.impassable ?? false;

		const impassable =
			provinceEdge.type === "impassable" ||
			stateFromImpassable !== stateToImpassable;
		const paths = provinceEdge.path;

		if (
			(impassable ||
				(paths.length === 0 && provinceEdge.type !== "impassable")) !== isRed
		) {
			continue;
		}

		const strategicRegionFromId = provinceToStrategicRegion[province.id];
		const strategicRegionToId = provinceToStrategicRegion[provinceEdge.to];

		if (!impassable && paths.length > 0) {
			if (viewMode === "state") {
				if (
					stateFromId === stateToId &&
					(stateFromId !== undefined ||
						strategicRegionFromId === strategicRegionToId)
				) {
					continue;
				}
			} else if (viewMode === "strategicregion") {
				if (strategicRegionFromId === strategicRegionToId) {
					continue;
				}
			} else if (viewMode === "supplyarea") {
				if (
					(stateFromId === stateToId &&
						(stateFromId !== undefined ||
							strategicRegionFromId === strategicRegionToId)) ||
					(stateFromId !== undefined &&
						stateToId !== undefined &&
						stateToSupplyArea[stateFromId] === stateToSupplyArea[stateToId])
				) {
					continue;
				}
			}
		}

		for (const path of paths) {
			if (path.length === 0) {
				continue;
			}

			const firstPoint = path[0];
			if (firstPoint === undefined) {
				continue;
			}
			context.moveTo(
				viewPoint.convertX(firstPoint.x + xOffset),
				viewPoint.convertY(firstPoint.y),
			);
			for (let j = 0; j < path.length; j++) {
				if (
					!preciseEdge &&
					scale <= 4 &&
					j % (scale < 1 ? Math.floor(10 / scale) : 6 - scale) !== 0 &&
					!isCriticalPoint(path, j)
				) {
					continue;
				}
				const pos = path[j];
				if (pos === undefined) {
					continue;
				}
				context.lineTo(
					viewPoint.convertX(pos.x + xOffset),
					viewPoint.convertY(pos.y),
				);
			}
		}

		if (paths.length === 0 && provinceEdge.type !== "impassable") {
			const toProvince = renderedProvinces?.find(
				(p) => p.id === provinceEdge.to,
			);
			const [startPoint, endPoint] = findNearestPoints(
				provinceEdge.start,
				provinceEdge.stop,
				province,
				toProvince,
			);

			context.moveTo(
				viewPoint.convertX(startPoint.x + xOffset),
				viewPoint.convertY(startPoint.y),
			);
			context.lineTo(
				viewPoint.convertX(endPoint.x + xOffset),
				viewPoint.convertY(endPoint.y),
			);
		}
	}
}

function findNearestPoints(
	start: Point | undefined,
	end: Point | undefined,
	a: Province,
	b: Province | undefined,
): [Point, Point] {
	if (start && end) {
		return [start, end];
	}
	if (!b) {
		return [bboxCenter(a.boundingBox), bboxCenter(a.boundingBox)];
	}
	if (!start) {
		const t = start,
			u = a;
		start = end;
		a = b;
		end = t;
		b = u;
	}
	if (!start) {
		let nearestPair: [Point, Point] | undefined = undefined;
		let nearestPairDistance = 1e10;
		for (const ape of a.edges) {
			for (const ap of ape.path) {
				for (const app of ap) {
					for (const bpe of b.edges) {
						for (const bp of bpe.path) {
							for (const bpp of bp) {
								const disSqr = distanceSqr(app, bpp);
								if (disSqr < nearestPairDistance) {
									nearestPairDistance = disSqr;
									nearestPair = [app, bpp];
								}
							}
						}
					}
				}
			}
		}
		return (
			nearestPair ?? [bboxCenter(a.boundingBox), bboxCenter(a.boundingBox)]
		);
	} else {
		let nearestPair: [Point, Point] | undefined = undefined;
		let nearestPairDistance = 1e10;
		for (const bpe of b.edges) {
			for (const bp of bpe.path) {
				for (const bpp of bp) {
					const disSqr = distanceSqr(start, bpp);
					if (disSqr < nearestPairDistance) {
						nearestPairDistance = disSqr;
						nearestPair = [start, bpp];
					}
				}
			}
		}
		return (
			nearestPair ?? [bboxCenter(a.boundingBox), bboxCenter(a.boundingBox)]
		);
	}
}

function isCriticalPoint(path: Point[], index: number): boolean {
	const point = path[index];
	const previous = path[index - 1];
	const next = path[index + 1];
	return (
		index === 0 ||
		index === path.length - 1 ||
		(point !== undefined &&
			previous !== undefined &&
			next !== undefined &&
			distanceHamming(point, previous) > 2 &&
			distanceHamming(point, next) > 2)
	);
}
