// Left-to-right layered graph layout, shared by the event and decision previews. It knows nothing
// about what a node holds -- only its id and measured size -- so both previews lay their canvas out
// with one copy of the packing, the anti-overlap sweep and the chip separation.

export interface LayoutInput {
	id: string;
	width: number;
	height: number;
}

// The measured size of an arrow's label. A chip lives in the gap that follows its source column, so
// the gap has to be wide enough to hold it clear of the cards on either side.
export interface ChipInput {
	from: string;
	to: string;
	width: number;
}

export interface LayoutResult {
	positions: Record<string, { x: number; y: number }>;
	rank: Record<string, number>;
	columnX: number[];
	// gapX[i] is the left edge of the empty band between column i and column i + 1, gapWidth[i] its
	// width. Both are indexed by the column on the left of the gap.
	gapX: number[];
	gapWidth: number[];
	width: number;
	height: number;
}

// Exported because a caller drawing on top of the finished layout needs the same numbers: the rail
// down the middle of a gap needs its default width, and a canvas grown to fit something the layout
// did not measure needs the same bottom padding.
export const columnGap = 78;
const rowGap = 18;
const padX = 34;
export const padY = 42;
// Clearance kept on either side of a chip inside its gap, and between two chips stacked in one gap.
const chipPadX = 10;
const chipGapY = 6;

