import * as assert from "assert";
import * as vscode from "vscode";
import { renderDecisionFile } from "../previewdef/decision/contentbuilder";
import { serializeUpdate, LoaderRenderResult } from "../previewdef/loaderpreview";
import {
	DecisionGraphCategoryNode,
	DecisionGraphDecisionNode,
	DecisionGraphPayload,
} from "../previewdef/decision/payload";
import { getDecisionsFromFile } from "../previewdef/decision/schema";
import { getDecisionCategoriesFromFile } from "../previewdef/decision/categories";
import { toolbarFlagsOf } from "../previewdef/decision/graph";
import { parseHoi4File } from "../hoiformat/hoiparser";
import { conditionToString } from "../hoiformat/condition";
import { contextContainer } from "../context";

// renderDecisionFile returns the in-place update parts { html, update } on success and a plain html
// string on the error branch. The graph is laid out and rendered in the webview, so the update
// payload carries data rather than markup. These drive it against a stub loader to assert the
// return shape, that serializeUpdate is stable for identical input -- the property the
// LoaderPreview skip relies on -- and that the categories, calls and conditions reach the payload.

const webview = { asWebviewUri: (u: unknown) => u, cspSource: "" } as unknown as vscode.Webview;
const uri = vscode.Uri.file("/tmp/common/decisions/test.txt");

interface StubOptions {
	categories?: string;
	scriptedGuis?: Record<string, { windowName?: string }>;
	guiWindows?: Record<string, { file: string; window: unknown }>;
}

function loaderFor(decisionsFile: string, options: StubOptions = {}): any {
	const decisions = getDecisionsFromFile(parseHoi4File(decisionsFile), "test.txt");
	const categoryList = options.categories
		? getDecisionCategoriesFromFile(parseHoi4File(options.categories), "categories.txt")
		: [];
	const categories: Record<string, unknown> = {};
	for (const category of categoryList) {
		categories[category.name] = category;
	}

	return {
		load: async () => ({
			result: {
				decisions,
				categories,
				scriptedGuis: options.scriptedGuis ?? {},
				guiWindows: options.guiWindows ?? {},
				modifierDefinitions: { byKey: {}, categories: {} },
				gfxFiles: [],
			},
			dependencies: ["test.txt"],
		}),
	};
}

async function payloadOf(decisionsFile: string, options: StubOptions = {}): Promise<DecisionGraphPayload> {
	const result = (await renderDecisionFile(
		loaderFor(decisionsFile, options),
		uri,
		webview,
	)) as LoaderRenderResult;
	return result.update?.data?.decisionGraph as DecisionGraphPayload;
}

function decisionNode(payload: DecisionGraphPayload, id: string): DecisionGraphDecisionNode {
	const found = payload.nodes.find((n) => n.kind === "decision" && n.decisionId === id);
	assert.ok(found, `expected a decision node for ${id}`);
	return found as DecisionGraphDecisionNode;
}

function categoryNode(payload: DecisionGraphPayload, key: string): DecisionGraphCategoryNode {
	const found = payload.nodes.find((n) => n.kind === "category" && n.categoryKey === key);
	assert.ok(found, `expected a category node for ${key}`);
	return found as DecisionGraphCategoryNode;
}

const simpleFile = `
    my_category = {
        leave_UNASUL = { cost = 100 icon = GFX_decision_generic_decision }
        demobilize_mission = { days_mission_timeout = 180 is_good = no activation = { has_war = no } }
    }
`;

