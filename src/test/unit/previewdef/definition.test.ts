import * as assert from "assert";
import type * as vscode from "vscode";
import { PreviewFiles, definePreview, matchPreviewFiles, previewFiles } from "../../../previewdef/definition";
import { refreshFeatureFlags } from "../../../util/featureflags";
import { handOver } from "../host";

// A document as a preview meets it when asked whether it is its own. Given no text, it fails the
// test when it is read.
function document(path: string, text?: string): vscode.TextDocument {
	return {
		uri: { path, toString: () => `file://${path}` },
		getText: () => text ?? assert.fail(`${path} was read`),
	} as unknown as vscode.TextDocument;
}

// An editor with the given settings, and the feature flags read from them.
function settings(values: Record<string, unknown>): void {
	handOver({ workspace: { getConfiguration: () => values } });
	refreshFeatureFlags();
}

const everyPreviewOn = {
	eventTreePreview: true,
	ideaPreview: true,
	decisionPreview: true,
	characterPreview: true,
	bopPreview: true,
};

describe("previewdef/definition", () => {
	describe("matchPreviewFiles", () => {
		const ideas: PreviewFiles = { extension: ".txt", folder: ["common", "ideas", "*"], content: /^ideas = {/m };

		it("takes a file in its folder without reading it", () => {
			assert.strictEqual(matchPreviewFiles(ideas, document("/mod/common/ideas/SOV.txt")), 0);
			assert.strictEqual(matchPreviewFiles(ideas, document("/mod/Common/Ideas/SOV.TXT")), 0);
		});

		it("takes a file kept elsewhere at the offset of what makes it its own", () => {
			assert.strictEqual(matchPreviewFiles(ideas, document("/mod/scratch/SOV.txt", "# moved\nideas = {\n}")), 8);
		});

		it("leaves a file kept elsewhere that does not say so", () => {
			assert.strictEqual(matchPreviewFiles(ideas, document("/mod/scratch/SOV.txt", "focus_tree = {\n}")), undefined);
		});

		it("leaves a file kept elsewhere unread when nothing it says could make it its own", () => {
			const files: PreviewFiles = { extension: ".txt", folder: ["common", "decisions", "*"] };
			assert.strictEqual(matchPreviewFiles(files, document("/mod/scratch/SOV.txt")), undefined);
		});

		it("never reads a file with another extension", () => {
			for (const path of ["/mod/common/ideas/README.md", "/mod/localisation/english/ideas_l_english.yml", "Untitled-1"]) {
				assert.strictEqual(matchPreviewFiles(ideas, document(path)), undefined);
			}
		});

		it("takes every file with its extension when it names no folder", () => {
			const files: PreviewFiles = { extension: ".gfx" };
			assert.strictEqual(matchPreviewFiles(files, document("/mod/interface/SOV.gfx")), 0);
			assert.strictEqual(matchPreviewFiles(files, document("/anywhere/SOV.GFX")), 0);
			assert.strictEqual(matchPreviewFiles(files, document("/mod/interface/SOV.gui")), undefined);
		});

		it("takes one file by name when its folder ends in the name", () => {
			const files: PreviewFiles = { extension: ".map", folder: ["map", "default.map"] };
			assert.strictEqual(matchPreviewFiles(files, document("/mod/map/default.map")), 0);
			assert.strictEqual(matchPreviewFiles(files, document("/mod/map/other.map")), undefined);
			assert.strictEqual(matchPreviewFiles(files, document("/mod/history/default.map")), undefined);
		});

		it("takes nothing while its setting is off", () => {
			const flagged: PreviewFiles = { ...ideas, flag: "ideaPreview" };
			settings({ ideaPreview: false });
			assert.strictEqual(matchPreviewFiles(flagged, document("/mod/common/ideas/SOV.txt")), undefined);
			settings({ ideaPreview: true });
			assert.strictEqual(matchPreviewFiles(flagged, document("/mod/common/ideas/SOV.txt")), 0);
		});
	});

	describe("previewFiles", () => {
		beforeEach(() => settings(everyPreviewOn));

		// A file in each preview's own folder and, for a preview that takes files kept elsewhere,
		// what such a file has to say.
		const rows: [keyof typeof previewFiles, string, string?][] = [
			["focustree", "/mod/common/national_focus/SOV.txt"],
			["gfx", "/mod/interface/SOV.gfx"],
			["technology", "/mod/common/technologies/infantry.txt", "technologies = {\n}"],
			["worldmap", "/mod/map/default.map"],
			["event", "/mod/events/SOV.txt", "country_event = { id = sov.1 }"],
			["gui", "/mod/interface/SOV.gui"],
			["mio", "/mod/common/military_industrial_organization/organizations/SOV.txt"],
			["idea", "/mod/common/ideas/SOV.txt", "ideas = {\n}"],
			["decision", "/mod/common/decisions/SOV.txt"],
			["character", "/mod/common/characters/SOV.txt", "characters = {\n}"],
			["bop", "/mod/common/bop/SOV.txt", "SOV_power_balance = {\n\tinitial_value = 0\n}"],
		];

		it("has a row here for every preview", () => {
			assert.deepStrictEqual(rows.map(([type]) => type), Object.keys(previewFiles));
		});

		for (const [type, home, says] of rows) {
			it(`${type} takes ${home} without reading it`, () => {
				assert.strictEqual(matchPreviewFiles(previewFiles[type], document(home)), 0);
			});

			if (says !== undefined) {
				it(`${type} takes a file kept elsewhere that says what its files say`, () => {
					const text = `# moved out of its folder\n${says}`;
					assert.strictEqual(
						matchPreviewFiles(previewFiles[type], document("/mod/scratch/SOV.txt", text)),
						text.indexOf(says),
					);
				});
			}
		}

		// The preview the manager opens: the one with the lowest answer.
		function chosen(file: vscode.TextDocument): string | undefined {
			let best: [string, number] | undefined;
			for (const [type, files] of Object.entries(previewFiles)) {
				const answer = matchPreviewFiles(files, file);
				if (answer !== undefined && (best === undefined || answer < best[1])) {
					best = [type, answer];
				}
			}
			return best?.[0];
		}

		it("gives a decisions file that fires an event to the decision preview", () => {
			const text = "SOV_decisions = {\n\tSOV_act = { complete_effect = { country_event = { id = sov.1 } } }\n}";
			assert.strictEqual(chosen(document("/mod/common/decisions/SOV.txt", text)), "decision");
		});

		it("gives a file of decision categories to no preview", () => {
			assert.strictEqual(chosen(document("/mod/common/decisions/categories/SOV.txt", "SOV_category = {\n}")), undefined);
		});

		it("gives an events file to the event preview", () => {
			assert.strictEqual(chosen(document("/mod/events/SOV.txt", "country_event = { id = sov.1 }")), "event");
		});

		it("gives a file no preview has the extension of to none, unread", () => {
			for (const path of ["/mod/localisation/english/events_l_english.yml", "/mod/events/README.md", "Untitled-1"]) {
				assert.strictEqual(chosen(document(path)), undefined);
			}
		});
	});

	describe("definePreview", () => {
		const own = { displayName: () => "Preview", onPreview: async () => undefined };

		it("says whether it is on from the setting of its type, and nothing when its type has none", () => {
			const idea = definePreview({ type: "idea", ...own });
			settings({ ideaPreview: false });
			assert.strictEqual(idea.isEnabled?.(), false);
			settings({ ideaPreview: true });
			assert.strictEqual(idea.isEnabled?.(), true);
			assert.strictEqual(definePreview({ type: "focustree", ...own }).isEnabled, undefined);
		});

		it("takes the files of its type, and keeps what the preview said for itself", () => {
			const gui = definePreview({ type: "gui", ...own });
			assert.strictEqual(gui.canPreview(document("/mod/interface/SOV.gui")), 0);
			assert.strictEqual(gui.canPreview(document("/mod/interface/SOV.gfx")), undefined);
			assert.deepStrictEqual([gui.type, gui.displayName(), "onPreview" in gui && gui.onPreview], ["gui", "Preview", own.onPreview]);
		});

		it("answers for every preview, and nothing for the wrong suffix or a setting that is off", () => {
			const homes: [keyof typeof previewFiles, string][] = [
				["focustree", "/mod/common/national_focus/SOV.txt"],
				["gfx", "/mod/interface/SOV.gfx"],
				["technology", "/mod/common/technologies/infantry.txt"],
				["worldmap", "/mod/map/default.map"],
				["event", "/mod/events/SOV.txt"],
				["gui", "/mod/interface/SOV.gui"],
				["mio", "/mod/common/military_industrial_organization/organizations/SOV.txt"],
				["idea", "/mod/common/ideas/SOV.txt"],
				["decision", "/mod/common/decisions/SOV.txt"],
				["character", "/mod/common/characters/SOV.txt"],
				["bop", "/mod/common/bop/SOV.txt"],
			];
			settings(everyPreviewOn);
			for (const [type, home] of homes) {
				const preview = definePreview({ type, ...own });
				assert.strictEqual(preview.canPreview(document(home)), 0, type);
				assert.strictEqual(preview.canPreview(document(`${home}.md`)), undefined, `${type} suffix`);
			}
			settings({});
			for (const type of ["event", "idea", "decision", "character", "bop"] as const) {
				const home = homes.find(([name]) => name === type)?.[1];
				assert.strictEqual(definePreview({ type, ...own }).canPreview(document(home!)), undefined, type);
			}
		});
	});
});
