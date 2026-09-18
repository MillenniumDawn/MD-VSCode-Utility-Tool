import { takePostedMessages } from "./setup";
import * as assert from "assert";
import {
	DecisionGraphDecisionNode,
	DecisionGraphEdge,
	DecisionGraphNode,
	DecisionGraphPayload,
} from "../../previewdef/decision/payload";

// decisiontree.ts reads window.decisionGraph at module scope, so the payload has to exist before the
// import runs. This mirrors Millennium Dawn's Polish state-controlled economy category: one tab with
// a custom GUI, a plain decision that starts a mission, and a countdown mission that ends it.
function decision(
	id: string,
	extra: Partial<DecisionGraphDecisionNode> = {},
): DecisionGraphDecisionNode {
	return {
		kind: "decision",
		id: "d:" + id,
		decisionId: id,
		category: "POL_state_controlled_economy_category",
		name: { key: id, text: id },
		desc: { key: id + "_desc", text: "" },
		borrowsName: false,
		iconCount: 0,
		isMission: false,
		fireOnlyOnce: false,
		badges: [],
		modifiers: [],
		allowed: true,
		hasAllowed: false,
		available: true,
		hasAvailable: false,
		visible: true,
		hasVisible: false,
		activation: true,
		hasActivation: false,
		cancelTrigger: true,
		hasCancelTrigger: false,
		effects: [],
		...extra,
	};
}

const integrationPayload: DecisionGraphPayload = {
	roots: ["c:POL_state_controlled_economy_category"],
	conditionExprs: [],
	effectBlocks: [[{ kind: "line", scopeName: "", content: "add_political_power = 50" }]],
	toolbarFlags: {
		hasMissions: true,
		hasDecisions: true,
		hasChains: true,
		hasEffects: true,
		hasModifiers: true,
		hasTargets: true,
		hasScriptedGui: true,
		hasConditions: true,
		hasIcons: true,
		hasLocalisation: true,
		hasUnresolvedScriptedGui: false,
	},
	nodes: [
		{
			kind: "category",
			id: "c:POL_state_controlled_economy_category",
			categoryKey: "POL_state_controlled_economy_category",
			name: { key: "POL_state_controlled_economy_category", text: "State Controlled Economy" },
			desc: { key: "POL_state_controlled_economy_category_desc", text: "" },
			icon: { styleKey: "st-decision-icon-poland", width: 32, height: 32 },
			priority: 900,
			visibleWhenEmpty: true,
			allowed: true,
			hasAllowed: false,
			visible: true,
			hasVisible: false,
			defined: true,
			scriptedGui: {
				name: "POL_sre_gui",
				windowName: "POL_SRE_WINDOW",
				html: '<div class="dec-gui-window" style="width:800px;height:600px"><span>window</span></div>',
			},
			nav: { start: 0, end: 10, file: "common/decisions/Poland.txt" },
		},
		decision("POL_start_sre", {
			name: { key: "POL_start_sre", text: "Begin the plan" },
			icon: { styleKey: "st-decision-icon-generic", width: 32, height: 32 },
			iconCount: 1,
			badges: ["Cost 100"],
			effects: [{ name: "complete_effect", ref: 0 }],
			hasAvailable: true,
			available: { scopeName: "", nodeContent: "has_war = no" },
			modifiers: [
				{ key: "stability_weekly", name: "Weekly Stability", value: "-0.1%", tone: "bad" },
			],
			nav: { start: 20, end: 30, file: "common/decisions/Poland.txt" },
		}),
		decision("POL_sre_main_countdown_mission", {
			name: { key: "POL_sre_main_countdown_mission", text: "Plan running" },
			isMission: true,
			daysMissionTimeout: 365,
			isGood: false,
			selectableMission: false,
			effects: [{ name: "timeout_effect", ref: 0 }],
		}),
		{
			kind: "unresolved",
			id: "u:POL_elsewhere",
			decisionId: "POL_elsewhere",
			name: { key: "POL_elsewhere", text: "POL_elsewhere" },
		},
	],
	edges: [
		structural("c:POL_state_controlled_economy_category", "d:POL_start_sre"),
		structural("c:POL_state_controlled_economy_category", "d:POL_sre_main_countdown_mission"),
		call("d:POL_start_sre", "d:POL_sre_main_countdown_mission", "activate"),
		call("d:POL_sre_main_countdown_mission", "u:POL_elsewhere", "remove"),
	],
};