describe("previewdef/decision/contentbuilder", () => {
	it("returns html plus the in-place update parts", async () => {
		const result = (await renderDecisionFile(
			loaderFor(simpleFile),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.ok(typeof result.html === "string");
		assert.ok(result.update);
		assert.ok(typeof result.update?.styleCss === "string");
		assert.ok(result.update?.data?.decisionGraph);
	});

	it("serializes identically for identical input, which is what lets an unchanged edit skip", async () => {
		const first = (await renderDecisionFile(loaderFor(simpleFile), uri, webview)) as LoaderRenderResult;
		const second = (await renderDecisionFile(loaderFor(simpleFile), uri, webview)) as LoaderRenderResult;

		assert.strictEqual(serializeUpdate(first.update!), serializeUpdate(second.update!));
	});

	it("exposes the payload on window.decisionGraph and loads the shared stylesheets", async () => {
		// html() only resolves a stylesheet name to a URI when an extension context is installed, so
		// give it one -- otherwise every <link href> is empty and the assertion is vacuous.
		const previous = contextContainer.current;
		contextContainer.current = { extensionUri: vscode.Uri.file("/ext") } as any;
		try {
			const result = (await renderDecisionFile(
				loaderFor(simpleFile),
				uri,
				webview,
			)) as LoaderRenderResult;

			assert.ok(result.html.includes("window.decisionGraph = "));
			assert.ok(result.html.includes("hoicard.css"), "the card primitives must be loaded");
			assert.ok(result.html.includes("hoigraph.css"), "the shared canvas must be loaded");
			assert.ok(result.html.includes("decisiontree.css"));
			assert.ok(result.html.includes("decisiontree.js"));
		} finally {
			contextContainer.current = previous;
		}
	});

	it("writes every toolbar control into the shell, for the webview to gate", async () => {
		const result = (await renderDecisionFile(loaderFor(simpleFile), uri, webview)) as LoaderRenderResult;

		for (const id of [
			"dec-searchbox",
			"show-localisation",
			"show-icon",
			"show-conditions",
			"show-effects",
			"show-scripted-gui",
		]) {
			assert.ok(result.html.includes(`id="${id}"`), `expected ${id} in the shell`);
		}
		for (const filter of [
			"missions",
			"decisions",
			"chains",
			"effects",
			"modifiers",
			"conditions",
			"scriptedgui",
		]) {
			assert.ok(result.html.includes(`value="${filter}"`), `expected the ${filter} filter`);
		}
	});

	it("escapes a </script> that reached the payload through localisation text", async () => {
		const result = (await renderDecisionFile(
			loaderFor(`cat = { "</script><script>alert(1)</script>" = { cost = 1 } }`),
			uri,
			webview,
		)) as LoaderRenderResult;

		assert.ok(!result.html.includes("</script><script>alert(1)"));
	});

	it("renders the error branch as plain html when the loader throws", async () => {
		const result = await renderDecisionFile(
			{
				load: async () => {
					throw new Error("boom");
				},
			} as any,
			uri,
			webview,
		);

		assert.strictEqual(typeof result, "string");
		assert.ok((result as string).includes("boom"));
	});
});

describe("previewdef/decision/contentbuilder graph", () => {
	it("makes each category a root and hangs its decisions off it", async () => {
		const payload = await payloadOf(simpleFile);

		assert.deepStrictEqual(payload.roots, ["c:my_category"]);
		const structural = payload.edges.filter((e) => e.structural);
		assert.deepStrictEqual(
			structural.map((e) => `${e.from}->${e.to}`),
			["c:my_category->d:leave_UNASUL", "c:my_category->d:demobilize_mission"],
		);
	});

	it("keeps a category written twice in one file as a single tab", async () => {
		const payload = await payloadOf(`
            cat = { first = { cost = 1 } }
            cat = { second = { cost = 2 } }
        `);

		assert.strictEqual(payload.nodes.filter((n) => n.kind === "category").length, 1);
		assert.strictEqual(payload.edges.filter((e) => e.structural).length, 2);
	});

	it("tells a mission from a decision on the node", async () => {
		const payload = await payloadOf(simpleFile);

		assert.strictEqual(decisionNode(payload, "leave_UNASUL").isMission, false);
		const mission = decisionNode(payload, "demobilize_mission");
		assert.strictEqual(mission.isMission, true);
		assert.strictEqual(mission.daysMissionTimeout, 180);
		assert.strictEqual(mission.isGood, false);
		assert.strictEqual(mission.hasActivation, true);
	});

	it("draws an arrow for a call and says what kind it is", async () => {
		const payload = await payloadOf(`
            cat = {
                starter = { complete_effect = { activate_mission = the_mission } }
                the_mission = { days_mission_timeout = 30 }
            }
        `);

		const call = payload.edges.find((e) => !e.structural);
		assert.ok(call);
		assert.strictEqual(call?.from, "d:starter");
		assert.strictEqual(call?.to, "d:the_mission");
		assert.strictEqual(call?.kind, "activate");
		assert.strictEqual(call?.fromBlock, "complete_effect");
	});

	it("carries the guard on a call through to the arrow", async () => {
		const payload = await payloadOf(`
            cat = {
                starter = {
                    complete_effect = { if = { limit = { has_war = yes } activate_mission = the_mission } }
                }
                the_mission = { days_mission_timeout = 30 }
            }
        `);

		const call = payload.edges.find((e) => !e.structural);
		assert.ok(call);
		assert.strictEqual(conditionToString(call!.condition), "has_war = yes");
	});

	it("adds a placeholder for a decision the file does not define", async () => {
		const payload = await payloadOf(`
            cat = { starter = { complete_effect = { activate_mission = defined_elsewhere } } }
        `);

		const unresolved = payload.nodes.find((n) => n.kind === "unresolved");
		assert.ok(unresolved);
		assert.strictEqual(unresolved?.id, "u:defined_elsewhere");
		assert.ok(payload.edges.some((e) => e.to === "u:defined_elsewhere"));
	});

	it("keeps a self-activating mission as one node with one arrow back to itself", async () => {
		// POL_sre_main_countdown_mission re-activates itself from its own timeout_effect. The layout
		// drops a self-edge, but the payload must still describe the file.
		const payload = await payloadOf(`
            cat = {
                countdown = {
                    days_mission_timeout = 365
                    timeout_effect = { hidden_effect = { activate_mission = countdown } }
                }
            }
        `);

		assert.strictEqual(payload.nodes.filter((n) => n.kind === "decision").length, 1);
		const call = payload.edges.find((e) => !e.structural);
		assert.strictEqual(call?.from, "d:countdown");
		assert.strictEqual(call?.to, "d:countdown");
	});

	it("stores each distinct effect block once and references it by index", async () => {
		const payload = await payloadOf(`
            cat = {
                a = { complete_effect = { add_political_power = 50 } }
                b = { complete_effect = { add_political_power = 50 } }
                c = { complete_effect = { add_stability = 0.1 } }
            }
        `);

		assert.strictEqual(payload.effectBlocks.length, 2);
		assert.strictEqual(
			decisionNode(payload, "a").effects[0]?.ref,
			decisionNode(payload, "b").effects[0]?.ref,
		);
		assert.notStrictEqual(
			decisionNode(payload, "a").effects[0]?.ref,
			decisionNode(payload, "c").effects[0]?.ref,
		);
	});

	it("names the four effect blocks on the node", async () => {
		const payload = await payloadOf(`
            cat = {
                d = {
                    complete_effect = { add_political_power = 50 }
                    timeout_effect = { add_stability = 0.1 }
                }
            }
        `);

		assert.deepStrictEqual(
			decisionNode(payload, "d").effects.map((e) => e.name),
			["complete_effect", "timeout_effect"],
		);
	});
});

describe("previewdef/decision/contentbuilder categories", () => {
	const categoriesFile = `
        my_category = {
            icon = GFX_decision_israel
            priority = 996
            visible_when_empty = yes
            scripted_gui = israel_knesset_gui
            allowed = { original_tag = ISR }
        }
    `;

	it("reads the tab's own facts out of the categories folder", async () => {
		const payload = await payloadOf(simpleFile, { categories: categoriesFile });
		const category = categoryNode(payload, "my_category");

		assert.strictEqual(category.defined, true);
		assert.strictEqual(category.priority, 996);
		assert.strictEqual(category.visibleWhenEmpty, true);
		assert.strictEqual(category.hasAllowed, true);
		assert.strictEqual(conditionToString(category.allowed), "original_tag = ISR");
	});

	it("says so when nothing defines the category the decisions name", async () => {
		const payload = await payloadOf(simpleFile);
		const category = categoryNode(payload, "my_category");

		assert.strictEqual(category.defined, false);
		assert.strictEqual(category.scriptedGui, undefined);
	});

	it("reports a scripted GUI whose window could not be found, rather than staying silent", async () => {
		const payload = await payloadOf(simpleFile, { categories: categoriesFile });
		const category = categoryNode(payload, "my_category");

		assert.strictEqual(category.scriptedGui?.name, "israel_knesset_gui");
		assert.strictEqual(category.scriptedGui?.html, undefined);
		assert.strictEqual(payload.toolbarFlags.hasUnresolvedScriptedGui, true);
		assert.strictEqual(payload.toolbarFlags.hasScriptedGui, false);
	});
});

describe("previewdef/decision/contentbuilder toolbar flags", () => {
	function flagsFor(nodes: unknown[], edges: unknown[] = []) {
		return toolbarFlagsOf(nodes as never, edges as never);
	}

	const decision = (over: Record<string, unknown> = {}) => ({
		kind: "decision",
		id: "d:x",
		isMission: false,
		effects: [],
		modifiers: [],
		badges: [],
		hasAllowed: false,
		hasAvailable: false,
		hasVisible: false,
		hasActivation: false,
		hasCancelTrigger: false,
		...over,
	});

	it("offers the mission filter only when there is a mission", async () => {
		assert.strictEqual(flagsFor([decision()]).hasMissions, false);
		assert.strictEqual(flagsFor([decision({ isMission: true })]).hasMissions, true);
	});

	it("offers the decision filter only when there is a plain decision", async () => {
		assert.strictEqual(flagsFor([decision({ isMission: true })]).hasDecisions, false);
		assert.strictEqual(flagsFor([decision()]).hasDecisions, true);
	});

	it("offers the chain filter only when a decision calls another", async () => {
		assert.strictEqual(flagsFor([decision()], [{ structural: true }]).hasChains, false);
		assert.strictEqual(flagsFor([decision()], [{ structural: false }]).hasChains, true);
	});

	it("offers the effects and modifiers filters only when something has them", async () => {
		assert.strictEqual(flagsFor([decision()]).hasEffects, false);
		assert.strictEqual(
			flagsFor([decision({ effects: [{ name: "complete_effect", ref: 0 }] })]).hasEffects,
			true,
		);
		assert.strictEqual(flagsFor([decision()]).hasModifiers, false);
		assert.strictEqual(
			flagsFor([decision({ modifiers: [{ key: "a", name: "A", value: "1", tone: "good" }] })])
				.hasModifiers,
			true,
		);
	});

	it("counts a category's own triggers towards the conditions filter", async () => {
		assert.strictEqual(flagsFor([decision()]).hasConditions, false);
		assert.strictEqual(flagsFor([decision({ hasAvailable: true })]).hasConditions, true);
		assert.strictEqual(
			flagsFor([{ kind: "category", id: "c:a", hasAllowed: true, hasVisible: false }])
				.hasConditions,
			true,
		);
	});

	it("offers the icon toggle only when an icon resolved", async () => {
		assert.strictEqual(flagsFor([decision()]).hasIcons, false);
		assert.strictEqual(
			flagsFor([decision({ icon: { styleKey: "k", width: 1, height: 1 } })]).hasIcons,
			true,
		);
	});
});
