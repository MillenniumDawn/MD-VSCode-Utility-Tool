import { nextFrame } from "./setup";
import * as assert from "assert";
import { renderGraph, wireIsolation } from "../../../webviewsrc/util/graphview";

// The canvas the decision and event previews both draw. It knows a node only by its id and an edge
// only by its two ends, so the fixtures here are the smallest thing that satisfies that.
interface TestNode {
	id: string;
}

interface TestEdge {
	from: string;
	to: string;
	guarded?: boolean;
	label?: string;
}

describe("webview/util/graphview", () => {
	let previousBody = "";
	let content: HTMLDivElement;

	before(() => {
		previousBody = document.body.innerHTML;
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	beforeEach(() => {
		content = document.createElement("div");
		document.body.appendChild(content);
	});

	afterEach(() => {
		content.remove();
	});

	function render(
		nodes: TestNode[],
		edges: TestEdge[],
		roots: string[],
		railLabel?: (step: number) => string,
	) {
		return renderGraph<TestNode, TestEdge>({
			content,
			nodes,
			edges,
			roots,
			buildCard: (node) => {
				const card = document.createElement("div");
				card.className = "ev-card";
				card.textContent = node.id;
				return card;
			},
			chipGuarded: (edge) => edge.guarded === true,
			chipText: (edge) => edge.label ?? "",
			edgeClass: (edge, guarded) => "ev-edge" + (guarded ? " ev-edge-guarded" : ""),
			railLabel,
		});
	}

	const chain = (): [TestNode[], TestEdge[], string[]] => [
		[{ id: "a" }, { id: "b" }, { id: "c" }],
		[
			{ from: "a", to: "b", label: "activates" },
			{ from: "b", to: "c" },
		],
		["a"],
	];

	it("draws one positioned wrapper per node, tagged with its id", () => {
		const [nodes, edges, roots] = chain();
		const result = render(nodes, edges, roots);

		const boxes = Array.from(content.querySelectorAll<HTMLDivElement>(".ev-node"));
		assert.strictEqual(boxes.length, 3);
		assert.deepStrictEqual(
			boxes.map((box) => box.dataset.id),
			["a", "b", "c"],
		);
		assert.strictEqual(result.rendered.length, 3);
		// The wrapper is what hover isolation dims; the card inside it is what search highlights.
		assert.notStrictEqual(result.rendered[0]!.element, result.rendered[0]!.card);
		assert.strictEqual(result.rendered[0]!.card.parentElement, result.rendered[0]!.element);
	});

	// The cards are built hidden so they can be measured before the layout knows where they go, and
	// nothing may be left that way once it does.
	it("reveals every card once the layout has placed it", () => {
		const [nodes, edges, roots] = chain();
		render(nodes, edges, roots);

		for (const box of Array.from(content.querySelectorAll<HTMLDivElement>(".ev-node"))) {
			assert.strictEqual(box.style.visibility, "");
			assert.ok(box.style.left.endsWith("px"));
			assert.ok(box.style.top.endsWith("px"));
		}
	});

	it("draws one curve per edge, classed by the caller", () => {
		const result = render(
			[{ id: "a" }, { id: "b" }],
			[{ from: "a", to: "b", guarded: true, label: "is_subject = yes" }],
			["a"],
		);

		const paths = content.querySelectorAll("svg.ev-edges path");
		assert.strictEqual(paths.length, 1);
		assert.strictEqual(paths[0]!.getAttribute("class"), "ev-edge ev-edge-guarded");
		assert.ok(paths[0]!.getAttribute("d")?.startsWith("M"));
		assert.strictEqual(result.renderedEdges.length, 1);
	});

	it("gives an arrow a label only when the caller writes one", () => {
		const [nodes, edges, roots] = chain();
		render(nodes, edges, roots);

		const chips = content.querySelectorAll(".ev-chip");
		assert.strictEqual(chips.length, 1);
		assert.strictEqual(chips[0]!.textContent, "activates");
		assert.strictEqual((chips[0] as HTMLDivElement).style.visibility, "");
	});

	it("marks a guarded label so the stylesheet can tell it apart", () => {
		render([{ id: "a" }, { id: "b" }], [{ from: "a", to: "b", guarded: true, label: "tag = FROM" }], [
			"a",
		]);

		assert.ok(content.querySelector(".ev-chip")?.classList.contains("ev-chip-guarded"));
	});

	// An edge can point at something the payload never defined. It has nowhere to be drawn, and its
	// label must not be left behind at the top left of the canvas.
	it("drops an arrow, and its label, that points at a node not on the canvas", () => {
		const result = render(
			[{ id: "a" }],
			[{ from: "a", to: "nowhere", label: "activates" }],
			["a"],
		);

		assert.strictEqual(content.querySelectorAll("svg.ev-edges path").length, 0);
		assert.strictEqual(content.querySelectorAll(".ev-chip").length, 0);
		assert.strictEqual(result.renderedEdges.length, 0);
	});

	it("numbers the rails only when asked to", () => {
		const [nodes, edges, roots] = chain();

		render(nodes, edges, roots);
		const plain = Array.from(content.querySelectorAll(".ev-rail"));
		assert.ok(plain.length > 0);
		assert.ok(plain.every((rail) => rail.childElementCount === 0));

		content.textContent = "";
		render(nodes, edges, roots, (step) => `step ${step}`);
		const labelled = Array.from(content.querySelectorAll(".ev-rail"));
		assert.strictEqual(labelled.length, plain.length);
		assert.deepStrictEqual(
			labelled.map((rail) => rail.textContent),
			labelled.map((_, i) => `step ${i + 1}`),
		);
	});

	it("records where each node's arrows lead", () => {
		const [nodes, edges, roots] = chain();
		const result = render(nodes, edges, roots);

		assert.deepStrictEqual(result.childrenById.get("a"), ["b"]);
		assert.deepStrictEqual(result.childrenById.get("b"), ["c"]);
		assert.strictEqual(result.childrenById.get("c"), undefined);
	});

	describe("chain isolation", () => {
		const dimmed = (result: ReturnType<typeof render>) =>
			result.rendered
				.filter((item) => item.element.classList.contains("ev-dim"))
				.map((item) => item.node.id);

		const fire = (item: { element: HTMLElement }, type: string) =>
			item.element.dispatchEvent(new (window as any).Event(type));

		// The ids of the cards whose attributes change until the returned function is called, which
		// also hands them back. An arrow shows as "edge".
		const watchChanges = () => {
			const touched: string[] = [];
			const note = (records: MutationRecord[]) => {
				for (const record of records) {
					touched.push((record.target as Element).getAttribute("data-id") ?? "edge");
				}
			};
			const observer = new (window as any).MutationObserver(note);
			observer.observe(content, { attributes: true, subtree: true });
			return () => {
				note(observer.takeRecords());
				observer.disconnect();
				return touched;
			};
		};

		// One root with two branches, so moving from one branch to the other leaves the root and
		// both arrows dimmed throughout.
		const fork = (): [TestNode[], TestEdge[], string[]] => [
			[{ id: "r" }, { id: "x" }, { id: "y" }],
			[
				{ from: "r", to: "x" },
				{ from: "r", to: "y" },
			],
			["r"],
		];

		it("dims everything the hovered node does not reach", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[1]!, "mouseenter");
			await nextFrame();

			// b reaches c, and nothing reaches back up to a.
			assert.deepStrictEqual(dimmed(result), ["a"]);
			assert.ok(result.renderedEdges[0]!.path.classList.contains("ev-edge-dim"));
			assert.ok(!result.renderedEdges[1]!.path.classList.contains("ev-edge-dim"));
		});

		it("dims nothing when the whole chain is downstream", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[0]!, "mouseenter");
			await nextFrame();

			assert.deepStrictEqual(dimmed(result), []);
		});

		it("puts the canvas back when the pointer leaves", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();
			assert.deepStrictEqual(dimmed(result), ["a", "b"]);

			fire(result.rendered[2]!, "mouseleave");
			await nextFrame();
			assert.deepStrictEqual(dimmed(result), []);
		});

		it("dims the arrow labels with their arrows", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);
			const chip = result.renderedEdges[0]!.chip!;

			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();
			assert.ok(chip.classList.contains("ev-dim"));

			fire(result.rendered[2]!, "mouseleave");
			await nextFrame();
			assert.ok(!chip.classList.contains("ev-dim"));
		});

		it("lights a chain that loops back on itself without walking it forever", async () => {
			const result = render(
				[{ id: "a" }, { id: "b" }, { id: "c" }],
				[
					{ from: "a", to: "b" },
					{ from: "b", to: "a" },
				],
				["a"],
			);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[1]!, "mouseenter");
			await nextFrame();

			assert.deepStrictEqual(dimmed(result), ["c"]);
		});

		// The leave and the enter of a card-to-card move arrive in one task, and the frame after it is
		// the first one that can show either.
		it("waits for the next frame before dimming", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[2]!, "mouseenter");
			assert.deepStrictEqual(dimmed(result), []);

			await nextFrame();
			assert.deepStrictEqual(dimmed(result), ["a", "b"]);
		});

		it("touches only the cards whose state changes when the pointer moves to the next card", async () => {
			const [nodes, edges, roots] = fork();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);
			fire(result.rendered[1]!, "mouseenter");
			await nextFrame();
			assert.deepStrictEqual(dimmed(result), ["r", "y"]);

			const stop = watchChanges();
			fire(result.rendered[1]!, "mouseleave");
			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();
			const touched = stop();

			// The root and both arrows stay dimmed, so only the two branch cards change.
			assert.deepStrictEqual(touched.sort(), ["x", "y"]);
			assert.deepStrictEqual(dimmed(result), ["r", "x"]);
		});

		it("draws only the last transition made within one frame", async () => {
			const [nodes, edges, roots] = fork();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);
			const stop = watchChanges();

			fire(result.rendered[1]!, "mouseenter");
			fire(result.rendered[1]!, "mouseleave");
			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();
			const touched = stop();

			// The branch x was never drawn as lit, so y is never dimmed and then lit again, and the
			// root and arrows are dimmed once each.
			assert.deepStrictEqual(touched.sort(), ["edge", "edge", "r", "x"]);
			assert.deepStrictEqual(dimmed(result), ["r", "x"]);
		});

		it("keeps the chain lit when the pointer leaves and comes back in one frame", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);
			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();

			fire(result.rendered[2]!, "mouseleave");
			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();

			assert.deepStrictEqual(dimmed(result), ["a", "b"]);
		});

		// What the drag sweep calls: nothing may be left hanging over the canvas while it is moved.
		it("clears from the handle, for a drag that never touched a card", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			const isolation = wireIsolation(
				result.rendered,
				result.renderedEdges,
				result.childrenById,
			);

			fire(result.rendered[2]!, "mouseenter");
			await nextFrame();
			assert.notDeepStrictEqual(dimmed(result), []);

			isolation.clear();
			assert.deepStrictEqual(dimmed(result), []);
			assert.ok(result.renderedEdges.every((item) => !item.path.classList.contains("ev-edge-dim")));
		});

		// A drag that starts between an enter and the frame that would draw it must not be followed
		// by the chain lighting up under the dragged canvas.
		it("drops a queued enter when the handle clears", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			const isolation = wireIsolation(
				result.rendered,
				result.renderedEdges,
				result.childrenById,
			);

			fire(result.rendered[2]!, "mouseenter");
			isolation.clear();
			await nextFrame();

			assert.deepStrictEqual(dimmed(result), []);
		});

		// Keyboard focus is the same signal as the pointer, so a reader tabbing through the cards
		// sees the same chain light up.
		it("isolates on focus as well as on hover", async () => {
			const [nodes, edges, roots] = chain();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);

			fire(result.rendered[1]!, "focusin");
			await nextFrame();
			assert.deepStrictEqual(dimmed(result), ["a"]);

			fire(result.rendered[1]!, "focusout");
			await nextFrame();
			assert.deepStrictEqual(dimmed(result), []);
		});

		it("moves the chain with keyboard focus without a pass in between", async () => {
			const [nodes, edges, roots] = fork();
			const result = render(nodes, edges, roots);
			wireIsolation(result.rendered, result.renderedEdges, result.childrenById);
			fire(result.rendered[1]!, "focusin");
			await nextFrame();

			fire(result.rendered[1]!, "focusout");
			fire(result.rendered[2]!, "focusin");
			await nextFrame();

			assert.deepStrictEqual(dimmed(result), ["r", "x"]);
		});

		// Re-rendering a preview empties the canvas and wires a new graph, and nothing tells the old
		// wiring. Its frame must not go on to restyle cards that are no longer on the page.
		it("does not touch a graph that was replaced before its frame ran", async () => {
			const [nodes, edges, roots] = chain();
			const old = render(nodes, edges, roots);
			wireIsolation(old.rendered, old.renderedEdges, old.childrenById);
			fire(old.rendered[2]!, "mouseenter");

			content.textContent = "";
			const next = render(nodes, edges, roots);
			wireIsolation(next.rendered, next.renderedEdges, next.childrenById);
			await nextFrame();

			assert.deepStrictEqual(dimmed(old), []);
			assert.ok(old.renderedEdges.every((item) => !item.path.classList.contains("ev-edge-dim")));
			assert.deepStrictEqual(dimmed(next), []);
		});
	});
});