function structural(from: string, to: string): DecisionGraphEdge {
	return { from, to, structural: true, condition: true };
}

function call(from: string, to: string, kind: "activate" | "unlock" | "remove"): DecisionGraphEdge {
	return {
		from,
		to,
		structural: false,
		kind,
		fromBlock: "complete_effect",
		condition: true,
	};
}

(global as any).window.decisionGraph = integrationPayload;

// The shell the host renders. Installed from the rendering suite's before hook rather than at module
// scope: every webview test file shares one jsdom document, and writing body.innerHTML here would
// clobber whichever other file's fixture happened to load after this one.
const shellHtml = `
    <div class="toolbar-outer"><div class="toolbar">
        <input type="checkbox" id="show-localisation">
        <input type="checkbox" id="show-icon">
        <input type="checkbox" id="show-conditions">
        <input type="checkbox" id="show-effects">
        <input type="checkbox" id="show-scripted-gui">
        <input type="checkbox" id="collapse-categories">
        <div id="dec-filter-container">
            <div class="select-container">
                <div id="dec-filters" class="select multiple-select" tabindex="0" role="combobox">
                    <span class="value"></span>
                    <div class="option" value="missions">Missions</div>
                    <div class="option" value="decisions">Decisions</div>
                    <div class="option" value="chains">In a chain</div>
                    <div class="option" value="effects">Has effects</div>
                    <div class="option" value="modifiers">Has modifiers</div>
                    <div class="option" value="conditions">Has conditions</div>
                    <div class="option" value="scriptedgui">Custom GUI</div>
                </div>
            </div>
        </div>
        <input type="text" id="dec-searchbox">
        <span id="dec-search-count"></span>
    </div></div>
    <div id="dragger"></div>
    <div id="decisiontreecontent"></div>`;

const decisiontree =
	require("../../../webviewsrc/decisiontree") as typeof import("../../../webviewsrc/decisiontree");

describe("webview/decisiontree readFilters", () => {
	it("keeps only known filters, in the canonical order", () => {
		assert.deepStrictEqual(decisiontree.readFilters(["chains", "missions"]), [
			"missions",
			"chains",
		]);
	});

	it("drops anything that is not a filter, including a restored value from an older build", () => {
		assert.deepStrictEqual(decisiontree.readFilters(["nonsense", 7, null]), []);
		assert.deepStrictEqual(decisiontree.readFilters("missions"), []);
		assert.deepStrictEqual(decisiontree.readFilters(undefined), []);
	});
});

describe("webview/decisiontree chainedIds", () => {
	it("collects both ends of every call, and ignores the structural edges", () => {
		const linked = decisiontree.chainedIds(integrationPayload.edges);

		assert.ok(linked.has("d:POL_start_sre"));
		assert.ok(linked.has("d:POL_sre_main_countdown_mission"));
		assert.ok(linked.has("u:POL_elsewhere"));
		assert.ok(!linked.has("c:POL_state_controlled_economy_category"));
	});
});

