// What the decision and event previews draw on top of a finished layout: the rails between the
// columns, the arrow labels, the curves they sit on, and the hover that isolates one chain. The
// layout itself is graphlayout.ts; this is everything that turns its numbers into elements.
//
// Both previews carried their own copy of all of it -- byte for byte in the case of the isolation
// helpers, which sat at the same line numbers in both files. What genuinely differs between the two
// is passed in: which toggle guards an arrow, what its label says, and which classes its curve gets.

import { getState, panning$ } from "./common";
import {
	LayoutInput,
	LayoutResult,
	columnGap,
	padY,
	separateChips,
} from "./graphlayout";

export interface GraphNodeLike {
	id: string;
}

export interface GraphEdgeLike {
	from: string;
	to: string;
}

// A node on the canvas: the positioned wrapper, which hover isolation dims, and the card inside it,
// which the search highlight goes on -- so the two never fight over one element and neither needs
// !important.
export interface RenderedNode<N extends GraphNodeLike> {
	node: N;
	element: HTMLDivElement;
	card: HTMLDivElement;
}

export interface RenderedEdge<E extends GraphEdgeLike> {
	edge: E;
	path: SVGPathElement;
	chip?: HTMLDivElement;
}

// An arrow's label. `guarded` rides along because it decides both what the label says and which
// classes the curve gets, and neither preview should have to work it out twice.
export interface BuiltChip<E extends GraphEdgeLike> {
	edge: E;
	guarded: boolean;
	chip?: HTMLDivElement;
}

export function currentScale(): number {
	return getState().scale || 1;
}

// One rail down the middle of every gap between two columns. `railLabel` is optional because only
// the event preview numbers them.
export function renderRails(
	content: HTMLDivElement,
	layout: LayoutResult,
	railLabel?: (step: number) => string,
): void {
	for (let i = 1; i < layout.columnX.length; i++) {
		const rail = document.createElement("div");
		rail.className = "ev-rail";
		// Down the middle of the gap before this column, which is no longer a fixed width.
		rail.style.left = (layout.gapX[i - 1] ?? 0) + (layout.gapWidth[i - 1] ?? columnGap) / 2 + "px";
		rail.style.height = layout.height + "px";
		if (railLabel) {
			const label = document.createElement("span");
			label.textContent = railLabel(i);
			rail.appendChild(label);
		}
		content.appendChild(rail);
	}
}

// Chips are created before the layout runs, because their measured width is what decides how wide
// the gap they sit in has to be. They are hidden until the layout says where they go.
export function buildChips<E extends GraphEdgeLike>(
	content: HTMLDivElement,
	edges: readonly E[],
	guardedOf: (edge: E) => boolean,
	textOf: (edge: E, guarded: boolean) => string,
): BuiltChip<E>[] {
	return edges.map((edge) => {
		const guarded = guardedOf(edge);
		const text = textOf(edge, guarded);
		if (!text) {
			return { edge, guarded };
		}
		const chip = document.createElement("div");
		chip.className =
			"ev-chip" +
			(guarded ? " ev-chip-guarded" : "") +
			(hasSkipped(edge) ? " ev-chip-bridged" : "");
		chip.textContent = text;
		chip.style.left = "0px";
		chip.style.top = "0px";
		chip.style.visibility = "hidden";
		content.appendChild(chip);
		return { edge, guarded, chip };
	});
}

// An edge whose call was redirected past nodes a filter removed carries the ids it stepped over.
// Read structurally: only the two tree payloads have the field, and only sometimes.
function hasSkipped(edge: GraphEdgeLike): boolean {
	return ((edge as { skipped?: string[] }).skipped?.length ?? 0) > 0;
}

