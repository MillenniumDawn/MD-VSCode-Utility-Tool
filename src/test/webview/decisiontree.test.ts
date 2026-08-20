import "./setup";
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
});