describe("webview/decisiontree filteredGraph", () => {
	it("shows the whole file when nothing is selected", () => {
		const graph = decisiontree.filteredGraph(integrationPayload, []);

		assert.strictEqual(graph.nodes.length, integrationPayload.nodes.length);
		assert.strictEqual(graph.edges.length, integrationPayload.edges.length);
	});

	it("keeps the category of a decision that survived, so a tab is never drawn empty", () => {
		const graph = decisiontree.filteredGraph(integrationPayload, ["missions"]);
		const ids = graph.nodes.map((n) => n.id);

		assert.ok(ids.includes("d:POL_sre_main_countdown_mission"));
		assert.ok(ids.includes("c:POL_state_controlled_economy_category"));
		assert.ok(!ids.includes("d:POL_start_sre"));
	});

	it("drops a category once none of its decisions are left", () => {
		const onlyMission: DecisionGraphPayload = {
			...integrationPayload,
			nodes: integrationPayload.nodes.filter((n) => n.id !== "d:POL_sre_main_countdown_mission"),
			edges: integrationPayload.edges.filter((e) => e.to !== "d:POL_sre_main_countdown_mission"),
		};
		const graph = decisiontree.filteredGraph(onlyMission, ["missions"]);

		assert.deepStrictEqual(graph.nodes, []);
	});

	it("selects the tab itself, not its buttons, for the custom GUI filter", () => {
		const graph = decisiontree.filteredGraph(integrationPayload, ["scriptedgui"]);
		const ids = graph.nodes.map((n) => n.id);

		assert.ok(ids.includes("c:POL_state_controlled_economy_category"));
		// The tab is kept with its decisions, or it would be drawn with nothing in it.
		assert.ok(ids.includes("d:POL_start_sre"));
	});

	it("treats several selections as an OR", () => {
		const graph = decisiontree.filteredGraph(integrationPayload, ["missions", "decisions"]);
		const ids = graph.nodes.map((n) => n.id);

		assert.ok(ids.includes("d:POL_start_sre"));
		assert.ok(ids.includes("d:POL_sre_main_countdown_mission"));
	});

	it("keeps the placeholder a surviving decision calls, so the arrow off the file is not lost", () => {
		const graph = decisiontree.filteredGraph(integrationPayload, ["missions"]);

		assert.ok(graph.nodes.some((n) => n.id === "u:POL_elsewhere"));
		assert.ok(
			graph.edges.some((e) => e.from === "d:POL_sre_main_countdown_mission" && e.to === "u:POL_elsewhere"),
		);
	});

	it("bridges a call that ran through a decision the filter removed", () => {
		// Filtering to missions removes POL_start_sre, which is where the chain begins; nothing points
		// at it, so there is nothing to bridge and the remaining call survives on its own.
		const chain: DecisionGraphPayload = {
			...integrationPayload,
			nodes: [
				...integrationPayload.nodes,
				decision("POL_middle_step"),
				decision("POL_final_mission", { isMission: true, daysMissionTimeout: 10 }),
			],
			edges: [
				...integrationPayload.edges,
				structural("c:POL_state_controlled_economy_category", "d:POL_middle_step"),
				structural("c:POL_state_controlled_economy_category", "d:POL_final_mission"),
				call("d:POL_sre_main_countdown_mission", "d:POL_middle_step", "activate"),
				call("d:POL_middle_step", "d:POL_final_mission", "activate"),
			],
		};

		const graph = decisiontree.filteredGraph(chain, ["missions"]);
		const ids = graph.nodes.map((n) => n.id);
		assert.ok(!ids.includes("d:POL_middle_step"), "the middle step is filtered out");

		const bridged = graph.edges.find(
			(e) => e.from === "d:POL_sre_main_countdown_mission" && e.to === "d:POL_final_mission",
		);
		assert.ok(bridged, "the chain must keep its arrow across the removed decision");
		assert.deepStrictEqual(bridged?.skipped, ["d:POL_middle_step"]);
	});

	it("bridges every caller of a removed decision, each with its own record of what was skipped", () => {
		// Two missions call the same removed step, which calls a removed step of its own before
		// reaching two kept missions. The walk from the removed step runs once for both callers;
		// what each arrow reports must not change for it, and the arrows must not share an array.
		const category = "c:POL_state_controlled_economy_category";
		const chain: DecisionGraphPayload = {
			...integrationPayload,
			nodes: [
				...integrationPayload.nodes,
				decision("POL_other_mission", { isMission: true, daysMissionTimeout: 10 }),
				decision("POL_step_x"),
				decision("POL_step_y"),
				decision("POL_end_1", { isMission: true, daysMissionTimeout: 10 }),
				decision("POL_end_2", { isMission: true, daysMissionTimeout: 10 }),
			],
			edges: [
				...integrationPayload.edges,
				structural(category, "d:POL_other_mission"),
				structural(category, "d:POL_step_x"),
				structural(category, "d:POL_step_y"),
				structural(category, "d:POL_end_1"),
				structural(category, "d:POL_end_2"),
				call("d:POL_sre_main_countdown_mission", "d:POL_step_x", "activate"),
				call("d:POL_other_mission", "d:POL_step_x", "unlock"),
				call("d:POL_step_x", "d:POL_step_y", "activate"),
				call("d:POL_step_x", "d:POL_end_2", "activate"),
				call("d:POL_step_y", "d:POL_end_1", "activate"),
			],
		};

		const graph = decisiontree.filteredGraph(chain, ["missions"]);
		const from = (id: string) => graph.edges.filter((e) => e.from === id && e.skipped !== undefined);

		const first = from("d:POL_sre_main_countdown_mission");
		const second = from("d:POL_other_mission");
		assert.deepStrictEqual(first.map((e) => [e.to, e.skipped]), [
			["d:POL_end_2", ["d:POL_step_x", "d:POL_step_y"]],
			["d:POL_end_1", ["d:POL_step_x", "d:POL_step_y"]],
		]);
		assert.deepStrictEqual(second.map((e) => [e.to, e.kind, e.skipped]), [
			["d:POL_end_2", "unlock", ["d:POL_step_x", "d:POL_step_y"]],
			["d:POL_end_1", "unlock", ["d:POL_step_x", "d:POL_step_y"]],
		]);
		assert.notStrictEqual(first[0]!.skipped, second[0]!.skipped);
		assert.notStrictEqual(first[0]!.skipped, first[1]!.skipped);
	});
});

