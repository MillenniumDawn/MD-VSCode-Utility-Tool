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
	"mdHoi4Utilities.bopPreview",
	"mdHoi4Utilities.useConditionInFocus",
	"mdHoi4Utilities.focusTreeLayout",
	"mdHoi4Utilities.focusTreePrerequisiteLines",
	"mdHoi4Utilities.inlayWindowGfxRoots",
	"mdHoi4Utilities.focusOverlayGfxFiles",
	"mdHoi4Utilities.decisionGfxFiles",
	"mdHoi4Utilities.ideaPlaceholderIcon",
	"mdHoi4Utilities.characterTraitStructuralKeys",
	"mdHoi4Utilities.modifierFormatFiles",
	"mdHoi4Utilities.technologyGfxRoots",
	"mdHoi4Utilities.technologyCountryIcons",
	"mdHoi4Utilities.enableSupplyArea",
	"mdHoi4Utilities.worldMapRetainContextWhenHidden",
	"mdHoi4Utilities.sharedFocusIndex",
	"mdHoi4Utilities.ideaSwapIndex",
	"mdHoi4Utilities.gfxIndex",
	"mdHoi4Utilities.localisationIndex",
	"mdHoi4Utilities.imageDecodeWorkers",
	"mdHoi4Utilities.auditor.reportFolder",
	"mdHoi4Utilities.auditor.includeVanilla",
	"mdHoi4Utilities.modTools.enabled",
];

// A mod pack's own settings, mdHoi4Utilities.modTools.<pack>.<tool>, are pinned against the pack
// registry by modtoolssettings.test.ts instead, so adding a pack does not mean editing this list.
const isModPackSetting = (key: string) => /^mdHoi4Utilities\.modTools\.[^.]+\.[^.]+$/.test(key);

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

	// The settings page has no buttons, so the Auditor's "Check all focus trees" is a command link
	// in a description. A renamed command leaves the link dead without any other check noticing.
	it("links only to commands the extension contributes, in every language", () => {
		const commandIds = new Set<string>(
			packageJson.contributes.commands.map((c: { command: string }) => c.command),
		);
		const root = path.join(__dirname, "..", "..", "..");
		const nlsFiles = fs.readdirSync(root).filter(f => /^package\.nls(\..+)?\.json$/.test(f));
		let links = 0;
		for (const file of nlsFiles) {
			const strings: Record<string, string> = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
			for (const [key, value] of Object.entries(strings)) {
				for (const match of value.matchAll(/\(command:([A-Za-z0-9_.]+)\)/g)) {
					links++;
					assert.ok(commandIds.has(match[1]), `${file} ${key} links to ${match[1]}, which is not contributed`);
				}
			}
		}
		assert.ok(links >= nlsFiles.length, "expected the Auditor's link in every language");
	});

	it("contributes every setting exactly once", () => {
		const contributed = sections.flatMap(section => Object.keys(section.properties)).filter(key => !isModPackSetting(key));
		assert.deepStrictEqual([...contributed].sort(), [...settings].sort());
	});
});