// Left-to-right layered layout. The rank of a node picks its column, the column's x comes from the
// widest card in it, and a bottom-up pack stacks each subtree vertically and centres a parent over
// its children.
//
// Two things then guarantee that nothing can overlap, whatever the toggles do to the measured sizes.
// Horizontally, a column is as wide as its widest card and the gap after it is as wide as its widest
// arrow label, so a card and a label can never share space. Vertically, a final per-column sweep
// pushes any card that would still sit on top of the one above it down far enough to clear it; the
// centring survives wherever there is room for it.
export function layoutGraph(
	nodes: LayoutInput[],
	edges: { from: string; to: string }[],
	roots: string[],
	chips: ChipInput[] = [],
): LayoutResult {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const outEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const inEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const seenEdges = new Set<string>();

	for (const edge of edges) {
		if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
			continue;
		}
		// The payload is a DAG, so the same pair can carry several edges -- two differently guarded
		// calls to one event, say. They are one relationship as far as the layout is concerned.
		const key = edge.from + " " + edge.to;
		if (seenEdges.has(key)) {
			continue;
		}
		seenEdges.add(key);
		outEdges.get(edge.from)?.push(edge.to);
		inEdges.get(edge.to)?.push(edge.from);
	}

	// Longest path from a root decides the column, over every incoming edge rather than the first
	// one seen: a node reached both directly and through a longer detour belongs to the right of
	// both callers, or the edge from the deeper one would point backwards.
	const rank = new Map<string, number>();
	const remaining = new Map<string, number>(
		nodes.map((n) => [n.id, (inEdges.get(n.id) ?? []).length]),
	);
	const queue: string[] = [];
	const queued = new Set<string>();
	const processed = new Set<string>();
	for (const node of nodes) {
		if ((remaining.get(node.id) ?? 0) === 0) {
			rank.set(node.id, 0);
			queue.push(node.id);
			queued.add(node.id);
		}
	}

	let cursorIndex = 0;
	while (processed.size < nodes.length) {
		if (cursorIndex >= queue.length) {
			// Everything left sits on a cycle, so nothing will ever reach in-degree zero. Release the
			// first such node in payload order and carry on; the layout stays deterministic and the
			// cycle gets one arbitrary but stable entry point.
			const stuck = nodes.find((n) => !queued.has(n.id));
			if (!stuck) {
				break;
			}
			if (!rank.has(stuck.id)) {
				rank.set(stuck.id, 0);
			}
			queue.push(stuck.id);
			queued.add(stuck.id);
		}

		const current = queue[cursorIndex++];
		if (current === undefined) {
			continue;
		}
		processed.add(current);
		const depth = rank.get(current) ?? 0;
		for (const child of outEdges.get(current) ?? []) {
			rank.set(child, Math.max(rank.get(child) ?? 0, depth + 1));
			const left = (remaining.get(child) ?? 0) - 1;
			remaining.set(child, left);
			if (left <= 0 && !queued.has(child)) {
				queue.push(child);
				queued.add(child);
			}
		}
	}

	// The vertical pack needs a tree. Each node keeps the incoming edge from the column immediately
	// to its left where there is one, so a node with several callers is stacked beside the caller it
	// actually sits next to rather than beside whichever one happened to be first in the payload.
	const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const treeParent = new Map<string, string>();
	for (const node of nodes) {
		const parents = inEdges.get(node.id) ?? [];
		const own = rank.get(node.id) ?? 0;
		const parent = parents.find((p) => (rank.get(p) ?? 0) === own - 1) ?? parents[0];
		if (parent !== undefined) {
			treeParent.set(node.id, parent);
			children.get(parent)?.push(node.id);
		}
	}

	const effectiveRoots = roots.filter((r) => byId.has(r) && !treeParent.has(r));
	for (const node of nodes) {
		if (!treeParent.has(node.id) && !effectiveRoots.includes(node.id)) {
			effectiveRoots.push(node.id);
		}
	}

	const columnWidth: number[] = [];
	for (const node of nodes) {
		const column = rank.get(node.id) ?? 0;
		columnWidth[column] = Math.max(columnWidth[column] ?? 0, node.width);
	}

	// A chip is parked in the gap right after its source column even when the arrow spans several
	// columns, because the space between two columns is the only place on the canvas where no card
	// can ever be. The gap grows to fit the widest chip that lands in it.
	const gapWidth: number[] = [];
	for (let i = 0; i < columnWidth.length; i++) {
		gapWidth[i] = columnGap;
	}
	for (const chip of chips) {
		const gap = rank.get(chip.from);
		if (gap === undefined || gap >= columnWidth.length) {
			continue;
		}
		gapWidth[gap] = Math.max(gapWidth[gap] ?? columnGap, chip.width + chipPadX * 2);
	}

	const columnX: number[] = [];
	const gapX: number[] = [];
	let x = padX;
	for (let i = 0; i < columnWidth.length; i++) {
		columnX[i] = x;
		gapX[i] = x + (columnWidth[i] ?? 0);
		x += (columnWidth[i] ?? 0) + (gapWidth[i] ?? columnGap);
	}

	const positions: Record<string, { x: number; y: number }> = {};
	let cursor = padY;
	const pack = (id: string): { top: number; bottom: number } => {
		const node = byId.get(id);
		if (!node) {
			return { top: cursor, bottom: cursor };
		}
		// Packing the same node twice would move it and, on a cycle, never return.
		const placed = positions[id];
		if (placed) {
			return { top: placed.y, bottom: placed.y + node.height };
		}
		const nodeX = columnX[rank.get(id) ?? 0] ?? padX;
		const kids = children.get(id) ?? [];
		if (kids.length === 0) {
			const top = cursor;
			cursor += node.height + rowGap;
			positions[id] = { x: nodeX, y: top };
			return { top, bottom: top + node.height };
		}
		// Claim a slot before recursing so a cycle back to this node terminates.
		positions[id] = { x: nodeX, y: cursor };
		const spans = kids.map(pack);
		const top = Math.min(...spans.map((s) => s.top));
		const bottom = Math.max(...spans.map((s) => s.bottom));
		const y = (top + bottom) / 2 - node.height / 2;
		positions[id] = { x: nodeX, y };
		return { top: Math.min(top, y), bottom: Math.max(bottom, y + node.height) };
	};
	// A centred parent taller than its children's band reaches past both ends of it, so the next
	// subtree has to start below the whole span rather than below the last leaf the cursor happened
	// to see.
	for (const root of effectiveRoots) {
		const span = pack(root);
		cursor = Math.max(cursor, span.bottom + rowGap) + rowGap;
	}
	// A graph in which every node has a parent -- a pure cycle -- yields no roots at all. Pack
	// whatever is left so a node can never silently vanish from the canvas.
	for (const node of nodes) {
		if (!positions[node.id]) {
			const span = pack(node.id);
			cursor = Math.max(cursor, span.bottom + rowGap) + rowGap;
		}
	}

	// The guarantee. Centring a parent, and reusing the position of a node several callers share,
	// can both put two cards of one column on the same pixels; walking each column top to bottom and
	// pushing anything that still collides below its predecessor removes that for good. Nodes that
	// already clear each other are untouched, so the centring stays visible wherever it fits.
	const byColumn = new Map<number, string[]>();
	for (const node of nodes) {
		const column = rank.get(node.id) ?? 0;
		const list = byColumn.get(column);
		if (list) {
			list.push(node.id);
		} else {
			byColumn.set(column, [node.id]);
		}
	}
	for (const column of byColumn.values()) {
		column.sort((a, b) => {
			const top = (positions[a]?.y ?? 0) - (positions[b]?.y ?? 0);
			// Ties would otherwise resolve by Map insertion order, which is stable but arbitrary.
			return top !== 0 ? top : a.localeCompare(b);
		});
		let previousBottom = -Infinity;
		for (const id of column) {
			const position = positions[id];
			const node = byId.get(id);
			if (!position || !node) {
				continue;
			}
			position.y = Math.max(position.y, previousBottom + rowGap);
			previousBottom = position.y + node.height;
		}
	}

	// Centring can also push a card above the canvas, where it slides under the fixed toolbar. The
	// sweep never moves anything up, so one shift afterwards is enough.
	let minY = Infinity;
	for (const node of nodes) {
		minY = Math.min(minY, positions[node.id]?.y ?? 0);
	}
	if (minY < padY && minY !== Infinity) {
		const shift = padY - minY;
		for (const node of nodes) {
			const position = positions[node.id];
			if (position) {
				position.y += shift;
			}
		}
	}

	let width = padX;
	let height = padY;
	for (const node of nodes) {
		const position = positions[node.id];
		if (position) {
			width = Math.max(width, position.x + node.width);
			height = Math.max(height, position.y + node.height);
		}
	}
	// The last gap holds no chip, but the rail drawn down its middle should still be on the canvas.
	width = Math.max(width, (gapX[gapX.length - 1] ?? padX) + (gapWidth[gapWidth.length - 1] ?? 0));

	return {
		positions,
		rank: Object.fromEntries(rank),
		columnX,
		gapX,
		gapWidth,
		width: width + padX,
		height: height + padY,
	};
}

// Pushes chips that share a gap apart, top to bottom, so two arrow labels can never cover each
// other. Only the y moves: the x is already the centre of a gap no card reaches into.
export function separateChips<T extends { gap: number; y: number; height: number }>(chips: T[]): T[] {
	const byGap = new Map<number, T[]>();
	for (const chip of chips) {
		const list = byGap.get(chip.gap);
		if (list) {
			list.push(chip);
		} else {
			byGap.set(chip.gap, [chip]);
		}
	}
	for (const gap of byGap.values()) {
		gap.sort((a, b) => a.y - b.y);
		let previousBottom = -Infinity;
		for (const chip of gap) {
			chip.y = Math.max(chip.y, previousBottom + chipGapY);
			previousBottom = chip.y + chip.height;
		}
	}
	return chips;
}
