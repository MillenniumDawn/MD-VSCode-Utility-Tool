import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import {
	convertFocusFileNodeToJson,
	extractFocusIds,
	extractOrListIds,
	getFocusTreeWithFocusFile,
	FocusTree,
	FocusWarning,
} from "../previewdef/focustree/schema";

const filePath = "common/national_focus/test.txt";

function focusBlock(
	id: string,
	x: number,
	y: number,
	extra: string = "",
): string {
	return `focus = { id = ${id} x = ${x} y = ${y} ${extra}}`;
}

function treeWithFocuses(...focuses: string[]): string {
	return `focus_tree = {
    id = test_tree
    ${focuses.join("\n    ")}
}`;
}

function treesOf(content: string): FocusTree[] {
	const file = convertFocusFileNodeToJson(parseHoi4File(content), {});
	return getFocusTreeWithFocusFile(file, [], filePath, {});
}

function warningsOf(content: string): FocusWarning[] {
	const trees = treesOf(content);
	assert.ok(trees.length > 0);
	return trees[0].warnings;
}

function warningTexts(content: string): string[] {
	return warningsOf(content).map((w) => w.text);
}

describe("previewdef/focustree layout warnings", () => {
	it("parses a prerequisite block with multiple focuses as one OR group", () => {
		const trees = treesOf(
			treeWithFocuses(
				focusBlock(
					"focus_a",
					0,
					0,
					"prerequisite = { focus = focus_b focus = focus_c }",
				),
				focusBlock("focus_b", 0, 1),
				focusBlock("focus_c", 2, 1),
			),
		);
		assert.deepStrictEqual(trees[0].focuses.focus_a.prerequisite, [
			["focus_b", "focus_c"],
		]);
	});

	it("parses an explicit OR block with bare focus ids", () => {
		const trees = treesOf(
			treeWithFocuses(
				focusBlock(
					"focus_a",
					0,
					0,
					"prerequisite = { OR = { focus_b focus_c } }",
				),
				focusBlock("focus_b", 0, 1),
				focusBlock("focus_c", 2, 1),
			),
		);
		assert.deepStrictEqual(trees[0].focuses.focus_a.prerequisite, [
			["focus_b", "focus_c"],
		]);
	});

	it("parses an explicit OR block with focus = entries", () => {
		const trees = treesOf(
			treeWithFocuses(
				focusBlock(
					"focus_a",
					0,
					0,
					"prerequisite = { OR = { focus = focus_b focus = focus_c } }",
				),
				focusBlock("focus_b", 0, 1),
				focusBlock("focus_c", 2, 1),
			),
		);
		assert.deepStrictEqual(trees[0].focuses.focus_a.prerequisite, [
			["focus_b", "focus_c"],
		]);
	});

	it("reports no warnings for a clean tree", () => {
		const content = treeWithFocuses(
			focusBlock("focus_b", 0, 0),
			focusBlock("focus_a", 0, 1, "prerequisite = { focus = focus_b }"),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("warns when a prerequisite is positioned below its dependent", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "prerequisite = { focus = focus_b }"),
			focusBlock("focus_b", 0, 1),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b of focus focus_a is not positioned above it.",
		]);
	});

	it("warns when a prerequisite is on the same row as its dependent", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "prerequisite = { focus = focus_b }"),
			focusBlock("focus_b", 2, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b of focus focus_a is not positioned above it.",
		]);
	});

	// A row of mutually exclusive alternatives that chains further picks along that same row is a
	// deliberate layout, not a mistake: the Zyuganov row in Millennium Dawn's Russia tree puts five
	// alternatives on one row, two of which require an earlier one from that row.
	it("reports no prerequisite warning for a same-row chain when the dependent has a row-mate", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				1,
				"prerequisite = { focus = focus_b } mutually_exclusive = { focus = focus_c }",
			),
			focusBlock("focus_b", 2, 1),
			focusBlock("focus_c", 4, 1),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("reports no prerequisite warning for a same-row chain when the prerequisite has a row-mate", () => {
		const content = treeWithFocuses(
			focusBlock("focus_root", 0, 0),
			focusBlock(
				"focus_alt_a",
				0,
				1,
				"prerequisite = { focus = focus_root } mutually_exclusive = { focus = focus_alt_b }",
			),
			focusBlock(
				"focus_alt_b",
				2,
				1,
				"prerequisite = { focus = focus_root } mutually_exclusive = { focus = focus_alt_a }",
			),
			focusBlock(
				"focus_chain",
				4,
				1,
				"prerequisite = { focus = focus_alt_a focus = focus_alt_b }",
			),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("still warns for a same-row prerequisite when the exclusive partner is on another row", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				1,
				"prerequisite = { focus = focus_b } mutually_exclusive = { focus = focus_c }",
			),
			focusBlock("focus_b", 2, 1),
			focusBlock("focus_c", 4, 2),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b of focus focus_a is not positioned above it.",
			"Mutually exclusive focuses focus_a and focus_c are not on the same row.",
		]);
	});

	it("still warns for a prerequisite below its dependent inside a mutually exclusive row", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				1,
				"prerequisite = { focus = focus_b } mutually_exclusive = { focus = focus_c }",
			),
			focusBlock("focus_c", 2, 1),
			focusBlock("focus_b", 4, 2),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b of focus focus_a is not positioned above it.",
		]);
	});

	it("reports no prerequisite warning when one option of an OR group is above", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				2,
				"prerequisite = { focus = focus_b focus = focus_c }",
			),
			focusBlock("focus_b", 0, 0),
			focusBlock("focus_c", 2, 3),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("warns when no option of an OR-group prerequisite is above", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				0,
				"prerequisite = { focus = focus_b focus = focus_c }",
			),
			focusBlock("focus_b", 0, 2),
			focusBlock("focus_c", 2, 2),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b, focus_c of focus focus_a is not positioned above it.",
		]);
	});

	it("warns when no option of an explicit OR block is above", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				0,
				"prerequisite = { OR = { focus = focus_b focus = focus_c } }",
			),
			focusBlock("focus_b", 0, 2),
			focusBlock("focus_c", 2, 2),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b, focus_c of focus focus_a is not positioned above it.",
		]);
	});

	it("ignores prerequisites defined outside the tree", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "prerequisite = { focus = focus_elsewhere }"),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("warns when mutually exclusive focuses are not on the same row", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "mutually_exclusive = { focus = focus_b }"),
			focusBlock("focus_b", 2, 1),
		);
		const warnings = warningsOf(content);
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].source, "focus_a");
		assert.deepStrictEqual(warnings[0].relatedSources, ["focus_b"]);
		assert.strictEqual(
			warnings[0].text,
			"Mutually exclusive focuses focus_a and focus_b are not on the same row.",
		);
	});

	// The standard layout: the two alternatives sit side by side on one row, two columns
	// apart. Differing X is expected here, so this must stay silent.
	it("reports no warning for mutually exclusive focuses sharing a row", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "mutually_exclusive = { focus = focus_b }"),
			focusBlock("focus_b", 2, 0),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	// The full Millennium Dawn idiom the same-X rule used to flag on every mutex pair: two
	// alternatives side by side under a shared root, each hiding the other through allow_branch
	// and each carrying a triggered offset that slides it into the vacated slot once the branch
	// resolves. Offsets are not applied by the validator, so the base coordinates must pass.
	it("reports no warning for a side-by-side pair using offset and allow_branch", () => {
		const exclusiveHalf = (self: string, other: string, x: number, dx: number) =>
			focusBlock(
				self,
				x,
				2,
				`relative_position_id = focus_root
				offset = {
					x = ${dx}
					y = -1
					trigger = { has_completed_focus = ${self} }
				}
				allow_branch = { NOT = { has_completed_focus = ${other} } }
				prerequisite = { focus = focus_root }
				mutually_exclusive = { focus = ${other} }`,
			);
		const content = treeWithFocuses(
			focusBlock("focus_root", 10, 0),
			exclusiveHalf("focus_a", "focus_b", -3, -1),
			exclusiveHalf("focus_b", "focus_a", -5, 1),
		);
		// focus_a resolves to (7, 2), focus_b to (5, 2): one row, two columns apart.
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("warns once when the exclusivity is declared on both focuses", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "mutually_exclusive = { focus = focus_b }"),
			focusBlock("focus_b", 2, 1, "mutually_exclusive = { focus = focus_a }"),
		);
		assert.strictEqual(warningsOf(content).length, 1);
	});

	it("warns when two focuses on the same row are one apart", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 1, 0),
		);
		const warnings = warningsOf(content);
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].source, "focus_a");
		assert.deepStrictEqual(warnings[0].relatedSources, ["focus_b"]);
		assert.strictEqual(
			warnings[0].text,
			"Focuses focus_a and focus_b are less than 2 apart on the same row, so their icons overlap.",
		);
	});

	it("warns when two focuses share the same position", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 0, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a, focus_b share the same position, so their icons overlap.",
		]);
	});

	it("collapses a stack of same-position focuses into one warning", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 0, 0),
			focusBlock("focus_c", 0, 0),
		);
		const warnings = warningsOf(content);
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].source, "focus_a");
		assert.deepStrictEqual(warnings[0].relatedSources, ["focus_b", "focus_c"]);
		assert.strictEqual(
			warnings[0].text,
			"Focuses focus_a, focus_b, focus_c share the same position, so their icons overlap.",
		);
	});

	it("still warns for a focus one apart from a same-position stack", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 0, 0),
			focusBlock("focus_c", 1, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a, focus_b share the same position, so their icons overlap.",
			"Focuses focus_a and focus_c are less than 2 apart on the same row, so their icons overlap.",
			"Focuses focus_b and focus_c are less than 2 apart on the same row, so their icons overlap.",
		]);
	});

	it("reports no warning for focuses two apart on the same row", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 2, 0),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("reports no warning for focuses stacked on the same column", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0),
			focusBlock("focus_b", 0, 1),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("checks positions resolved through relative_position_id", () => {
		const content = treeWithFocuses(
			focusBlock("focus_base", 0, -6),
			focusBlock(
				"focus_a",
				0,
				5,
				"relative_position_id = focus_base prerequisite = { focus = focus_b }",
			),
			focusBlock("focus_b", 0, 0),
		);
		// focus_a resolves to y = 5 - 6 = -1, so the raw check (focus_b at y=0 is above y=5)
		// would pass; the resolved check must flag it.
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite focus_b of focus focus_a is not positioned above it.",
		]);
	});

	it("checks Y resolved through relative_position_id for exclusivity", () => {
		const clean = treeWithFocuses(
			focusBlock("focus_base", 0, 6),
			focusBlock(
				"focus_a",
				5,
				-5,
				"relative_position_id = focus_base mutually_exclusive = { focus = focus_b }",
			),
			focusBlock("focus_b", 8, 1),
		);
		// focus_a resolves to y = -5 + 6 = 1, matching focus_b.
		assert.deepStrictEqual(warningTexts(clean), []);

		const broken = treeWithFocuses(
			focusBlock("focus_base", 0, 6),
			focusBlock(
				"focus_a",
				5,
				-5,
				"relative_position_id = focus_base mutually_exclusive = { focus = focus_b }",
			),
			focusBlock("focus_b", 8, 3),
		);
		assert.deepStrictEqual(warningTexts(broken), [
			"Mutually exclusive focuses focus_a and focus_b are not on the same row.",
		]);
	});

	it("reports overlap for negative coordinates", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", -1, 0),
			focusBlock("focus_b", 0, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a and focus_b are less than 2 apart on the same row, so their icons overlap.",
		]);
	});

	it("reports all three layout warnings in one tree", () => {
		const content = treeWithFocuses(
			focusBlock("dep", 0, 0, "prerequisite = { focus = req }"),
			focusBlock("req", 0, 2),
			focusBlock("ex_a", 0, 3, "mutually_exclusive = { focus = ex_b }"),
			focusBlock("ex_b", 2, 4),
			focusBlock("ov_a", 0, 5),
			focusBlock("ov_b", 1, 5),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite req of focus dep is not positioned above it.",
			"Mutually exclusive focuses ex_a and ex_b are not on the same row.",
			"Focuses ov_a and ov_b are less than 2 apart on the same row, so their icons overlap.",
		]);
	});

	it("terminates and warns on a circular relative_position_id chain", () => {
		const content = treeWithFocuses(
			focusBlock(
				"focus_a",
				0,
				0,
				"relative_position_id = focus_b prerequisite = { focus = focus_c }",
			),
			focusBlock("focus_b", 0, 1, "relative_position_id = focus_a"),
			focusBlock("focus_c", 0, 5),
		);
		// The cycle is cut (a + b), so focus_a resolves to (0, 1) and focus_c at y=5 is below it.
		const texts = warningTexts(content);
		assert.ok(
			texts.includes(
				"Prerequisite focus_c of focus focus_a is not positioned above it.",
			),
		);
	});

	it("reports no layout warnings for shared_focus blocks", () => {
		const content = `shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}
shared_focus = {
    id = SH_b
    focus = { id = sh_b1 x = 0 y = 0 }
}`;
		// The container blocks (SH_a, SH_b) are unwrapped into their real children (sh_a1, sh_b1)
		// instead of becoming position-less pseudo focuses, so there's nothing to warn about.
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("reports no layout warnings for joint_focus blocks", () => {
		const content = `joint_focus = {
    focus = { id = j_a x = 0 y = 0 }
    focus = { id = j_b x = 1 y = 0 }
}`;
		// The id-less joint container is unwrapped into j_a/j_b, both of which have real ids, so
		// the pre-existing focusnoid warning for the container itself no longer applies.
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("skips shared focuses merged into the tree from another file", () => {
		const sharedFile = convertFocusFileNodeToJson(
			parseHoi4File(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}`),
			{},
		);
		const sharedTrees = getFocusTreeWithFocusFile(
			sharedFile,
			[],
			"common/national_focus/shared.txt",
			{},
		);

		const flags = require("../util/featureflags") as {
			useConditionInFocus: boolean;
		};
		flags.useConditionInFocus = true;
		try {
			const mainContent = treeWithFocuses(
				focusBlock("m1", 0, 0),
				focusBlock("m2", 0, 1),
			).replace("id = test_tree", "id = test_tree\n    shared_focus = sh_a1");
			// The merge only looks at sharedFocusTrees, so drive it through the same path the loader uses.
			const mainFile = convertFocusFileNodeToJson(
				parseHoi4File(mainContent),
				{},
			);
			const merged = getFocusTreeWithFocusFile(
				mainFile,
				sharedTrees,
				filePath,
				{},
			);
			const main = merged.find((t) => t.id === "test_tree");
			assert.ok(
				main?.focuses["sh_a1"],
				"shared focus must be merged for this test to be meaningful",
			);
			// sh_a1 sits at (0,0) like m1, but it lives in another file, so no overlap warning.
			assert.deepStrictEqual(
				(main?.warnings ?? []).map((w) => w.text),
				[],
			);
		} finally {
			flags.useConditionInFocus = false;
		}
	});

	it("flattens nested focus entries inside a shared_focus block into their real ids and positions", () => {
		const content = `shared_focus = {
    id = SH_test
    focus = { id = sh_a x = 0 y = 0 }
    focus = { id = sh_b x = 0 y = 1 }
}`;
		const trees = treesOf(content);
		assert.strictEqual(trees.length, 1);
		assert.deepStrictEqual(Object.keys(trees[0].focuses).sort(), [
			"sh_a",
			"sh_b",
		]);
		assert.strictEqual(trees[0].focuses.sh_a.x, 0);
		assert.strictEqual(trees[0].focuses.sh_a.y, 0);
		assert.strictEqual(trees[0].focuses.sh_b.y, 1);
	});

	it("recurses through more than one level of nested focus containers", () => {
		const content = `shared_focus = {
    id = SH_group
    focus = {
        id = SH_mid
        focus = { id = sh_leaf x = 3 y = 4 }
    }
}`;
		const trees = treesOf(content);
		assert.deepStrictEqual(Object.keys(trees[0].focuses), ["sh_leaf"]);
		assert.strictEqual(trees[0].focuses.sh_leaf.x, 3);
		assert.strictEqual(trees[0].focuses.sh_leaf.y, 4);
	});

	it("still treats a shared_focus block with no nested focus as a single focus", () => {
		const content = `shared_focus = {
    id = SH_solo
    x = 3
    y = 4
}`;
		const trees = treesOf(content);
		assert.deepStrictEqual(Object.keys(trees[0].focuses), ["SH_solo"]);
		assert.strictEqual(trees[0].focuses.SH_solo.x, 3);
		assert.strictEqual(trees[0].focuses.SH_solo.y, 4);
	});

	it("flattens nested focus entries inside a joint_focus block", () => {
		const content = `joint_focus = {
    focus = { id = j_a x = 0 y = 0 }
    focus = { id = j_b x = 1 y = 0 }
}`;
		const trees = treesOf(content);
		assert.deepStrictEqual(Object.keys(trees[0].focuses).sort(), [
			"j_a",
			"j_b",
		]);
	});

	it("indexes ids from nested shared_focus/joint_focus blocks for the shared focus index", () => {
		const content = `shared_focus = {
    id = SH_group
    focus = { id = sh_a x = 0 y = 0 }
    focus = { id = sh_b x = 0 y = 1 }
}
joint_focus = {
    focus = { id = j_a x = 0 y = 0 }
}`;
		const ids = extractFocusIds(parseHoi4File(content));
		assert.deepStrictEqual(ids.sort(), ["j_a", "sh_a", "sh_b"]);
	});

	it("parses block-form shared_focus references like the single-symbol form", () => {
		const single = treeWithFocuses(focusBlock("m1", 0, 0)).replace(
			"id = test_tree",
			"id = test_tree\n    shared_focus = SH_a\n    shared_focus = SH_b",
		);
		const block = treeWithFocuses(focusBlock("m1", 0, 0)).replace(
			"id = test_tree",
			"id = test_tree\n    shared_focus = { SH_a SH_b }",
		);

		const idsOf = (content: string) => {
			const file = convertFocusFileNodeToJson(parseHoi4File(content), {});
			return extractOrListIds(file.focus_tree[0].shared_focus);
		};

		assert.deepStrictEqual(idsOf(block), ["SH_a", "SH_b"]);
		assert.deepStrictEqual(idsOf(single), idsOf(block));
	});

	it("merges shared focuses referenced via block-form shared_focus = { A B }", () => {
		const sharedFile = convertFocusFileNodeToJson(
			parseHoi4File(`shared_focus = {
    id = SH_a
    x = 0
    y = 0
}
shared_focus = {
    id = SH_b
    x = 0
    y = 1
}`),
			{},
		);
		const sharedTrees = getFocusTreeWithFocusFile(
			sharedFile,
			[],
			"common/national_focus/shared.txt",
			{},
		);

		const flags = require("../util/featureflags") as {
			useConditionInFocus: boolean;
		};
		flags.useConditionInFocus = true;
		try {
			const mainContent = treeWithFocuses(focusBlock("m1", 0, 0)).replace(
				"id = test_tree",
				"id = test_tree\n    shared_focus = { SH_a SH_b }",
			);
			const mainFile = convertFocusFileNodeToJson(
				parseHoi4File(mainContent),
				{},
			);
			const merged = getFocusTreeWithFocusFile(
				mainFile,
				sharedTrees,
				filePath,
				{},
			);
			const main = merged.find((t) => t.id === "test_tree");
			assert.ok(main?.focuses["SH_a"], "SH_a must be merged in");
			assert.ok(main?.focuses["SH_b"], "SH_b must be merged in");
		} finally {
			flags.useConditionInFocus = false;
		}
	});
});
