import * as assert from "assert";
import { bridgeOverRemoved, skippedBySource } from "../../../webviewsrc/util/graphbridge";

type Edge = { from: string; to: string; skipped?: string[]; structural?: boolean; weight?: number };
function bridge(edges: Edge[], removed: string[]): Edge[] {
	const adjacency = new Map<string, Edge[]>();
	for (const edge of edges) {
		if (!edge.structural) {
			adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
		}
	}
	return bridgeOverRemoved(edges.filter(e => !removed.includes(e.from)), id => removed.includes(id), adjacency);
}

describe("graph bridge", () => {
	it("keeps prior skipped ids on both incoming and downstream edges when re-bridged", () => {
		const edges: Edge[] = [
			{ from: "a", to: "x", weight: 30 }, { from: "x", to: "b" },
			{ from: "b", to: "y" }, { from: "y", to: "c" },
		];
		const once = bridge(edges, ["x", "y"]);
		assert.deepStrictEqual(bridge(once, ["b"]), [{ from: "a", to: "c", weight: 30, skipped: ["x", "b", "y"] }]);
		assert.strictEqual(edges[0].skipped, undefined);
	});

	it("uses the shortest removed-node path, terminates cycles and drops dead ends", () => {
		const edges: Edge[] = [
			{ from: "a", to: "b" }, { from: "a2", to: "b" },
			{ from: "b", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "b" },
			{ from: "b", to: "d" }, { from: "c", to: "d" }, { from: "b", to: "dead" },
			{ from: "a", to: "dead" },
		];
		assert.deepStrictEqual(bridge(edges, ["b", "c", "dead"]), [
			{ from: "a", to: "d", skipped: ["b"] }, { from: "a2", to: "d", skipped: ["b"] },
		]);
	});

	it("preserves structural and surviving edges without changing their metadata", () => {
		const structural = { from: "category", to: "b", structural: true };
		const surviving = { from: "a", to: "missing", skipped: ["old"] };
		assert.deepStrictEqual(bridge([structural, surviving], ["b"]), [structural, surviving]);
	});

	it("accumulates unique skipped ids for every owner of an option in encounter order", () => {
		const edges = [{ from: "option", to: "c", skipped: ["x", "x", "y"] }, { from: "a", to: "d", skipped: ["y", "z"] }];
		assert.deepStrictEqual([...skippedBySource(edges, new Map([["option", ["a", "b"]]]))], [
			["a", ["x", "y", "z"]], ["b", ["x", "y"]],
		]);
	});
});
