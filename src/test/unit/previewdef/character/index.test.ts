import * as assert from "assert";
import { characterPreviewDef } from "../../../../previewdef/character";
import { document, settings } from "../document";

describe("previewdef/character", () => {
	describe("canPreview", () => {
		beforeEach(() => settings({ characterPreview: true }));

		it("takes a file under common/characters without reading it", () => {
			assert.strictEqual(characterPreviewDef.canPreview(document("/mod/common/characters/SOV.txt")), 0);
		});

		it("takes a text file elsewhere at the offset of its characters block", () => {
			const text = "# moved out of common\ncharacters = {\n}";
			assert.strictEqual(
				characterPreviewDef.canPreview(document("/mod/scratch/SOV.txt", text)),
				text.indexOf("characters"),
			);
		});

		it("never reads a file that is not a .txt", () => {
			for (const path of ["/mod/localisation/english/characters_l_english.yml", "/mod/common/characters/README.md"]) {
				assert.strictEqual(characterPreviewDef.canPreview(document(path)), undefined);
			}
		});

		it("takes nothing while the preview is turned off", () => {
			settings({ characterPreview: false });
			assert.strictEqual(characterPreviewDef.canPreview(document("/mod/common/characters/SOV.txt")), undefined);
		});
	});
});
