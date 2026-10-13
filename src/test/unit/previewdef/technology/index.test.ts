import * as assert from "assert";
import { technologyPreviewDef } from "../../../../previewdef/technology";
import { document } from "../document";

describe("previewdef/technology", () => {
	describe("canPreview", () => {
		it("takes a file under common/technologies without reading it", () => {
			assert.strictEqual(technologyPreviewDef.canPreview(document("/mod/common/technologies/infantry.txt")), 0);
		});

		it("takes a text file elsewhere at the offset of its technologies block", () => {
			const text = "# moved out of common\ntechnologies = {\n}";
			assert.strictEqual(
				technologyPreviewDef.canPreview(document("/mod/scratch/infantry.txt", text)),
				text.indexOf("technologies"),
			);
		});

		it("never reads a file that is not a .txt", () => {
			for (const path of ["/mod/localisation/english/tech_l_english.yml", "/mod/common/technologies/README.md"]) {
				assert.strictEqual(technologyPreviewDef.canPreview(document(path)), undefined);
			}
		});
	});
});
