import * as assert from "assert";

const { bulletsFromPullRequests } = require("../../../../../scripts/pr-bullets");
const { select } = require("../../../../../scripts/select-bullets");

describe("scripts/pr-bullets", () => {
	it("omits no-changelog bullets while retaining the pull request in release coverage", () => {
		const collected = bulletsFromPullRequests([
			{ number: 533, title: "Internal release pipeline change", labels: [{ name: "no-changelog" }], files: ["scripts/pr-bullets.js"] },
			{ number: 534, title: "Improve the focus tree preview", labels: ["enhancement"], files: ["src/previewdef/focustree/preview.ts"] },
			{ number: 535, title: "Dependency update", user: { login: "dependabot[bot]" } },
			{ number: 536, title: "Document the release", files: ["CHANGELOG.md"] },
		]);

		assert.deepStrictEqual(collected.pullRequests, [533, 534, 536]);
		assert.deepStrictEqual(collected.bullets, ["", "- [ Focus Tree ] Improve the focus tree preview.", "- Document the release."]);
		assert.strictEqual(collected.entries[0].noChangelog, true);
		assert.strictEqual(collected.entries[1].noChangelog, undefined);
		assert.strictEqual(collected.entries[2].wroteChangelog, true);

		const selected = select(collected, {});
		assert.deepStrictEqual(selected.pullRequests, [534]);
		assert.deepStrictEqual(selected.bullets, ["- [ Focus Tree ] Improve the focus tree preview."]);
	});
});