// x of the cubic used for the arrows, which is monotonic from x1 to x2, so a bisection finds the
// parameter that puts a point at a given x.
function cubicAt(a: number, b: number, c: number, d: number, t: number): number {
	const s = 1 - t;
	return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

function parameterAtX(x1: number, c1: number, c2: number, x2: number, target: number): number {
	let low = 0;
	let high = 1;
	for (let i = 0; i < 20; i++) {
		const mid = (low + high) / 2;
		if (cubicAt(x1, c1, c2, x2, mid) < target) {
			low = mid;
		} else {
			high = mid;
		}
	}
	return (low + high) / 2;
}

// Draws one curve per edge and drops each chip into the gap the layout widened for it. Grows the
// canvas when the chip separation pushed one below what the layout reserved.
export function renderEdges<E extends GraphEdgeLike>(
	content: HTMLDivElement,
	svg: SVGSVGElement,
	layout: LayoutResult,
	measured: LayoutInput[],
	built: BuiltChip<E>[],
	edgeClass: (edge: E, guarded: boolean) => string,
): RenderedEdge<E>[] {
	const sizeById = new Map(measured.map((m) => [m.id, m]));
	const fanOut = new Map<string, number>();
	const placements: { gap: number; x: number; y: number; height: number; chip: HTMLDivElement }[] =
		[];
	const renderedEdges: RenderedEdge<E>[] = [];

	for (const { edge, guarded, chip } of built) {
		const from = layout.positions[edge.from];
		const to = layout.positions[edge.to];
		const fromSize = sizeById.get(edge.from);
		const toSize = sizeById.get(edge.to);
		if (!from || !to || !fromSize || !toSize) {
			chip?.remove();
			continue;
		}

		const index = fanOut.get(edge.from) ?? 0;
		fanOut.set(edge.from, index + 1);

		const x1 = from.x + fromSize.width;
		// Fanning the origins apart keeps parallel arrows readable, but the spread has to stay on the
		// card it leaves from -- unclamped, a node with a dozen calls put the last arrow below its box.
		const spread = Math.min(7, Math.max(2, (fromSize.height - 8) / Math.max(1, index + 1)));
		const y1 = from.y + fromSize.height / 2 + (index - 0.5) * spread;
		const x2 = to.x;
		const y2 = to.y + toSize.height / 2;
		const dx = Math.max(28, (x2 - x1) * 0.5);

		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
		path.setAttribute("class", edgeClass(edge, guarded));
		svg.appendChild(path);

		if (chip) {
			// The gap after the source column is the one the layout widened for this chip, and the only
			// band on the canvas guaranteed to be free of cards -- an arrow that skips a column would
			// otherwise drop its label onto a card in between.
			const gap = layout.rank[edge.from] ?? 0;
			const centre = (layout.gapX[gap] ?? x1) + (layout.gapWidth[gap] ?? 0) / 2;
			const t = parameterAtX(x1, x1 + dx, x2 - dx, x2, centre);
			const height = chip.getBoundingClientRect().height / currentScale();
			placements.push({
				gap,
				x: centre,
				y: cubicAt(y1, y1, y2, y2, t) - height / 2,
				height,
				chip,
			});
		}

		renderedEdges.push({ edge, path, chip });
	}

	let bottom = 0;
	for (const placement of separateChips(placements)) {
		placement.chip.style.left = placement.x + "px";
		// .ev-chip is translated by -50% on both axes, so the style position is its centre.
		placement.chip.style.top = placement.y + placement.height / 2 + "px";
		placement.chip.style.visibility = "";
		bottom = Math.max(bottom, placement.y + placement.height);
	}
	if (bottom + padY > layout.height) {
		layout.height = bottom + padY;
		content.style.height = layout.height + "px";
		svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
		svg.setAttribute("height", String(layout.height));
	}

	return renderedEdges;
}

export function downstreamOf(id: string, childrenById: Map<string, string[]>): Set<string> {
	const reached = new Set<string>([id]);
	const stack = [id];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) {
			continue;
		}
		for (const child of childrenById.get(current) ?? []) {
			if (!reached.has(child)) {
				reached.add(child);
				stack.push(child);
			}
		}
	}
	return reached;
}

// What a preview holds on to so that something other than a pointer leaving a card -- a drag
// starting, say -- can put the canvas back the way it was.
export interface IsolationHandle {
	clear(): void;
}

// Lights up the chain under the pointer and dims the rest. Class flipping only -- never a
// re-layout, so isolating a chain stays cheap on a large file.
export function wireIsolation<N extends GraphNodeLike, E extends GraphEdgeLike>(
	rendered: readonly RenderedNode<N>[],
	renderedEdges: readonly RenderedEdge<E>[],
	childrenById: Map<string, string[]>,
): IsolationHandle {
	const setIsolation = (reached: Set<string> | undefined): void => {
		for (const item of rendered) {
			item.element.classList.toggle("ev-dim", reached !== undefined && !reached.has(item.node.id));
		}
		for (const item of renderedEdges) {
			const on = reached === undefined || (reached.has(item.edge.from) && reached.has(item.edge.to));
			item.path.classList.toggle("ev-edge-dim", !on);
			item.chip?.classList.toggle("ev-dim", !on);
		}
	};

	for (const item of rendered) {
		const enter = () => {
			// Cards slide under a stationary cursor while the canvas is dragged, so without this the
			// chain would light up card by card for the length of the drag.
			if (panning$.value) {
				return;
			}
			setIsolation(downstreamOf(item.node.id, childrenById));
		};
		const leave = () => setIsolation(undefined);
		item.element.addEventListener("mouseenter", enter);
		item.element.addEventListener("mouseleave", leave);
		item.element.addEventListener("focusin", enter);
		item.element.addEventListener("focusout", leave);
	}

	return { clear: () => setIsolation(undefined) };
}
