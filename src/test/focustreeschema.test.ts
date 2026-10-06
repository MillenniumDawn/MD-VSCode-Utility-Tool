import * as assert from "assert";
import { parseHoi4File } from "../hoiformat/hoiparser";
import {
	convertFocusFileNodeToJson,
	extractFocusIds,
	extractOrListIds,
	getFocusTreeWithFocusFile,
	FocusTree,
	importedPseudoTreesToShow,
	focusTreesToDisplay,
	FocusWarning,
} from "../previewdef/focustree/schema";
import { refreshFeatureFlags } from "../util/featureflags";
import { stubVscode, restoreVscodeStubs } from "./_vscode_stub";

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

// Builds a shared focus file, then a tree in another file that pulls focuses out of it. The merge
// only looks at sharedFocusTrees, so this drives the same path the loader does. Each reference
// becomes one `shared_focus = <ref>` line, so the block form `{ SH_a SH_b }` works as a reference.
function mergeSharedFocuses(
	sharedContent: string,
	sharedFocusRefs: string[],
	...focuses: string[]
): { donor: FocusTree; host: FocusTree } {
	const donors = getFocusTreeWithFocusFile(
		convertFocusFileNodeToJson(parseHoi4File(sharedContent), {}),
		[],
		"common/national_focus/shared.txt",
		{},
	);

	stubVscode({ configuration: { useConditionInFocus: true } });
	refreshFeatureFlags();
	try {
		const references = sharedFocusRefs
			.map((ref) => `\n    shared_focus = ${ref}`)
			.join("");
		const content = treeWithFocuses(...focuses).replace(
			"id = test_tree",
			`id = test_tree${references}`,
		);
		const trees = getFocusTreeWithFocusFile(
			convertFocusFileNodeToJson(parseHoi4File(content), {}),
			donors,
			filePath,
			{},
		);
		const host = trees.find((t) => t.id === "test_tree");
		assert.ok(host, "the merging tree must exist");
		return { donor: donors[0], host };
	} finally {
		restoreVscodeStubs();
		refreshFeatureFlags();
	}
}

