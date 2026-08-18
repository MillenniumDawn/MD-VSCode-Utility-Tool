import * as assert from "assert";
import { resolveInlaysForTree } from "../previewdef/focustree/inlay";
import { FocusTreeInlay, FocusTreeInlayRef } from "../previewdef/focustree/schema";

function inlay(id: string, file: string): FocusTreeInlay {
	return {
		id,
		file,
		token: undefined,
		internal: false,
		visible: true,
		position: { x: 0, y: 0 },
		scriptedImages: [],
		scriptedButtons: [],
		conditionExprs: [],
	};
}

function ref(id: string, x: number, y: number): FocusTreeInlayRef {
	return {
		id,
		position: { x, y },
		file: "common/national_focus/test.txt",
		token: undefined,
	};
}

describe("previewdef/focustree inlay resolveInlaysForTree", () => {
	it("resolves multiple refs to their matching inlay", () => {
		const allInlays = [inlay("inlay_a", "a.txt"), inlay("inlay_b", "b.txt")];
		const refs = [ref("inlay_a", 1, 2), ref("inlay_b", 3, 4)];

		const { inlayWindows, warnings } = resolveInlaysForTree(refs, allInlays);

		assert.strictEqual(inlayWindows.length, 2);
		assert.strictEqual(inlayWindows[0].id, "inlay_a");
		assert.deepStrictEqual(inlayWindows[0].position, { x: 1, y: 2 });
		assert.strictEqual(inlayWindows[1].id, "inlay_b");
		assert.deepStrictEqual(inlayWindows[1].position, { x: 3, y: 4 });
		assert.strictEqual(warnings.length, 0);
	});

	it("warns and skips a ref with no matching inlay", () => {
		const allInlays = [inlay("inlay_a", "a.txt")];
		const refs = [ref("missing_inlay", 0, 0)];

		const { inlayWindows, warnings } = resolveInlaysForTree(refs, allInlays);

		assert.strictEqual(inlayWindows.length, 0);
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].source, "missing_inlay");
	});

	it("resolves a duplicated inlay id to the first occurrence", () => {
		const first = inlay("dup_inlay", "first.txt");
		const second = inlay("dup_inlay", "second.txt");
		const refs = [ref("dup_inlay", 5, 6)];

		const { inlayWindows } = resolveInlaysForTree(refs, [first, second]);

		assert.strictEqual(inlayWindows.length, 1);
		assert.strictEqual(inlayWindows[0].file, "first.txt");
	});
});
