import * as assert from "assert";
import { decisionsOfCategory, loadCategoryDecisions, mentionsCategory } from "../previewdef/bop/decisions";
import { getDecisionsFromFile } from "../previewdef/decision/schema";
import { parseHoi4File } from "../hoiformat/hoiparser";
import * as fileloaderModule from "../util/fileloader";

// common/decisions/05_australia.txt, cut down: the BoP's category after another one, a decision
// with a quoted name override, and one naming its icon in a block.
const australia = `
AST_other_cat = {
	AST_unrelated = { cost = 10 }
}

rudd_bop_decisions_cat = {
	toughen_up_on_boat_arrivals_ast = {
		icon = GFX_decision_generic_human_torpedo
		cost = 120
		days_remove = 160
	}
	rudd_media_blitz = {
		name = "rudd_media_blitz_name"
		icon = { key = generic_propaganda trigger = { always = yes } }
		cost = 75
	}
}`;

describe("previewdef/bop decisions", () => {
	it("finds a category opened at the start of a line", () => {
		assert.ok(mentionsCategory(australia, ["rudd_bop_decisions_cat"]));
		assert.ok(mentionsCategory(australia, ["missing", "AST_other_cat"]));
	});

	it("does not take a mention for the category itself", () => {
		assert.ok(!mentionsCategory("x = { decision_category = rudd_bop_decisions_cat }", ["rudd_bop_decisions_cat"]));
		assert.ok(!mentionsCategory("rudd_bop_decisions_cat_extra = {", ["rudd_bop_decisions_cat"]));
		assert.ok(!mentionsCategory(australia, []));
	});

	it("escapes a category name that reads as a pattern", () => {
		assert.ok(!mentionsCategory("abc = {", ["a.c"]));
		assert.ok(mentionsCategory("a.c = {", ["a.c"]));
	});

	it("collects the category's decisions in file order", () => {
		const file = getDecisionsFromFile(parseHoi4File(australia), "common/decisions/05_australia.txt");
		const decisions = decisionsOfCategory(file, "rudd_bop_decisions_cat");
		assert.deepStrictEqual(decisions.map((d) => d.id), ["toughen_up_on_boat_arrivals_ast", "rudd_media_blitz"]);
		assert.strictEqual(decisions[1].nameKey, "rudd_media_blitz_name");
		assert.strictEqual(decisions[1].icons[0].key, "generic_propaganda");
		assert.ok(decisions.every((d) => d.file === "common/decisions/05_australia.txt" && d.token !== undefined));
	});
});

describe("previewdef/bop loadCategoryDecisions", () => {
	// A decisions folder with the BoP's category, a file without it, a file that is not a decisions
	// file, and one that cannot be read.
	const files: Record<string, string> = {
		"05_australia.txt": australia,
		"01_other.txt": "AST_other_cat = { AST_unrelated = { cost = 10 } }",
		"readme.md": "rudd_bop_decisions_cat = {",
		"99_broken.txt": "",
	};

	async function withDecisionsFolder(fn: (parsed: string[], listed: string[]) => Promise<void>): Promise<void> {
		const fileloader: any = fileloaderModule;
		const original = {
			list: fileloader.listFilesFromModOrHOI4,
			read: fileloader.readFileFromModOrHOI4,
			parse: fileloader.parseHoi4FileCached,
		};
		const parsed: string[] = [];
		const listed: string[] = [];
		fileloader.listFilesFromModOrHOI4 = async (folder: string) => {
			listed.push(folder);
			return Object.keys(files);
		};
		fileloader.readFileFromModOrHOI4 = async (file: string) => {
			if (file.endsWith("99_broken.txt")) {
				throw new Error("cannot read");
			}
			return [Buffer.from(files[file.slice("common/decisions/".length)]), file];
		};
		fileloader.parseHoi4FileCached = async (file: string) => {
			parsed.push(file);
			return parseHoi4File(files[file.slice("common/decisions/".length)]);
		};
		try {
			await fn(parsed, listed);
		} finally {
			fileloader.listFilesFromModOrHOI4 = original.list;
			fileloader.readFileFromModOrHOI4 = original.read;
			fileloader.parseHoi4FileCached = original.parse;
		}
	}

	it("reads nothing when no category is asked for", async () => {
		await withDecisionsFolder(async (parsed, listed) => {
			assert.deepStrictEqual(await loadCategoryDecisions([]), {});
			assert.deepStrictEqual(listed, []);
			assert.deepStrictEqual(parsed, []);
		});
	});

	it("collects each category's decisions, parsing only the files that open one", async () => {
		await withDecisionsFolder(async (parsed) => {
			const result = await loadCategoryDecisions(["rudd_bop_decisions_cat", "missing_cat"]);
			assert.deepStrictEqual(
				result.rudd_bop_decisions_cat.map((d) => d.id),
				["toughen_up_on_boat_arrivals_ast", "rudd_media_blitz"],
			);
			assert.strictEqual(result.rudd_bop_decisions_cat[0].file, "common/decisions/05_australia.txt");
			assert.deepStrictEqual(result.missing_cat, []);
			// The file without the category and the one that cannot be read are never parsed.
			assert.deepStrictEqual(parsed, ["common/decisions/05_australia.txt"]);
		});
	});
});
