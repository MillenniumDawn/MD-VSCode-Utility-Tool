import * as assert from "assert";
import { eventPreviewDef } from "../../../../previewdef/event";
import { document, settings } from "../document";

describe("previewdef/event", () => {
	describe("canPreview", () => {
		beforeEach(() => settings({ eventTreePreview: true }));

		it("takes a file under events/ without reading it", () => {
			assert.strictEqual(eventPreviewDef.canPreview(document("/mod/events/SOV.txt")), 0);
		});

		it("takes a text file elsewhere at the offset of its first event call", () => {
			const text = "SOV_decisions = {\n\tSOV_act = { complete_effect = { country_event = { id = sov.1 } } }\n}";
			assert.strictEqual(
				eventPreviewDef.canPreview(document("/mod/common/decisions/SOV.txt", text)),
				text.indexOf("country_event"),
			);
		});

		it("leaves a text file with no event call alone", () => {
			assert.strictEqual(eventPreviewDef.canPreview(document("/mod/common/ideas/SOV.txt", "ideas = { }")), undefined);
		});

		it("never reads a file that is not a .txt", () => {
			for (const path of ["/mod/localisation/english/events_l_english.yml", "/mod/events/README.md", "Untitled-1"]) {
				assert.strictEqual(eventPreviewDef.canPreview(document(path)), undefined);
			}
		});

		it("takes nothing while the preview is turned off", () => {
			settings({ eventTreePreview: false });
			assert.strictEqual(eventPreviewDef.canPreview(document("/mod/events/SOV.txt")), undefined);
		});
	});
});
