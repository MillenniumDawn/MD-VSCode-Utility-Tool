interface BridgeStep {
	to: string;
	skipped?: readonly string[];
}

interface BridgeEdge extends BridgeStep {
	from: string;
	structural?: boolean;
}

export function bridgeOverRemoved<E extends BridgeEdge>(
	edges: readonly E[],
	isRemoved: (id: string) => boolean,
	adjacency: ReadonlyMap<string, readonly BridgeStep[]>,
): E[] {
	const cache = new Map<string, { to: string; skipped: string[] }[]>();
	function bridgesFrom(start: string): { to: string; skipped: string[] }[] {
		const cached = cache.get(start);
		if (cached) {
			return cached;
		}
		const bridges: { to: string; skipped: string[] }[] = [];
		const parent = new Map<string, { from: string; skipped: readonly string[] } | undefined>([[start, undefined]]);
		const queue = [start];
		for (let i = 0; i < queue.length; i++) {
			const current = queue[i]!;
			for (const next of adjacency.get(current) ?? []) {
				if (parent.has(next.to)) {
					continue;
				}
				parent.set(next.to, { from: current, skipped: next.skipped ?? [] });
				if (isRemoved(next.to)) {
					queue.push(next.to);
				} else {
					const skipped = [...(next.skipped ?? [])];
					for (let at: string | undefined = current; at !== undefined;) {
						skipped.unshift(at);
						const previous = parent.get(at);
						skipped.unshift(...(previous?.skipped ?? []));
						at = previous?.from;
					}
					bridges.push({ to: next.to, skipped });
				}
			}
		}
		cache.set(start, bridges);
		return bridges;
	}
	return edges.flatMap(edge => edge.structural || !isRemoved(edge.to)
		? [edge]
		: bridgesFrom(edge.to).map(bridge => ({ ...edge, to: bridge.to, skipped: [...(edge.skipped ?? []), ...bridge.skipped] })));
}

export function skippedBySource(
	edges: readonly BridgeEdge[],
	owners: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const edge of edges) {
		if (!edge.skipped?.length) {
			continue;
		}
		for (const from of owners.get(edge.from) ?? [edge.from]) {
			const list = result.get(from) ?? [];
			for (const id of edge.skipped) {
				if (!list.includes(id)) {
					list.push(id);
				}
			}
			result.set(from, list);
		}
	}
	return result;
}