describe("webview/decisiontree matchesQuery", () => {
	const node = integrationPayload.nodes.find(
		(n) => n.id === "d:POL_start_sre",
	) as DecisionGraphNode;

	it("matches the id, the localised name and the category", () => {
		assert.ok(decisiontree.matchesQuery(node, "pol_start"));
		assert.ok(decisiontree.matchesQuery(node, "begin the plan"));
		assert.ok(decisiontree.matchesQuery(node, "state_controlled"));
	});

	it("matches a modifier by the token the file was written with", () => {
		assert.ok(decisiontree.matchesQuery(node, "stability_weekly"));
	});

	it("matches a badge, so a cost or a target list is findable", () => {
		assert.ok(decisiontree.matchesQuery(node, "cost 100"));
	});

	it("does not match something the card never says", () => {
		assert.ok(!decisiontree.matchesQuery(node, "zzz"));
	});
});

describe("webview/decisiontree chipTextFor", () => {
	it("says nothing on a structural edge, which is the file's shape rather than an action", () => {
		assert.strictEqual(decisiontree.chipTextFor(structural("c:a", "d:b"), false), "");
	});

	it("names what one decision does to another", () => {
		assert.ok(decisiontree.chipTextFor(call("d:a", "d:b", "activate"), false).length > 0);
		assert.notStrictEqual(
			decisiontree.chipTextFor(call("d:a", "d:b", "activate"), false),
			decisiontree.chipTextFor(call("d:a", "d:b", "remove"), false),
		);
	});

	it("adds the random_list weight and the count of what a filter took out", () => {
		const weighted = { ...call("d:a", "d:b", "activate"), possibility: 70 };
		assert.ok(decisiontree.chipTextFor(weighted, false).includes("70"));

		const bridged = { ...call("d:a", "d:b", "activate"), skipped: ["d:x", "d:y"] };
		assert.ok(decisiontree.chipTextFor(bridged, false).includes("2"));
	});
});

describe("webview/decisiontree readCollapseExceptions", () => {
	it("keeps only the strings of a stored list, and nothing from anything else", () => {
		assert.deepStrictEqual(decisiontree.readCollapseExceptions(["a", 7, null, "b"]), ["a", "b"]);
		assert.deepStrictEqual(decisiontree.readCollapseExceptions("a"), []);
		assert.deepStrictEqual(decisiontree.readCollapseExceptions(undefined), []);
	});
});

