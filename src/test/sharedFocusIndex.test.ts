import * as assert from "assert";
import { findFileByFocusKey, registerSharedFocusIndex } from "../util/sharedFocusIndex";

describe("util/sharedFocusIndex", () => {
	it("findFileByFocusKey returns undefined for unknown key", () => {
		assert.strictEqual(findFileByFocusKey("nonexistent_key_123"), undefined);
	});

	it("registerSharedFocusIndex returns a disposable", () => {
		const disposable = registerSharedFocusIndex();
		assert.ok(disposable);
		assert.strictEqual(typeof disposable.dispose, "function");
		disposable.dispose();
	});
});
