import * as assert from "assert";
import flatten from "lodash/flatten";
import { conditionToString } from "../../../../hoiformat/condition";
import { arrayToMap } from "../../../../util/common";
import { StyleTable } from "../../../../util/styletable";
import { handOver } from "../../host";
import { eventsToGraph, buildEventGraphPayload } from "../../../../previewdef/event/graph";
import { getEvents } from "../../../../previewdef/event/schema";
import { EventGraphPayload } from "../../../../previewdef/event/payload";
import { parse } from "../../hoi";

// The settings the graph builder reads. With the localisation index off, keys resolve to
// themselves and no index is built.
const editor = {
	workspace: { getConfiguration: () => ({}) },
};

// The real pipeline, from an events file to the payload the webview lays out. The immediate block
// is where a random/while call most often sits, and without an option card it is the only place
// those calls surface.
async function payloadOf(immediateBlock: string): Promise<EventGraphPayload> {
	handOver(editor);
	const events = getEvents(
		parse(`
			add_namespace = test
			country_event = {
				id = test.1
				title = test.1.t
				is_triggered_only = yes
				immediate = { ${immediateBlock} }
			}
			country_event = {
				id = test.2
				title = test.2.t
				is_triggered_only = yes
			}
		`),
		"test.txt",
	);
	const eventIdToEvent = arrayToMap(
		flatten(Object.values(events.eventItemsByNamespace)),
		"id",
	);
	return buildEventGraphPayload(eventsToGraph(eventIdToEvent, ["test"]), {
		events,
		mainNamespaces: ["test"],
		gfxFiles: [],
		localizationDict: {},
	}, new StyleTable());
}

describe("previewdef/event/graph payload", () => {
	it("carries the chance of an immediate random onto the call and its effects", async () => {
		const payload = await payloadOf('random = { chance = 5 country_event = { id = test.2 } }');

		const calls = payload.edges.filter(e => !e.structural);
		assert.deepStrictEqual(
			calls.map(e => ({ source: e.source, scope: e.scope, chances: e.chances, repeated: e.repeated, condition: e.condition })),
			[{ source: "immediate", scope: "{event_target}", chances: [5], repeated: undefined, condition: true }],
		);

		const event = payload.nodes.find(n => n.kind === "event")!;
		const effects = payload.effectBlocks[event.effectsRef!]!;
		assert.deepStrictEqual(effects.map(e => e.kind), ["chance"]);
	});

	it("keeps nested chances distinct on final payload edges", async () => {
		const payload = await payloadOf(`
			random = {
				chance = 50
				random = { chance = 80 country_event = { id = test.2 } }
				random = { chance = 30 country_event = { id = test.2 } }
			}
		`);
		assert.deepStrictEqual(payload.edges.filter(e => !e.structural).map(e => e.chances), [[50, 80], [50, 30]]);
	});

	it("carries a repeated immediate while onto the call, guarded by its limit", async () => {
		const payload = await payloadOf('while = { limit = { has_war = yes } country_event = { id = test.2 } }');

		const calls = payload.edges.filter(e => !e.structural);
		assert.deepStrictEqual(
			calls.map(e => ({ source: e.source, chances: e.chances, repeated: e.repeated })),
			[{ source: "immediate", chances: undefined, repeated: true }],
		);
		assert.strictEqual(
			calls.every(e => conditionToString(e.condition).includes("has_war = yes")),
			true,
			`expected the limit on the call, got ${calls.map(e => conditionToString(e.condition))[0]}`,
		);

		const event = payload.nodes.find(n => n.kind === "event")!;
		const effects = payload.effectBlocks[event.effectsRef!]!;
		assert.deepStrictEqual(effects.map(e => e.kind), ["while"]);
	});
});