describe("webview/decisiontree collapseCategories", () => {
	const category = "c:POL_state_controlled_economy_category";
	const other = "c:POL_other_category";

	// A second tab whose decisions are called from the first tab's mission and call back into it,
	// so a chain crosses the collapsed tab in both directions.
	function twoTabs(): DecisionGraphPayload {
		return {
			...integrationPayload,
			nodes: [
				...integrationPayload.nodes,
				{
					kind: "category",
					id: other,
					categoryKey: "POL_other_category",
					name: { key: "POL_other_category", text: "Other" },
					desc: { key: "POL_other_category_desc", text: "" },
					priority: 1,
					visibleWhenEmpty: false,
					allowed: true,
					hasAllowed: false,
					visible: true,
					hasVisible: false,
					defined: true,
					nav: { start: 40, end: 50, file: "common/decisions/Poland.txt" },
				},
				decision("POL_other_step", { category: "POL_other_category" }),
				decision("POL_other_end", { category: "POL_other_category" }),
			],
			edges: [
				...integrationPayload.edges,
				structural(other, "d:POL_other_step"),
				structural(other, "d:POL_other_end"),
				call("d:POL_sre_main_countdown_mission", "d:POL_other_step", "activate"),
				call("d:POL_other_step", "d:POL_other_end", "activate"),
				call("d:POL_other_end", "d:POL_start_sre", "unlock"),
			],
		};
	}

	it("leaves the graph alone when nothing is collapsed", () => {
		const filtered = decisiontree.filteredGraph(twoTabs(), []);
		const { graph, hidden } = decisiontree.collapseCategories(filtered, () => false);

		assert.strictEqual(graph, filtered);
		assert.strictEqual(hidden.size, 0);
	});

	it("takes a collapsed tab's decisions away and keeps the tab, with a record of what it hides", () => {
		const filtered = decisiontree.filteredGraph(twoTabs(), []);
		const { graph, hidden } = decisiontree.collapseCategories(filtered, (id) => id === other);
		const ids = graph.nodes.map((n) => n.id);

		assert.ok(ids.includes(other), "the collapsed tab stays so it can be opened again");
		assert.ok(!ids.includes("d:POL_other_step"));
		assert.ok(!ids.includes("d:POL_other_end"));
		assert.ok(ids.includes("d:POL_start_sre"), "the open tab is untouched");
		assert.deepStrictEqual(hidden.get(other), ["d:POL_other_step", "d:POL_other_end"]);
		assert.ok(graph.roots.includes(other));
	});

	it("bridges a chain that runs through a collapsed tab and drops the calls that start inside it", () => {
		const filtered = decisiontree.filteredGraph(twoTabs(), []);
		const { graph } = decisiontree.collapseCategories(filtered, (id) => id === other);

		const bridged = graph.edges.find(
			(e) => e.from === "d:POL_sre_main_countdown_mission" && e.to === "d:POL_start_sre",
		);
		assert.ok(bridged, "the call through the collapsed tab keeps its arrow");
		assert.deepStrictEqual(bridged?.skipped, ["d:POL_other_step", "d:POL_other_end"]);
		assert.ok(!graph.edges.some((e) => e.from === "d:POL_other_end"));
	});

	it("keeps a placeholder a chain still reaches, and drops one only a hidden decision pointed at", () => {
		// The other tab's chain runs through the collapsed tab and on to the placeholder, so the
		// bridged arrow keeps it on the canvas.
		const filtered = decisiontree.filteredGraph(twoTabs(), []);
		const reached = decisiontree.collapseCategories(filtered, (id) => id === category).graph;
		assert.ok(reached.nodes.some((n) => n.id === "u:POL_elsewhere"));
		assert.ok(reached.edges.some((e) => e.from === "d:POL_other_end" && e.to === "u:POL_elsewhere"));

		// With only the one tab, nothing visible points at the placeholder any more.
		const alone = decisiontree.filteredGraph(integrationPayload, []);
		const dropped = decisiontree.collapseCategories(alone, (id) => id === category).graph;
		assert.ok(!dropped.nodes.some((n) => n.id === "u:POL_elsewhere"));
	});

	it("keeps what a filter already skipped when a collapse bridges the same arrow again", () => {
		const chain = twoTabs();
		chain.nodes = [
			...chain.nodes,
			decision("POL_far_mission", { isMission: true, daysMissionTimeout: 10 }),
		];
		chain.edges = [
			...chain.edges,
			structural(category, "d:POL_far_mission"),
			call("d:POL_start_sre", "d:POL_far_mission", "activate"),
		];
		// Missions only: POL_start_sre goes, so the arrow into it from the other tab is bridged on to
		// the far mission with POL_start_sre skipped. Collapsing the other tab then bridges the
		// mission's call into it through both of its steps, on top of that.
		const filtered = decisiontree.filteredGraph(chain, ["missions"]);
		const { graph } = decisiontree.collapseCategories(filtered, (id) => id === other);

		const bridged = graph.edges.find(
			(e) => e.from === "d:POL_sre_main_countdown_mission" && e.to === "d:POL_far_mission",
		);
		assert.deepStrictEqual(bridged?.skipped, [
			"d:POL_other_step",
			"d:POL_other_end",
			"d:POL_start_sre",
		]);
	});
});

