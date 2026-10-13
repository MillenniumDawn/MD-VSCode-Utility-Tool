import * as assert from "assert";
import { ideaPreviewDef } from "../../../../previewdef/idea";
import { document, settings } from "../document";

describe("previewdef/idea", () => {
	describe("canPreview", () => {
		beforeEach(() => settings({ ideaPreview: true }));

		it("takes a file under common/ideas without reading it", () => {
			assert.strictEqual(ideaPreviewDef.canPreview(document("/mod/common/ideas/SOV.txt")), 0);
		});

		it("takes a text file elsewhere at the offset of its ideas block", () => {
			const text = "# moved out of common\nideas = {\n}";
			assert.strictEqual(ideaPreviewDef.canPreview(document("/mod/scratch/SOV.txt", text)), text.indexOf("ideas"));
		});

		it("never reads a file that is not a .txt", () => {
			for (const path of ["/mod/localisation/english/ideas_l_english.yml", "/mod/common/ideas/README.md"]) {
				assert.strictEqual(ideaPreviewDef.canPreview(document(path)), undefined);
			}
		});

		it("takes nothing while the preview is turned off", () => {
			settings({ ideaPreview: false });
			assert.strictEqual(ideaPreviewDef.canPreview(document("/mod/common/ideas/SOV.txt")), undefined);
		});
	});
});