// Parses one file with useConditionInFocus on, so a focus_tree merges the file's own shared focuses.
function treesWithSharedFocuses(content: string): FocusTree[] {
	stubVscode({ configuration: { useConditionInFocus: true } });
	refreshFeatureFlags();
	try {
		return treesOf(content);
	} finally {
		restoreVscodeStubs();
		refreshFeatureFlags();
	}
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

	// A shared focus moved per importing tree by `offset = { trigger = { has_focus_tree = X } }`
	// carries everything placed relative to it, as in 05_Australia.txt's AST_the_lucky_country.
	const sharedWithTreeOffset = (treeId: string) => `shared_focus = {
    id = sh_root
    x = 0
    y = 0
    offset = {
        x = 9
        y = 0
        trigger = { has_focus_tree = tree_a }
    }
}
shared_focus = {
    id = sh_child
    x = 0
    y = 1
    relative_position_id = sh_root
    prerequisite = { focus = sh_root }
}
focus_tree = {
    id = ${treeId}
    shared_focus = sh_root
    ${focusBlock("own_root", 4, 0)}
    ${focusBlock("own_child", 0, 1, "prerequisite = { focus = own_root }")}
}`;

	it("applies a has_focus_tree offset for the tree being checked", () => {
		const tree = treesWithSharedFocuses(sharedWithTreeOffset("tree_a")).find(
			(t) => t.id === "tree_a",
		);
		assert.ok(tree?.focuses["sh_child"], "the shared branch must be merged");
		assert.deepStrictEqual(
			tree.warnings.map((w) => w.text),
			[],
		);
	});

	it("leaves a has_focus_tree offset for another tree unapplied", () => {
		const tree = treesWithSharedFocuses(sharedWithTreeOffset("tree_b")).find(
			(t) => t.id === "tree_b",
		);
		assert.deepStrictEqual(
			tree?.warnings.map((w) => w.text),
			[
				"Focuses own_child, sh_child share the same position, so their icons overlap.",
			],
		);
	});

	it("does not apply an offset whose trigger also tests something else", () => {
		const content = sharedWithTreeOffset("tree_a").replace(
			"trigger = { has_focus_tree = tree_a }",
			"trigger = { has_focus_tree = tree_a has_country_flag = moved }",
		);
		const tree = treesWithSharedFocuses(content).find((t) => t.id === "tree_a");
		assert.deepStrictEqual(
			tree?.warnings.map((w) => w.text),
			[
				"Focuses own_child, sh_child share the same position, so their icons overlap.",
			],
		);
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

	// Alternatives gated on one flag and on its negation are never on screen together, so the mod
	// draws them, and everything below them, on the same spots.
	const flagSet = "allow_branch = { has_country_flag = split_happened }";
	const flagUnset =
		"allow_branch = { NOT = { has_country_flag = split_happened } }";

	it("reports no overlap for focuses whose allow_branch conditions contradict", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, flagSet),
			focusBlock("focus_b", 0, 0, flagUnset),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("reports no overlap for the branches below contradicting allow_branch focuses", () => {
		const content = treeWithFocuses(
			focusBlock("focus_root", 0, 0),
			focusBlock(
				"focus_a",
				6,
				1,
				`relative_position_id = focus_root prerequisite = { focus = focus_root } ${flagSet}`,
			),
			focusBlock(
				"focus_b",
				6,
				1,
				`relative_position_id = focus_root prerequisite = { focus = focus_root } ${flagUnset}`,
			),
			focusBlock(
				"focus_a_child",
				0,
				1,
				"relative_position_id = focus_a prerequisite = { focus = focus_a }",
			),
			focusBlock(
				"focus_b_child",
				0,
				1,
				"relative_position_id = focus_b prerequisite = { focus = focus_b }",
			),
			focusBlock(
				"focus_a_grandchild",
				-2,
				1,
				"relative_position_id = focus_a_child prerequisite = { focus = focus_a_child }",
			),
			focusBlock(
				"focus_b_grandchild",
				-1,
				1,
				"relative_position_id = focus_b_child prerequisite = { focus = focus_b_child }",
			),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	// Gates on unrelated flags are how mods draw alternative branches on one spot (05_poland.txt):
	// the flags come from exclusive focuses or event options, which no condition here can show.
	it("reports no overlap for focuses under different allow_branch gates", () => {
		const content = treeWithFocuses(
			focusBlock("focus_root", 0, 0),
			focusBlock(
				"branch_a",
				0,
				1,
				"relative_position_id = focus_root allow_branch = { has_country_flag = path_a }",
			),
			focusBlock(
				"branch_b",
				0,
				1,
				"relative_position_id = focus_root allow_branch = { has_country_flag = path_b }",
			),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("reports no overlap for the branches below different allow_branch gates", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, "allow_branch = { has_country_flag = f }"),
			focusBlock("focus_b", 4, 0, "allow_branch = { has_country_flag = g }"),
			focusBlock("focus_a_child", 2, 1, "prerequisite = { focus = focus_a }"),
			focusBlock("focus_b_child", 3, 1, "prerequisite = { focus = focus_b }"),
		);
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("still warns for two focuses under the same allow_branch gate", () => {
		const content = treeWithFocuses(
			focusBlock("focus_gate", 0, 0, "allow_branch = { has_country_flag = f }"),
			focusBlock("focus_a", 0, 1, "prerequisite = { focus = focus_gate }"),
			focusBlock("focus_b", 0, 1, "prerequisite = { focus = focus_gate }"),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a, focus_b share the same position, so their icons overlap.",
		]);
	});

	it("still warns for a focus nested under a second gate inside the first", () => {
		const content = treeWithFocuses(
			focusBlock("focus_gate", 0, 0, "allow_branch = { has_country_flag = f }"),
			focusBlock("focus_a", 0, 1, "prerequisite = { focus = focus_gate }"),
			focusBlock(
				"focus_b",
				0,
				1,
				"prerequisite = { focus = focus_gate } allow_branch = { has_country_flag = g }",
			),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a, focus_b share the same position, so their icons overlap.",
		]);
	});

	it("keeps a stack member without allow_branch that overlaps both alternatives", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, flagSet),
			focusBlock("focus_b", 0, 0, flagUnset),
			focusBlock("focus_c", 0, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a, focus_b, focus_c share the same position, so their icons overlap.",
		]);
	});

	it("drops only the alternatives from a stack when nothing else shares their spot", () => {
		const content = treeWithFocuses(
			focusBlock("focus_a", 0, 0, flagSet),
			focusBlock("focus_b", 0, 0, flagUnset),
			focusBlock("focus_c", 1, 0),
		);
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses focus_a and focus_c are less than 2 apart on the same row, so their icons overlap.",
			"Focuses focus_b and focus_c are less than 2 apart on the same row, so their icons overlap.",
		]);
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

	it("reports layout warnings for shared_focus blocks", () => {
		const content = `shared_focus = {
    id = SH_a
    focus = { id = sh_root x = 0 y = 0 }
    focus = { id = sh_a1 x = 0 y = 1 prerequisite = { focus = sh_root } }
}
shared_focus = {
    id = SH_b
    focus = { id = sh_b1 x = 0 y = 1 prerequisite = { focus = sh_root } }
}`;
		// The container blocks (SH_a, SH_b) are unwrapped into their real children, so the
		// synthetic <Shared focuses> tree has real coordinates to check.
		assert.deepStrictEqual(warningTexts(content), [
			"Focuses sh_a1, sh_b1 share the same position, so their icons overlap.",
		]);
	});

	// 00_music_dlc_compatibility.txt: placeholders no tree imports, all at (0, 0).
	it("does not check shared focuses no single import brings in together", () => {
		const content = `shared_focus = { id = SPA_a_great_spain x = 0 y = 0 }
shared_focus = { id = SPR_the_popular_front x = 0 y = 0 }
shared_focus = { id = SOV_raskovas_aviation_group x = 0 y = 0 }`;
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("does not check the branches of separately imported shared roots against each other", () => {
		const content = `shared_focus = { id = sh_a x = 0 y = 0 }
shared_focus = { id = sh_a1 x = 0 y = 1 prerequisite = { focus = sh_a } }
shared_focus = { id = sh_b x = 4 y = 0 }
shared_focus = { id = sh_b1 x = 1 y = 1 prerequisite = { focus = sh_b } }`;
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("checks a joint focus against the shared focuses imported with it", () => {
		const content = `joint_focus = { id = j_root x = 0 y = 0 }
joint_focus = { id = j_child x = 0 y = 1 prerequisite = { focus = j_root } }
shared_focus = { id = sh_child x = 1 y = 1 prerequisite = { focus = j_child } }
shared_focus = { id = sh_other x = 1 y = 1 prerequisite = { focus = j_root } }`;
		// sh_child and sh_other both come in with j_root, so the shared tree flags them.
		assert.deepStrictEqual(
			treesOf(content).map((t) => t.warnings.map((w) => w.text)),
			[
				["Focuses sh_child, sh_other share the same position, so their icons overlap."],
				[],
			],
		);
	});

	it("reports layout warnings for joint_focus blocks", () => {
		const content = `joint_focus = {
    focus = { id = j_a x = 0 y = 0 prerequisite = { focus = j_b } }
    focus = { id = j_b x = 4 y = 1 }
}`;
		assert.deepStrictEqual(warningTexts(content), [
			"Prerequisite j_b of focus j_a is not positioned above it.",
		]);
	});

	it("flags the synthetic joint_focus tree as isSharedFocues, same as a shared_focus tree", () => {
		const content = `joint_focus = {
    focus = { id = j_a x = 0 y = 0 }
}`;
		const trees = treesOf(content);
		assert.strictEqual(trees.length, 1);
		assert.strictEqual(trees[0].isSharedFocues, true);
	});

	it("accepts a relative_position_id pointing outside a shared focus file", () => {
		// A shared file is a fragment: the game resolves the anchor once the focus is merged into
		// a country tree, so a target defined in another file is legal here.
		const content = `shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 relative_position_id = OUTSIDE_ANCHOR }
}`;
		assert.deepStrictEqual(warningTexts(content), []);
	});

	it("still reports a circular relative_position_id chain in a shared focus file", () => {
		const content = `shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 relative_position_id = sh_b1 }
    focus = { id = sh_b1 x = 5 y = 1 relative_position_id = sh_a1 }
}`;
		const texts = warningTexts(content);
		assert.ok(
			texts.some((t) => t.includes("circular reference")),
			`expected a circular reference warning, got ${JSON.stringify(texts)}`,
		);
	});

	// 06_czehcoslavakia_shared.txt hangs shared focuses off joint focuses of the same file.
	it("resolves a shared focus anchored on a joint focus of the same file", () => {
		const content = `shared_focus = { id = ROOT_F x = 0 y = 0 }
joint_focus = { id = JOINT_A x = -6 y = 1 relative_position_id = ROOT_F }
joint_focus = { id = JOINT_B x = 6 y = 1 relative_position_id = ROOT_F }
shared_focus = { id = LEFT_F x = 0 y = 1 relative_position_id = JOINT_A }
shared_focus = { id = RIGHT_F x = 0 y = 1 relative_position_id = JOINT_B }`;
		const trees = treesOf(content);
		assert.deepStrictEqual(
			trees.map((t) => t.warnings.map((w) => w.text)),
			[[], []],
		);
		assert.deepStrictEqual(Object.keys(trees[0].anchorFocuses ?? {}).sort(), [
			"JOINT_A",
			"JOINT_B",
		]);
		assert.deepStrictEqual(Object.keys(trees[1].anchorFocuses ?? {}).sort(), [
			"LEFT_F",
			"RIGHT_F",
			"ROOT_F",
		]);
	});

	it("gives a pseudo-tree no anchors when its file has only one kind of focus", () => {
		const trees = treesOf("shared_focus = { id = SH_a x = 0 y = 0 }");
		assert.strictEqual(trees[0].anchorFocuses, undefined);
	});

	it("merges the shared focuses that depend on an imported joint focus", () => {
		const { host } = mergeSharedFocuses(
			`joint_focus = { id = j_root x = 0 y = 0 }
shared_focus = {
    id = sh_child
    x = 0
    y = 1
    relative_position_id = j_root
    prerequisite = { focus = j_root }
}`,
			["j_root"],
			focusBlock("m1", 10, 0),
		);
		assert.deepStrictEqual(Object.keys(host.focuses).sort(), [
			"j_root",
			"m1",
			"sh_child",
		]);
		assert.deepStrictEqual(host.warnings, []);
	});

	it("merges a joint focus imported by a tree in the same file", () => {
		const tree = treeWithFocuses(focusBlock("m1", 10, 0)).replace(
			"id = test_tree",
			"id = test_tree shared_focus = j_root",
		);
		const trees = treesWithSharedFocuses(
			`joint_focus = { id = j_root x = 0 y = 0 }\n${tree}`,
		);
		const merged = trees.find((t) => t.id === "test_tree");
		assert.ok(merged?.focuses["j_root"], "the joint focus must be merged");
	});

	it("checks shared focuses merged in from another file against each other", () => {
		const { host } = mergeSharedFocuses(
			`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
    focus = { id = sh_a2 x = 1 y = 0 }
}`,
			["sh_a1", "sh_a2"],
			focusBlock("m1", 10, 0),
		);
		assert.ok(host.focuses["sh_a2"], "both shared focuses must be merged");
		assert.deepStrictEqual(
			host.warnings.map((w) => w.text),
			[
				"Focuses sh_a1 and sh_a2 are less than 2 apart on the same row, so their icons overlap.",
			],
		);
	});

	it("drops an imported shared focus tree whose focuses were merged into the file's tree", () => {
		const { donor, host } = mergeSharedFocuses(
			`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}`,
			["sh_a1"],
			focusBlock("m1", 10, 0),
		);
		assert.deepStrictEqual(importedPseudoTreesToShow([host], [donor]), []);
	});

	it("keeps an imported shared focus tree the file's tree does not merge from", () => {
		const donor = treesOf(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}`)[0];
		const host = treesOf(treeWithFocuses(focusBlock("m1", 0, 0)))[0];
		assert.deepStrictEqual(importedPseudoTreesToShow([host], [donor]), [donor]);
	});

	it("never adds an imported ordinary focus tree", () => {
		const imported = treesOf(treeWithFocuses(focusBlock("other", 0, 0)))[0];
		assert.deepStrictEqual(importedPseudoTreesToShow([], [imported]), []);
	});

	it("offers only a file's own focus trees when it also defines shared focuses", () => {
		const trees = treesOf(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}
focus_tree = {
    id = tree_a
    ${focusBlock("a1", 0, 0)}
}
focus_tree = {
    id = tree_b
    ${focusBlock("b1", 0, 0)}
}`);
		assert.strictEqual(trees.length, 3, "the loader result keeps the shared pseudo-tree");
		assert.deepStrictEqual(
			focusTreesToDisplay(trees).map((t) => t.id),
			["tree_a", "tree_b"],
		);
	});

	it("offers a single focus tree alone, without its shared focuses", () => {
		const trees = treesOf(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}
${treeWithFocuses(focusBlock("m1", 0, 0))}`);
		assert.deepStrictEqual(
			focusTreesToDisplay(trees).map((t) => t.id),
			["test_tree"],
		);
	});

	it("still offers the pseudo-trees of a file with only shared and joint focuses", () => {
		const trees = treesOf(`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}
joint_focus = {
    id = JF_a
    focus = { id = jf_a1 x = 0 y = 0 }
}`);
		assert.strictEqual(trees.length, 2);
		assert.deepStrictEqual(focusTreesToDisplay(trees), trees);
	});

	it("does not check a merged shared focus against the tree's own focuses", () => {
		// sh_a1 sits at (0,0) like m1, but an offset block places a shared focus per country and
		// this check ignores those, so the pair is left alone.
		const { host } = mergeSharedFocuses(
			`shared_focus = {
    id = SH_a
    focus = { id = sh_a1 x = 0 y = 0 }
}`,
			["sh_a1"],
			focusBlock("m1", 0, 0),
			focusBlock("m2", 0, 1),
		);
		assert.ok(host.focuses["sh_a1"], "the shared focus must be merged");
		assert.deepStrictEqual(host.warnings, []);
	});

	it("does not replay a shared tree's layout warnings into the tree that merges from it", () => {
		const { donor, host } = mergeSharedFocuses(
			`shared_focus = {
    id = SH_a
    focus = { id = sh_root x = 5 y = 0 }
    focus = { id = sh_gate x = 10 y = 0 }
    focus = { id = sh_a1 x = 0 y = 1 prerequisite = { focus = sh_root } }
}
shared_focus = {
    id = SH_b
    focus = {
        id = sh_b1
        x = 0
        y = 1
        prerequisite = { focus = sh_root }
        prerequisite = { focus = sh_gate }
    }
}`,
			["sh_root"],
			focusBlock("m1", 0, 0),
			focusBlock("m2", 0, 2),
		);
		assert.deepStrictEqual(
			donor.warnings.map((w) => w.text),
			["Focuses sh_a1, sh_b1 share the same position, so their icons overlap."],
		);
		assert.ok(host.focuses["sh_a1"], "the shared focus must be merged");
		assert.strictEqual(host.focuses["sh_b1"], undefined);
		// Only sh_a1 came across, so the stack the shared file reports doesn't exist here.
		assert.deepStrictEqual(host.warnings, []);
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
		const { host } = mergeSharedFocuses(
			`shared_focus = {
    id = SH_a
    x = 0
    y = 0
}
shared_focus = {
    id = SH_b
    x = 0
    y = 1
}`,
			["{ SH_a SH_b }"],
			focusBlock("m1", 0, 0),
		);
		assert.ok(host.focuses["SH_a"], "SH_a must be merged in");
		assert.ok(host.focuses["SH_b"], "SH_b must be merged in");
	});
});

describe("focus tree initial_show_position", () => {
	it("reads the grid position form", () => {
		const [tree] = treesOf(`focus_tree = {
    id = test_tree
    initial_show_position = { x = 80 y = 0 }
    ${focusBlock("TST_a", 0, 0)}
}`);
		assert.deepStrictEqual(tree.initialShowPosition, { x: 80, y: 0 });
	});

	it("reads the focus form", () => {
		const [tree] = treesOf(`focus_tree = {
    id = test_tree
    initial_show_position = {
        focus = TST_a
    }
    ${focusBlock("TST_a", 3, 1)}
}`);
		assert.deepStrictEqual(tree.initialShowPosition, { focus: "TST_a", x: 0, y: 0 });
	});

	it("leaves a tree without one undefined", () => {
		const [tree] = treesOf(treeWithFocuses(focusBlock("TST_a", 0, 0)));
		assert.strictEqual(tree.initialShowPosition, undefined);
	});
});

describe("focus tree shortcuts", () => {
	it("reads the shortcuts in file order, ignoring the zoom and the trigger", () => {
		const [tree] = treesOf(`focus_tree = {
    id = test_tree
    shortcut = {
        name = TST_first_shortcut
        target = TST_b
        scroll_wheel_factor = 0.80
    }
    shortcut = {
        name = "TST_second_shortcut"
        target = TST_a
        scroll_wheel_factor = 0.80
        trigger = { has_country_flag = TST_flag }
    }
    ${focusBlock("TST_a", 0, 0)}
    ${focusBlock("TST_b", 1, 0)}
}`);
		assert.deepStrictEqual(tree.shortcuts, [
			{ name: "TST_first_shortcut", target: "TST_b" },
			{ name: "TST_second_shortcut", target: "TST_a" },
		]);
	});

	it("skips a shortcut without a target", () => {
		const [tree] = treesOf(`focus_tree = {
    id = test_tree
    shortcut = { name = TST_broken }
    ${focusBlock("TST_a", 0, 0)}
}`);
		assert.deepStrictEqual(tree.shortcuts, []);
	});

	it("gives a tree without shortcuts none", () => {
		const [tree] = treesOf(treeWithFocuses(focusBlock("TST_a", 0, 0)));
		assert.deepStrictEqual(tree.shortcuts, []);
	});
});

describe("previewdef/focustree continuousFocusSource", () => {
	it("points a focus_tree at its own key", () => {
		const content = `\nfocus_tree = {\n    id = a\n}\nfocus_tree = {\n    id = b\n}`;
		const trees = treesOf(content);
		assert.deepStrictEqual(
			trees.map((t) => t.continuousFocusSource),
			[
				{ file: filePath, start: content.indexOf("focus_tree") },
				{ file: filePath, start: content.lastIndexOf("focus_tree") },
			],
		);
	});

	it("leaves shared and joint focus trees without one", () => {
		const content = `shared_focus = { id = SH_a x = 0 y = 0 }\njoint_focus = { id = JO_a x = 0 y = 0 }`;
		const trees = treesOf(content);
		assert.strictEqual(trees.length, 2);
		assert.ok(trees.every((t) => t.continuousFocusSource === undefined));
	});
});
