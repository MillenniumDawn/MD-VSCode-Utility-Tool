import * as assert from "assert";
import { conditionToString } from "../../../../hoiformat/condition";
import { buildDecisionGraphPayload } from "../../../../previewdef/decision/graph";
import { getDecisionsFromFile } from "../../../../previewdef/decision/schema";
import { StyleTable } from "../../../../util/styletable";
import { handOver } from "../../host";
import { parse } from "../../hoi";

describe("previewdef/decision/graph payload", () => {
	it("carries nested chances and repetition through to decision edges", async () => {
		handOver({ workspace: { getConfiguration: () => ({}) } });
		const decisions = getDecisionsFromFile(parse(`
			cat = { d = { complete_effect = {
				random = { chance = 50 random = { chance = "runtime_chance"
					while = { limit = { has_war = yes } activate_mission = war_mission }
				} }
			} } }
		`), "test.txt");
		const payload = await buildDecisionGraphPayload({
			decisions, categories: {}, scriptedGuis: {}, guiWindows: {},
			modifierDefinitions: {}, gfxFiles: [],
		}, new StyleTable());

		const calls = payload.edges.filter(edge => !edge.structural);
		assert.strictEqual(calls.length, 1);
		assert.deepStrictEqual(calls[0]!.chances, [50, "runtime_chance"]);
		assert.strictEqual(calls[0]!.repeated, true);
		assert.strictEqual(conditionToString(calls[0]!.condition), "has_war = yes");
	});
});
