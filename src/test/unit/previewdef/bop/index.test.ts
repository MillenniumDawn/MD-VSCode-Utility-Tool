import * as assert from "assert";
import { bopPreviewDef } from "../../../../previewdef/bop";
import { document, settings } from "../document";

describe("previewdef/bop", () => {
	describe("canPreview", () => {
		beforeEach(() => settings({ bopPreview: true }));

		it("takes a file under common/bop without reading it", () => {
			assert.strictEqual(bopPreviewDef.canPreview(document("/mod/common/bop/SOV.txt")), 0);
		});

		it("takes a text file elsewhere at the offset of a block that opens with initial_value", () => {
			const text = "# moved out of common\nSOV_power_balance = {\n\tinitial_value = 0\n}";
			assert.strictEqual(
				bopPreviewDef.canPreview(document("/mod/scratch/SOV.txt", text)),
				text.indexOf("SOV_power_balance"),
			);
		});

		it("never reads a file that is not a .txt", () => {
			for (const path of ["/mod/localisation/english/bop_l_english.yml", "/mod/common/bop/README.md"]) {
				assert.strictEqual(bopPreviewDef.canPreview(document(path)), undefined);
			}
		});

		it("takes nothing while the preview is turned off", () => {
			settings({ bopPreview: false });
			assert.strictEqual(bopPreviewDef.canPreview(document("/mod/common/bop/SOV.txt")), undefined);
		});
	});
});
