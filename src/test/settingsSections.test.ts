import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// The settings page groups the extension's settings into the sections package.json declares,
// one page each. Moving a setting between sections is a manifest edit nothing else checks, so
// this pins that every setting is still contributed exactly once and every section is titled
// and ordered. Issue #335.
const settings = [
	"mdHoi4Utilities.installPath",
	"mdHoi4Utilities.modFile",
	"mdHoi4Utilities.parentModPaths",
	"mdHoi4Utilities.userDataPath",
	"mdHoi4Utilities.loadDlcContents",
	"mdHoi4Utilities.previewLocalisation",
	"mdHoi4Utilities.previewWheel",
	"mdHoi4Utilities.eventTreePreview",
	"mdHoi4Utilities.decisionPreview",
	"mdHoi4Utilities.ideaPreview",
	"mdHoi4Utilities.characterPreview",
	"mdHoi4Utilities.useConditionInFocus",
	"mdHoi4Utilities.inlayWindowGfxRoots",
	"mdHoi4Utilities.technologyGfxRoots",
	"mdHoi4Utilities.technologyCountryIcons",
	"mdHoi4Utilities.enableSupplyArea",
	"mdHoi4Utilities.worldMapRetainContextWhenHidden",
	"mdHoi4Utilities.sharedFocusIndex",
	"mdHoi4Utilities.ideaSwapIndex",
	"mdHoi4Utilities.gfxIndex",
	"mdHoi4Utilities.localisationIndex",
	"mdHoi4Utilities.imageDecodeWorkers",
];

describe("package.json settings sections", () => {
	const packageJson = JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "..", "..", "..", "package.json"),
			"utf8",
		),
	);
	const sections: { title?: string; order?: number; properties: Record<string, unknown> }[] =
		packageJson.contributes.configuration;

	it("contributes more than one section", () => {
		assert.ok(sections.length > 1, "expected the settings to be split into sections");
	});

	it("gives every section a title and a distinct order", () => {
		const orders = new Set<number>();
		for (const section of sections) {
			assert.ok(section.title, "a section has no title");
			assert.strictEqual(typeof section.order, "number", `${section.title} has no order`);
			assert.ok(!orders.has(section.order!), `order ${section.order} is used twice`);
			orders.add(section.order!);
		}
	});

	it("contributes every setting exactly once", () => {
		const contributed = sections.flatMap(section => Object.keys(section.properties));
		assert.deepStrictEqual([...contributed].sort(), [...settings].sort());
	});
});