describe("webview/decisiontree rendering", () => {
	let previousBody = "";

	before(() => {
		previousBody = document.body.innerHTML;
		document.body.innerHTML = shellHtml;
		window.dispatchEvent(new Event("load"));
	});

	after(() => {
		document.body.innerHTML = previousBody;
	});

	function cards(): HTMLElement[] {
		return Array.from(document.querySelectorAll("#decisiontreecontent .ev-card"));
	}

	function storedState(): Record<string, any> {
		return (global as any).acquireVsCodeApi().getState();
	}

	function cardFor(id: string): HTMLElement {
		const node = document.querySelector(`#decisiontreecontent .ev-node[data-id="${id}"]`);
		assert.ok(node, `expected a node for ${id}`);
		return node!.querySelector(".ev-card") as HTMLElement;
	}

	it("draws a card for every node", () => {
		assert.strictEqual(cards().length, integrationPayload.nodes.length);
	});

	it("draws an arrow for every edge", () => {
		const paths = document.querySelectorAll("#decisiontreecontent svg path.ev-edge");
		assert.strictEqual(paths.length, integrationPayload.edges.length);
	});

	it("marks a mission apart from a plain decision", () => {
		assert.ok(cardFor("d:POL_sre_main_countdown_mission").classList.contains("dec-card-mission"));
		assert.ok(cardFor("d:POL_start_sre").classList.contains("dec-card-decision"));
		assert.ok(
			cardFor("d:POL_sre_main_countdown_mission").querySelector(".dec-marker-mission"),
			"a mission wears the mission glyph",
		);
	});

	it("shows the mission countdown and reads is_good as a threat", () => {
		const card = cardFor("d:POL_sre_main_countdown_mission");
		assert.ok(card.textContent?.includes("365"));
		assert.ok(card.querySelector(".dec-badge-threat"), "a bad mission's timer is a threat");
	});

	it("says the category is drawn by a custom GUI", () => {
		const card = cardFor("c:POL_state_controlled_economy_category");
		assert.ok(card.querySelector(".dec-badge-gui"));
		assert.ok(card.textContent?.includes("POL_sre_gui"));
	});

	it("keeps the custom GUI window out of the card until the toggle asks for it", () => {
		const card = cardFor("c:POL_state_controlled_economy_category");
		assert.strictEqual(card.querySelector(".dec-gui-frame"), null);
	});

	it("draws and scales the custom GUI window once the toggle is on", () => {
		const toggle = document.getElementById("show-scripted-gui") as HTMLInputElement;
		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));

		const frame = cardFor("c:POL_state_controlled_economy_category").querySelector(
			".dec-gui-frame",
		) as HTMLElement;
		assert.ok(frame, "the window must be drawn when the toggle is on");
		const window_ = frame.querySelector(".dec-gui-window") as HTMLElement;
		// 800px wide, scaled into a 300px card.
		assert.ok(window_.style.transform.startsWith("scale("));
		assert.strictEqual(frame.style.width, "300px");

		toggle.checked = false;
		toggle.dispatchEvent(new Event("change"));
	});

	it("marks a decision the file does not define", () => {
		assert.ok(cardFor("u:POL_elsewhere").classList.contains("dec-card-unresolved"));
	});

	it("puts the effects dot on a decision that does something", () => {
		assert.ok(cardFor("d:POL_start_sre").querySelector(".ev-effects-dot"));
		assert.strictEqual(cardFor("u:POL_elsewhere").querySelector(".ev-effects-dot"), null);
	});

	it("drops the condition panels when the conditions toggle is off", () => {
		assert.ok(cardFor("d:POL_start_sre").querySelector(".ev-cond"));

		const toggle = document.getElementById("show-conditions") as HTMLInputElement;
		toggle.checked = false;
		toggle.dispatchEvent(new Event("change"));

		// The modifier list uses .ev-cond for its typesetting, so the trigger panel is what has to be
		// gone rather than every box on the card.
		const heads = Array.from(cardFor("d:POL_start_sre").querySelectorAll(".ev-cond-head")).map(
			(h) => h.textContent,
		);
		assert.ok(!heads.includes("Available"));

		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));
	});

	it("swaps the title for the raw key when localisation is turned off", () => {
		const title = () => cardFor("d:POL_start_sre").querySelector(".ev-id")?.textContent;
		assert.strictEqual(title(), "Begin the plan");

		const toggle = document.getElementById("show-localisation") as HTMLInputElement;
		toggle.checked = false;
		toggle.dispatchEvent(new Event("change"));
		assert.strictEqual(title(), "POL_start_sre");

		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));
	});

	it("highlights what the search box matches and counts it", () => {
		const box = document.getElementById("dec-searchbox") as HTMLInputElement;
		box.value = "countdown";
		box.dispatchEvent(new Event("keyup"));

		const hits = document.querySelectorAll("#decisiontreecontent .ev-card.ev-hit");
		assert.strictEqual(hits.length, 1);
		assert.ok(document.getElementById("dec-search-count")?.textContent?.includes("1"));

		box.value = "";
		box.dispatchEvent(new Event("keyup"));
	});
	it("folds every tab down to its card when the collapse toggle is on, and opens one from its chevron", () => {
		const category = "c:POL_state_controlled_economy_category";
		const toggle = document.getElementById("collapse-categories") as HTMLInputElement;
		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));

		assert.strictEqual(
			document.querySelectorAll('#decisiontreecontent .ev-node[data-id^="d:"]').length,
			0,
		);
		const folded = cardFor(category);
		assert.ok(folded.classList.contains("dec-card-collapsed"));
		assert.strictEqual(folded.querySelector(".dec-badge-hidden")?.textContent, "2 hidden");
		const chevron = folded.querySelector(".dec-collapse") as HTMLButtonElement;
		assert.strictEqual(chevron.getAttribute("aria-expanded"), "false");

		takePostedMessages();
		chevron.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));

		assert.ok(cardFor("d:POL_start_sre"), "the tab opened on its own");
		assert.ok(!cardFor(category).classList.contains("dec-card-collapsed"));
		assert.strictEqual(
			cardFor(category).querySelector(".dec-collapse")?.getAttribute("aria-expanded"),
			"true",
		);
		assert.deepStrictEqual(
			takePostedMessages().filter((m) => m.command === "navigate"),
			[],
			"the chevron must not also open the file",
		);
		assert.deepStrictEqual(storedState().decCollapseExceptions, [
			"POL_state_controlled_economy_category",
		]);

		// Flipping the toggle is a fresh start: the tab opened by hand is forgotten with it.
		toggle.checked = false;
		toggle.dispatchEvent(new Event("change"));
		assert.deepStrictEqual(storedState().decCollapseExceptions, []);
		assert.ok(cardFor("d:POL_start_sre"));
	});

	it("closes one tab from its chevron while the rest stay open", () => {
		const category = "c:POL_state_controlled_economy_category";
		const chevron = cardFor(category).querySelector(".dec-collapse") as HTMLButtonElement;
		assert.strictEqual(chevron.getAttribute("aria-expanded"), "true");

		chevron.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
		assert.ok(cardFor(category).classList.contains("dec-card-collapsed"));
		assert.strictEqual(
			document.querySelector('#decisiontreecontent .ev-node[data-id="d:POL_start_sre"]'),
			null,
		);
		const toggle = document.getElementById("collapse-categories") as HTMLInputElement;
		assert.strictEqual(toggle.checked, false);

		(cardFor(category).querySelector(".dec-collapse") as HTMLButtonElement).dispatchEvent(
			new (window as any).MouseEvent("click", { bubbles: true }),
		);
		assert.ok(cardFor("d:POL_start_sre"));
	});

	it("keeps Enter on the chevron from opening the file through the card", () => {
		const category = "c:POL_state_controlled_economy_category";
		const chevron = cardFor(category).querySelector(".dec-collapse") as HTMLButtonElement;
		takePostedMessages();
		chevron.dispatchEvent(
			new (window as any).KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		assert.deepStrictEqual(takePostedMessages().filter((m) => m.command === "navigate"), []);
	});
});
