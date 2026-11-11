import * as assert from "assert";
import { FilePrecedenceIndex } from "../../../util/filePrecedenceIndex";

describe("util/filePrecedenceIndex", () => {
	it("retains competing values through replacement, removal and reintroduction", () => {
		const half = new FilePrecedenceIndex<string>();
		half.setFile("z", { duplicate: "z", unique: "only z" });
		half.setFile("a", { duplicate: "a" });
		half.setFile("m", { duplicate: "m" });
		assert.strictEqual(half.index.duplicate, "z");
		half.removeFile("a");
		assert.strictEqual(half.index.duplicate, "z");
		half.setFile("z", {});
		assert.strictEqual(half.index.duplicate, "m");
		assert.strictEqual(half.index.unique, undefined);
		half.setFile("a", { duplicate: "new a" });
		half.removeFile("m");
		assert.strictEqual(half.index.duplicate, "new a");
		half.removeFile("a");
		assert.strictEqual(half.index.duplicate, undefined);
	});

	it("compares mixed-case paths ordinally and handles prototype-like keys", () => {
		const half = new FilePrecedenceIndex<string>();
		half.setFile("z", JSON.parse('{"__proto__":"z","constructor":"z"}'));
		half.setFile("Z", JSON.parse('{"__proto__":"Z","constructor":"Z"}'));
		assert.strictEqual(half.index.__proto__, "z");
		assert.strictEqual(half.index.constructor, "z");
	});

	it("snapshots actual per-file values and empty files independently of later edits", () => {
		const half = new FilePrecedenceIndex<string>();
		half.setFile("b", { duplicate: "b" });
		half.setFile("a", { duplicate: "a" });
		half.setFile("empty", {});
		const records = half.records();
		half.setFile("a", { duplicate: "edited" });
		assert.deepStrictEqual(records, [
			{ file: "a", entries: { duplicate: "a" } },
			{ file: "b", entries: { duplicate: "b" } },
			{ file: "empty", entries: {} },
		]);
	});
});
